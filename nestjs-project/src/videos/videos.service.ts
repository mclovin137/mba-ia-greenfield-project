import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChannelsService } from '../channels/channels.service';
import { VideosRepository } from './videos.repository';
import { StorageService } from './storage.service';
import { StartUploadDto } from './dto/start-upload.dto';
import {
  InvalidUpload,
  VideoNotFound,
  VideoStateConflict,
} from './video.errors';
import { PART_SIZE, UPLOAD_TTL_MS } from './video.constants';
import { Video } from './entities/video.entity';

@Injectable()
export class VideosService {
  constructor(
    private readonly videos: VideosRepository,
    private readonly channels: ChannelsService,
    private readonly storage: StorageService,
  ) {}
  async start(userId: string, dto: StartUploadDto) {
    const channel = await this.channels.findByUserId(userId);
    const id = randomUUID();
    const video = await this.videos.create({
      id,
      channel_id: channel.id,
      title: dto.title,
      status: 'draft',
      expected_size: dto.size,
      content_type: dto.content_type,
      source_key: `channels/${channel.id}/videos/${id}/source`,
      expires_at: new Date(Date.now() + UPLOAD_TTL_MS),
    });
    // Persist draft before initiating storage. A failed initiation remains visible and expires.
    await this.videos.withOwnerLock(id, userId, async (locked, manager) => {
      locked.upload_id = await this.storage.initiate(
        video.source_key,
        dto.content_type,
      );
      await manager.save(locked);
    });
    return {
      ...this.view(video),
      part_size: PART_SIZE,
      part_count: Math.ceil(dto.size / PART_SIZE),
    };
  }
  async signPart(userId: string, id: string, partNumber: number) {
    return this.videos.withOwnerLock(id, userId, async (video) => {
      this.requireDraft(video);
      if (
        partNumber < 1 ||
        partNumber > Math.ceil(video.expected_size / PART_SIZE)
      )
        throw new InvalidUpload();
      return {
        url: await this.storage.signPart(
          video.source_key,
          video.upload_id!,
          partNumber,
        ),
        expires_in: 900,
      };
    });
  }
  async complete(userId: string, id: string) {
    const result = await this.videos.withOwnerLock(
      id,
      userId,
      async (video, manager) => {
        if (
          video.status === 'processing' ||
          video.status === 'ready' ||
          video.status === 'error'
        )
          return { view: this.view(video), invalid: false };
        this.requireDraft(video);
        let size = await this.storage.head(video.source_key);
        if (size === null) {
          const parts = await this.storage.listParts(
            video.source_key,
            video.upload_id!,
          );
          const count = Math.ceil(video.expected_size / PART_SIZE);
          if (
            parts.length !== count ||
            parts.some(
              (part, index) =>
                part.PartNumber !== index + 1 ||
                !part.ETag ||
                part.Size !==
                  Math.min(PART_SIZE, video.expected_size - index * PART_SIZE),
            )
          )
            throw new InvalidUpload();
          await this.storage.complete(
            video.source_key,
            video.upload_id!,
            parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })),
          );
          size = await this.storage.head(video.source_key);
        }
        if (size !== video.expected_size) {
          video.status = 'error';
          video.error_code = 'INVALID_UPLOAD';
          await manager.save(video);
          return { view: this.view(video), invalid: true };
        }
        video.status = 'processing';
        video.upload_id = null;
        await manager.save(video);
        // processing is a durable dispatch intent, picked up by the worker reconciler.
        return { view: this.view(video), invalid: false };
      },
    );
    if (result.invalid) throw new InvalidUpload();
    return result.view;
  }
  async cancel(userId: string, id: string): Promise<void> {
    await this.videos.withOwnerLock(id, userId, async (video, manager) => {
      if (video.status === 'cancelled') return;
      if (video.status !== 'draft') throw new VideoStateConflict();
      // Completing in S3 may precede DB commit; don't cancel an already committed source.
      if ((await this.storage.head(video.source_key)) !== null)
        throw new VideoStateConflict();
      if (video.upload_id)
        await this.storage.abort(video.source_key, video.upload_id);
      video.status = 'cancelled';
      video.upload_id = null;
      await manager.save(video);
    });
  }
  async status(userId: string, id: string) {
    return this.view(await this.videos.owned(id, userId));
  }
  async metadata(publicId: string) {
    const video = await this.getReady(publicId);
    return {
      public_id: video.public_id,
      title: video.title,
      duration: video.duration,
      metadata: video.metadata,
      stream_url: `/videos/${video.public_id}/stream`,
      download_url: `/videos/${video.public_id}/download`,
      thumbnail_url: `/videos/${video.public_id}/thumbnail`,
    };
  }
  async media(publicId: string, kind: 'stream' | 'download' | 'thumbnail') {
    const video = await this.getReady(publicId);
    const key = kind === 'thumbnail' ? video.thumbnail_key : video.playback_key;
    if (!key) throw new VideoNotFound();
    return {
      url: await this.storage.signGet(
        key,
        kind === 'download' ? `${video.public_id}.mp4` : undefined,
      ),
      statusCode: 307,
    };
  }
  private async getReady(publicId: string) {
    const video = await this.videos.ready(publicId);
    if (!video) throw new VideoNotFound();
    return video;
  }
  private requireDraft(video: Video) {
    if (
      video.status !== 'draft' ||
      !video.upload_id ||
      video.expires_at.getTime() <= Date.now()
    )
      throw new VideoStateConflict();
  }
  private view(video: Video) {
    return {
      id: video.id,
      public_id: video.public_id,
      title: video.title,
      status: video.status,
      duration: video.duration,
      metadata: video.metadata,
      error_code: video.error_code,
      expires_at: video.expires_at,
    };
  }
}
