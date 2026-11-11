import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker/worker.module';
import { VideoWorkerService } from '../src/worker/video-worker.service';
import { VideoQueueService } from '../src/videos/video-queue.service';
import { Video } from '../src/videos/entities/video.entity';
import { User } from '../src/users/entities/user.entity';
import { ChannelsService } from '../src/channels/channels.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { StorageService } from '../src/videos/storage.service';
import videoConfig from '../src/config/video.config';
import { PART_SIZE } from '../src/videos/video.constants';

interface Upload {
  id: string;
  public_id: string;
  status: string;
  part_size: number;
  part_count: number;
}
describe('Videos (e2e, real PostgreSQL/MinIO/Redis/FFmpeg)', () => {
  let app: INestApplication<App>;
  let workerModule: TestingModule;
  let db: DataSource;
  let token: string;
  let stranger: string;
  let dir: string;
  let fixture: Buffer;
  const created: Upload[] = [];
  const signedRequest = (jwt: string = token) => ({
    Authorization: `Bearer ${jwt}`,
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    db = app.get(DataSource);
    await cleanAllTables(db);
    for (const other of [false, true]) {
      const email = `${randomUUID()}@example.com`;
      const user = await db
        .getRepository(User)
        .save({ email, password: 'test-only', is_confirmed: true });
      await app.get(ChannelsService).createChannel(user.id, email);
      const jwt = app.get(JwtService).sign({ sub: user.id, email });
      if (other) stranger = jwt;
      else token = jwt;
    }
    dir = await mkdtemp(join(tmpdir(), 'video-e2e-'));
    const path = join(dir, 'fixture.mp4');
    execFileSync('ffmpeg', [
      '-nostdin',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:r=10',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    fixture = await readFile(path);
    workerModule = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await workerModule.init();
  }, 60000);
  beforeEach(() =>
    app.get<ThrottlerStorageService>(ThrottlerStorage).storage.clear(),
  );
  afterAll(async () => {
    if (workerModule) {
      await workerModule.get(VideoWorkerService).onModuleDestroy();
      const queue = workerModule.get(VideoQueueService).queue;
      await queue.obliterate({ force: true });
      await workerModule.close();
    }
    if (app) {
      const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
      const storage = app.get(StorageService);
      for (const video of created) {
        const row = await db.getRepository(Video).findOneBy({ id: video.id });
        if (row)
          await storage.internal.send(
            new DeleteObjectsCommand({
              Bucket: videoConfig().bucket,
              Delete: {
                Objects: [row.source_key, row.playback_key, row.thumbnail_key]
                  .filter((key): key is string => !!key)
                  .map((Key) => ({ Key })),
              },
            }),
          );
      }
      await cleanAllTables(db);
      await app.close();
    }
    if (dir) await rm(dir, { force: true, recursive: true });
  }, 30000);
  async function start(size: number): Promise<Upload> {
    const result = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set(signedRequest())
      .send({ title: 'Real video', size, content_type: 'video/mp4' })
      .expect(201);
    const upload = result.body as Upload;
    created.push(upload);
    return upload;
  }
  async function uploadPart(video: Upload, data: Buffer, part = 1) {
    const result = await request(app.getHttpServer())
      .post(`/videos/${video.id}/upload-parts/${part}`)
      .set(signedRequest())
      .expect(201);
    const body = result.body as { url: string };
    expect(
      (await fetch(body.url, { method: 'PUT', body: new Uint8Array(data) }))
        .status,
    ).toBe(200);
  }
  async function waitFor(video: Upload, status: string) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const row = await db
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      if (row.status === status) return row;
      if (row.status === 'error' && status !== 'error')
        throw new Error(`Processing failed: ${row.error_code}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${status}`);
  }
  it('requires JWT and enforces inclusive 10GiB size and ownership', async () => {
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/videos/uploads')
      .set(signedRequest())
      .send({
        title: 'Too large',
        size: 10737418241,
        content_type: 'video/mp4',
      })
      .expect(400);
    const video = await start(10737418240);
    expect(video.part_count).toBe(160);
    await request(app.getHttpServer())
      .get(`/videos/${video.id}/status`)
      .set(signedRequest(stranger))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/videos/${video.id}/upload-parts/1`)
      .set(signedRequest(stranger))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/videos/${video.id}/complete`)
      .set(signedRequest(stranger))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/videos/${video.id}/upload`)
      .set(signedRequest(stranger))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/videos/${video.public_id}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/videos/${video.id}/upload`)
      .set(signedRequest())
      .expect(204);
  });
  it('processes real media, returns thumbnail, streams ranges, downloads and deduplicates completion', async () => {
    const video = await start(fixture.length);
    await uploadPart(video, fixture);
    for (const response of await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/videos/${video.id}/complete`)
          .set(signedRequest()),
      ),
    ))
      expect(response.status).toBe(202);
    const row = await waitFor(video, 'ready');
    expect(row.duration).toBeGreaterThan(0);
    expect(row.metadata?.width).toBe(64);
    await request(app.getHttpServer())
      .get(`/videos/${video.public_id}`)
      .expect(200);
    const stream = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .set('Range', 'bytes=0-31')
      .expect(307);
    const result = await fetch(stream.headers.location, {
      headers: { Range: 'bytes=0-31' },
    });
    expect(result.status).toBe(206);
    expect((await result.arrayBuffer()).byteLength).toBe(32);
    const thumbnail = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/thumbnail`)
      .expect(307);
    const image = await fetch(thumbnail.headers.location);
    expect(image.headers.get('content-type')).toContain('image/jpeg');
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const download = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/download`)
      .expect(307);
    const file = await fetch(download.headers.location);
    expect(file.headers.get('content-disposition')).toContain('attachment');
    await file.arrayBuffer();
    const job = await workerModule
      .get(VideoQueueService)
      .queue.getJob(video.id);
    expect(job).toBeDefined();
    await workerModule.get(VideoWorkerService).reconcile();
    expect(
      (await db.getRepository(Video).findOneByOrFail({ id: video.id })).status,
    ).toBe('ready');
  }, 60000);
  it('validates real multipart boundaries and allows abort after invalid completion', async () => {
    const video = await start(PART_SIZE + 10);
    await uploadPart(video, Buffer.alloc(PART_SIZE));
    await request(app.getHttpServer())
      .post(`/videos/${video.id}/complete`)
      .set(signedRequest())
      .expect(400);
    await uploadPart(video, Buffer.alloc(9), 2);
    await request(app.getHttpServer())
      .post(`/videos/${video.id}/complete`)
      .set(signedRequest())
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/videos/${video.id}/upload`)
      .set(signedRequest())
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/videos/${video.id}/upload`)
      .set(signedRequest())
      .expect(204);
    await request(app.getHttpServer())
      .post(`/videos/${video.id}/complete`)
      .set(signedRequest())
      .expect(409);
  }, 30000);
  it('persists error after real corrupt-video retries are exhausted', async () => {
    const invalid = Buffer.from('not a video');
    const video = await start(invalid.length);
    await uploadPart(video, invalid);
    await request(app.getHttpServer())
      .post(`/videos/${video.id}/complete`)
      .set(signedRequest())
      .expect(202);
    expect((await waitFor(video, 'error')).error_code).toBe(
      'PROCESSING_FAILED',
    );
    await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .expect(404);
  }, 60000);
});
