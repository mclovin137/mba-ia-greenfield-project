import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideosRepository } from '../videos/videos.repository';
import { StorageService } from '../videos/storage.service';
const exec = promisify(execFile);
export interface Probe {
  format?: { duration?: string; format_name?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }[];
}
@Injectable()
export class VideoProcessingService {
  constructor(
    private readonly videos: VideosRepository,
    private readonly storage: StorageService,
  ) {}
  describe(probe: Probe) {
    const stream = probe.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    const duration = Number(probe.format?.duration);
    if (
      !stream ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !stream.width ||
      !stream.height
    )
      throw new Error('Invalid video metadata');
    return {
      duration,
      metadata: {
        width: stream.width,
        height: stream.height,
        video_codec: stream.codec_name ?? null,
        audio_codec:
          probe.streams?.find((s) => s.codec_type === 'audio')?.codec_name ??
          null,
        container: probe.format?.format_name ?? null,
      },
    };
  }
  async process(videoId: string): Promise<void> {
    const video = await this.videos.find(videoId);
    if (!video || video.status !== 'processing') return;
    const directory = await mkdtemp(join(tmpdir(), 'streamtube-'));
    try {
      const source = join(directory, 'source');
      const playback = join(directory, 'playback.mp4');
      const thumbnail = join(directory, 'thumbnail.jpg');
      await this.storage.download(video.source_key, source);
      const { stdout } = await exec(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          'mov,matroska,webm',
          '-show_format',
          '-show_streams',
          '-of',
          'json',
          source,
        ],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );
      const { duration, metadata } = this.describe(JSON.parse(stdout) as Probe);
      await exec(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          'mov,matroska,webm',
          '-i',
          source,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c:v',
          'libx264',
          '-threads',
          '1',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-vf',
          'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          playback,
        ],
        { timeout: 2 * 60 * 60 * 1000, maxBuffer: 1024 * 1024 },
      );
      await exec(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-i',
          playback,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:-2',
          '-threads',
          '1',
          thumbnail,
        ],
        { timeout: 120000, maxBuffer: 1024 * 1024 },
      );
      const prefix = `channels/${video.channel_id}/videos/${video.id}`;
      const playback_key = `${prefix}/playback.mp4`;
      const thumbnail_key = `${prefix}/thumbnail.jpg`;
      await this.storage.upload(playback_key, playback, 'video/mp4');
      await this.storage.upload(thumbnail_key, thumbnail, 'image/jpeg');
      await this.videos.updateProcessing(video.id, {
        status: 'ready',
        playback_key,
        thumbnail_key,
        duration,
        metadata,
        error_code: null,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
