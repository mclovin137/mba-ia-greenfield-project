import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Worker } from 'bullmq';
import videoConfig from '../config/video.config';
import { VIDEO_QUEUE, type VideoJob } from '../videos/video.constants';
import { VideoQueueService } from '../videos/video-queue.service';
import { VideosRepository } from '../videos/videos.repository';
import { StorageService } from '../videos/storage.service';
import { VideoProcessingService } from './video-processing.service';

@Injectable()
export class VideoWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoWorkerService.name);
  private worker: Worker<VideoJob>;
  private timer?: ReturnType<typeof setInterval>;
  private reconciling: Promise<void> | undefined;
  constructor(
    @Inject(videoConfig.KEY)
    private readonly cfg: ConfigType<typeof videoConfig>,
    private readonly queue: VideoQueueService,
    private readonly videos: VideosRepository,
    private readonly processing: VideoProcessingService,
    private readonly storage: StorageService,
  ) {}
  async onModuleInit(): Promise<void> {
    this.worker = new Worker<VideoJob>(
      VIDEO_QUEUE,
      async (job) => {
        if (job.name !== 'process-video' || job.data.version !== 1)
          throw new Error('Unsupported video job');
        await this.processing.process(job.data.videoId);
      },
      {
        connection: {
          host: this.cfg.redisHost,
          port: this.cfg.redisPort,
          maxRetriesPerRequest: null,
        },
        concurrency: 1,
      },
    );
    this.worker.on('error', (error) => this.logger.error(error.message));
    this.worker.on('failed', (job, error) =>
      this.logger.warn(
        `Video ${job?.id ?? 'unknown'} attempt failed: ${error.name}`,
      ),
    );
    await this.reconcile();
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 5000);
  }
  reconcile(): Promise<void> {
    if (!this.reconciling) {
      this.reconciling = this.reconcileOnce()
        .catch((error: unknown) => {
          this.logger.error(
            'Video reconciliation failed',
            error instanceof Error ? error.message : String(error),
          );
        })
        .finally(() => {
          this.reconciling = undefined;
        });
    }
    return this.reconciling;
  }
  private async reconcileOnce(): Promise<void> {
    for (const video of await this.videos.processing()) {
      const job = await this.queue.queue.getJob(video.id);
      if (!job) {
        await this.queue.ensure(video.id);
        continue;
      }
      const state = await job.getState();
      if (state === 'failed')
        await this.videos.updateProcessing(video.id, {
          status: 'error',
          error_code: 'PROCESSING_FAILED',
        });
      // A retained completed job with a still-processing SQL row indicates state loss.
      if (state === 'completed') await job.retry('completed');
    }
    for (const video of await this.videos.expired()) {
      await this.videos.withOwnerLock(
        video.id,
        await this.channelOwner(video.channel_id),
        async (locked, manager) => {
          if (
            locked.status !== 'draft' ||
            locked.expires_at.getTime() > Date.now()
          )
            return;
          // If S3 completion survived a process crash, recover it even after expiry.
          const size = await this.storage.head(locked.source_key);
          if (size === locked.expected_size) {
            locked.status = 'processing';
          } else {
            if (locked.upload_id)
              await this.storage.abort(locked.source_key, locked.upload_id);
            locked.status = size === null ? 'cancelled' : 'error';
            locked.error_code = size === null ? null : 'INVALID_UPLOAD';
          }
          locked.upload_id = null;
          await manager.save(locked);
        },
      );
    }
  }
  private async channelOwner(channelId: string): Promise<string> {
    return this.videos.channelOwner(channelId);
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.reconciling;
    await this.worker?.close();
  }
}
