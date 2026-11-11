import { Test } from '@nestjs/testing';
import { VideoProcessingService } from './video-processing.service';
import { VideosRepository } from '../videos/videos.repository';
import { StorageService } from '../videos/storage.service';
describe('VideoProcessingService', () => {
  let service: VideoProcessingService;
  const videos = { find: jest.fn() };
  const storage = { download: jest.fn() };
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: VideosRepository, useValue: videos },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VideoProcessingService);
  });
  it('extracts duration, dimensions, container and codecs', () => {
    expect(
      service.describe({
        format: { duration: '1.2', format_name: 'matroska' },
        streams: [
          { codec_type: 'video', codec_name: 'vp9', width: 640, height: 480 },
        ],
      }),
    ).toEqual({
      duration: 1.2,
      metadata: {
        width: 640,
        height: 480,
        video_codec: 'vp9',
        audio_codec: null,
        container: 'matroska',
      },
    });
  });
  it('rejects audio-only, invalid or missing duration', () => {
    expect(() => service.describe({})).toThrow('Invalid video metadata');
    expect(() =>
      service.describe({
        format: { duration: 'NaN' },
        streams: [{ codec_type: 'video', width: 2, height: 2 }],
      }),
    ).toThrow();
  });
  it('makes ready or missing jobs a no-op', async () => {
    videos.find
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'ready' });
    await service.process('absent');
    await service.process('ready');
    expect(storage.download).not.toHaveBeenCalled();
  });
});
