import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import videoConfig from '../config/video.config';
import { VIDEO_QUEUE, type VideoJob } from './video.constants';
@Injectable()
export class VideoQueueService implements OnModuleDestroy {
  readonly queue: Queue<VideoJob>;
  constructor(@Inject(videoConfig.KEY) cfg: ConfigType<typeof videoConfig>) {
    this.queue = new Queue<VideoJob>(VIDEO_QUEUE, {
      connection: {
        host: cfg.redisHost,
        port: cfg.redisPort,
        maxRetriesPerRequest: 1,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }
  async ensure(videoId: string): Promise<void> {
    await this.queue.add(
      'process-video',
      { version: 1, videoId },
      { jobId: videoId },
    );
  }
  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
