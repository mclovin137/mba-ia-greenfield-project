export const MAX_VIDEO_SIZE = 10 * 1024 ** 3;
export const PART_SIZE = 64 * 1024 ** 2;
export const VIDEO_QUEUE = 'video-processing';
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export type VideoStatus =
  | 'draft'
  | 'processing'
  | 'ready'
  | 'error'
  | 'cancelled';
export interface VideoJob {
  version: 1;
  videoId: string;
}
