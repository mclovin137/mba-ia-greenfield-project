import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import {
  createTestDataSource,
  cleanAllTables,
} from '../test/create-test-data-source';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794350000000 } from '../database/migrations/1794350000000-CreateVideos';
import videoConfig from '../config/video.config';
import { StorageService } from './storage.service';
import { Video } from './entities/video.entity';
import { MAX_VIDEO_SIZE } from './video.constants';

describe('Videos infrastructure (integration)', () => {
  let module: TestingModule;
  let db: DataSource;
  let storage: StorageService;
  beforeAll(async () => {
    db = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1794350000000,
        ],
      },
    );
    await db.initialize();
    await db.runMigrations();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ConfigModule.forFeature(videoConfig),
      ],
      providers: [StorageService],
    }).compile();
    storage = module.get(StorageService);
  }, 30000);
  afterAll(async () => {
    await module?.close();
    if (db?.isInitialized) {
      try {
        await db.runMigrations();
        await cleanAllTables(db);
      } finally {
        await db.destroy();
      }
    }
  });
  it('reverses and restores the video migration on a real database', async () => {
    const runner = db.createQueryRunner();
    try {
      await new CreateVideos1794350000000().down(runner);
      expect(await runner.hasTable('videos')).toBe(false);
    } finally {
      await new CreateVideos1794350000000().up(runner);
      await runner.release();
    }
  });
  it('enforces size, unique URL and channel foreign key at the database boundary', async () => {
    const user = await db.getRepository(User).save({
      email: `${randomUUID()}@example.com`,
      password: 'test-only',
      is_confirmed: true,
    });
    const channel = await db
      .getRepository(Channel)
      .save({ user_id: user.id, name: 'Videos', nickname: randomUUID() });
    const fields = {
      channel_id: channel.id,
      title: 'Limits',
      expected_size: MAX_VIDEO_SIZE,
      content_type: 'video/mp4',
      source_key: randomUUID(),
      expires_at: new Date(Date.now() + 60000),
    };
    const video = await db.getRepository(Video).save({ ...fields });
    expect(video.public_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      Number(
        (await db.getRepository(Video).findOneByOrFail({ id: video.id }))
          .expected_size,
      ),
    ).toBe(MAX_VIDEO_SIZE);
    await expect(
      db.getRepository(Video).save({
        ...fields,
        source_key: randomUUID(),
        public_id: video.public_id,
      }),
    ).rejects.toThrow();
    await expect(
      db.getRepository(Video).save({
        ...fields,
        source_key: randomUUID(),
        expected_size: MAX_VIDEO_SIZE + 1,
      }),
    ).rejects.toThrow();
    await expect(
      db.getRepository(Video).save({
        ...fields,
        source_key: randomUUID(),
        channel_id: randomUUID(),
      }),
    ).rejects.toThrow();
  });
  it('performs real signed multipart PUT, completion, byte-range GET and attachment download', async () => {
    const key = `integration/${randomUUID()}`;
    const upload = await storage.initiate(key, 'video/mp4');
    try {
      const url = await storage.signPart(key, upload, 1);
      expect(
        (await fetch(url, { method: 'PUT', body: Buffer.from('0123456789') }))
          .status,
      ).toBe(200);
      const parts = await storage.listParts(key, upload);
      expect(parts[0].Size).toBe(10);
      await storage.complete(
        key,
        upload,
        parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })),
      );
      expect(await storage.head(key)).toBe(10);
      const read = await fetch(await storage.signGet(key), {
        headers: { Range: 'bytes=2-5' },
      });
      expect(read.status).toBe(206);
      expect(await read.text()).toBe('2345');
      expect(read.headers.get('content-range')).toBe('bytes 2-5/10');
      const unsatisfied = await fetch(await storage.signGet(key), {
        headers: { Range: 'bytes=99-' },
      });
      expect(unsatisfied.status).toBe(416);
      await unsatisfied.arrayBuffer();
      const download = await fetch(await storage.signGet(key, 'video.mp4'));
      expect(download.headers.get('content-disposition')).toContain(
        'attachment',
      );
      await download.arrayBuffer();
    } finally {
      await storage.abort(key, upload);
      await storage.internal.send(
        new DeleteObjectCommand({ Bucket: videoConfig().bucket, Key: key }),
      );
    }
  }, 30000);
  it('delivers a real Redis job with retry and deterministic deduplication', async () => {
    const cfg = videoConfig();
    const connection = { host: cfg.redisHost, port: cfg.redisPort };
    const name = `integration-${randomUUID()}`;
    const queue = new Queue(name, { connection });
    const events = new QueueEvents(name, { connection });
    let attempts = 0;
    const worker = new Worker(
      name,
      () => {
        attempts++;
        if (attempts === 1) throw new Error('retry me');
        return Promise.resolve('processed');
      },
      { connection },
    );
    try {
      await events.waitUntilReady();
      const id = randomUUID();
      const first = await queue.add(
        'process-video',
        { version: 1, videoId: id },
        { jobId: id, attempts: 2, backoff: { type: 'fixed', delay: 100 } },
      );
      await queue.add(
        'process-video',
        { version: 1, videoId: id },
        { jobId: id },
      );
      expect(await first.waitUntilFinished(events, 15000)).toBe('processed');
      expect(attempts).toBe(2);
      expect(await queue.getCompletedCount()).toBe(1);
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 30000);
});
