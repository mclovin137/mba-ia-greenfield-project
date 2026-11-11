import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import videoConfig from '../config/video.config';

@Injectable()
export class StorageService implements OnModuleDestroy {
  readonly internal: S3Client;
  private readonly signer: S3Client;
  constructor(
    @Inject(videoConfig.KEY)
    private readonly cfg: ConfigType<typeof videoConfig>,
  ) {
    const options = {
      region: cfg.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({ ...options, endpoint: cfg.endpoint });
    this.signer = new S3Client({ ...options, endpoint: cfg.publicEndpoint });
  }
  async initiate(key: string, contentType: string): Promise<string> {
    const result = await this.internal.send(
      new CreateMultipartUploadCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) throw new Error('Storage returned no multipart ID');
    return result.UploadId;
  }
  signPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new UploadPartCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: 900 },
    );
  }
  async listParts(key: string, uploadId: string) {
    // <=160 parts at 64MiB for 10GiB: still paginate defensively.
    const parts: { PartNumber?: number; ETag?: string; Size?: number }[] = [];
    let marker: string | undefined;
    do {
      const result = await this.internal.send(
        new ListPartsCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      parts.push(...(result.Parts ?? []));
      marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }
  async complete(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }
  async head(key: string): Promise<number | null> {
    try {
      const head = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') return null;
      throw error;
    }
  }
  async abort(key: string, uploadId: string): Promise<void> {
    try {
      await this.internal.send(
        new AbortMultipartUploadCommand({
          Bucket: this.cfg.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchUpload') return;
      throw error;
    }
  }
  signGet(key: string, downloadName?: string): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ...(downloadName
          ? {
              ResponseContentDisposition: `attachment; filename="${downloadName}"`,
            }
          : {}),
      }),
      { expiresIn: 900 },
    );
  }
  async download(key: string, path: string): Promise<void> {
    const object = await this.internal.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
    );
    if (!(object.Body instanceof Readable))
      throw new Error('Storage body is not readable');
    await pipeline(object.Body, createWriteStream(path, { flags: 'wx' }));
  }
  async upload(key: string, path: string, contentType: string): Promise<void> {
    const file = createReadStream(path);
    try {
      await new Upload({
        client: this.internal,
        params: {
          Bucket: this.cfg.bucket,
          Key: key,
          Body: file,
          ContentType: contentType,
          ContentLength: (await stat(path)).size,
        },
        partSize: 64 * 1024 ** 2,
        queueSize: 2,
        leavePartsOnError: false,
      }).done();
    } finally {
      file.destroy();
    }
  }
  onModuleDestroy() {
    this.internal.destroy();
    this.signer.destroy();
  }
}
