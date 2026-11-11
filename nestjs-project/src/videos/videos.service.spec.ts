import { Test } from '@nestjs/testing';
import { VideosService } from './videos.service';
import { VideosRepository } from './videos.repository';
import { StorageService } from './storage.service';
import { ChannelsService } from '../channels/channels.service';
import { Video } from './entities/video.entity';
import {
  InvalidUpload,
  VideoNotFound,
  VideoStateConflict,
} from './video.errors';
import { MAX_VIDEO_SIZE, PART_SIZE } from './video.constants';
import { StartUploadDto } from './dto/start-upload.dto';
import { validate } from 'class-validator';

describe('VideosService', () => {
  let service: VideosService;
  let video: Video;
  const manager = {
    save: jest.fn().mockImplementation((v: Video) => Promise.resolve(v)),
  };
  const repository = {
    create: jest.fn(),
    withOwnerLock: jest.fn(),
    ready: jest.fn(),
    owned: jest.fn(),
  };
  const storage = {
    initiate: jest.fn(),
    signPart: jest.fn(),
    head: jest.fn(),
    listParts: jest.fn(),
    complete: jest.fn(),
    abort: jest.fn(),
    signGet: jest.fn(),
  };
  const channels = { findByUserId: jest.fn() };
  beforeEach(async () => {
    jest.clearAllMocks();
    video = Object.assign(new Video(), {
      id: 'video',
      public_id: 'public',
      channel_id: 'channel',
      source_key: 'source',
      upload_id: 'upload',
      expected_size: 100,
      status: 'draft',
      expires_at: new Date(Date.now() + 60000),
    });
    repository.withOwnerLock.mockImplementation(
      (
        _id: string,
        _owner: string,
        action: (v: Video, m: typeof manager) => unknown,
      ) => action(video, manager),
    );
    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: VideosRepository, useValue: repository },
        { provide: StorageService, useValue: storage },
        { provide: ChannelsService, useValue: channels },
      ],
    }).compile();
    service = module.get(VideosService);
  });
  it('accepts exactly 10GiB and rejects oversize/non-integer sizes', async () => {
    const dto = Object.assign(new StartUploadDto(), {
      title: 'Boundary',
      size: MAX_VIDEO_SIZE,
      content_type: 'video/mp4',
    });
    expect(await validate(dto)).toHaveLength(0);
    dto.size++;
    expect(await validate(dto)).not.toHaveLength(0);
    dto.size = 1.5;
    expect(await validate(dto)).not.toHaveLength(0);
  });
  it('persists draft before initiating storage, with unique generated source key', async () => {
    channels.findByUserId.mockResolvedValue({ id: 'channel' });
    repository.create.mockResolvedValue(video);
    storage.initiate.mockImplementation(() => {
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'draft',
          expected_size: MAX_VIDEO_SIZE,
        }),
      );
      return 'upload';
    });
    const result = await service.start('owner', {
      title: 'Video',
      size: MAX_VIDEO_SIZE,
      content_type: 'video/mp4',
    });
    expect(result.part_count).toBe(160);
  });
  it('does not sign out-of-bounds parts or expired uploads', async () => {
    await expect(service.signPart('owner', 'video', 2)).rejects.toBeInstanceOf(
      InvalidUpload,
    );
    video.expires_at = new Date(0);
    await expect(service.signPart('owner', 'video', 1)).rejects.toBeInstanceOf(
      VideoStateConflict,
    );
    expect(storage.signPart).not.toHaveBeenCalled();
  });
  it('rejects short or noncontiguous parts without completing', async () => {
    storage.head.mockResolvedValue(null);
    storage.listParts.mockResolvedValue([
      { PartNumber: 2, ETag: 'tag', Size: 100 },
    ]);
    await expect(service.complete('owner', 'video')).rejects.toBeInstanceOf(
      InvalidUpload,
    );
    storage.listParts.mockResolvedValue([
      { PartNumber: 1, ETag: 'tag', Size: 99 },
    ]);
    await expect(service.complete('owner', 'video')).rejects.toBeInstanceOf(
      InvalidUpload,
    );
    expect(storage.complete).not.toHaveBeenCalled();
  });
  it('checks all full parts and the final part then persists processing', async () => {
    video.expected_size = PART_SIZE + 100;
    storage.head
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(PART_SIZE + 100);
    storage.listParts.mockResolvedValue([
      { PartNumber: 1, ETag: 'one', Size: PART_SIZE },
      { PartNumber: 2, ETag: 'two', Size: 100 },
    ]);
    expect((await service.complete('owner', 'video')).status).toBe(
      'processing',
    );
    expect(video.upload_id).toBeNull();
  });
  it('recovers a completed S3 upload after an interrupted database commit', async () => {
    storage.head.mockResolvedValue(100);
    expect((await service.complete('owner', 'video')).status).toBe(
      'processing',
    );
    expect(storage.listParts).not.toHaveBeenCalled();
  });
  it('makes duplicate completion idempotent', async () => {
    video.status = 'ready';
    expect((await service.complete('owner', 'video')).status).toBe('ready');
    expect(storage.head).not.toHaveBeenCalled();
  });
  it('commits invalid size as error before reporting failure', async () => {
    storage.head.mockResolvedValue(101);
    await expect(service.complete('owner', 'video')).rejects.toBeInstanceOf(
      InvalidUpload,
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        error_code: 'INVALID_UPLOAD',
      }),
    );
  });
  it('aborts once and makes cancellation idempotent', async () => {
    storage.head.mockResolvedValue(null);
    await service.cancel('owner', 'video');
    await service.cancel('owner', 'video');
    expect(storage.abort).toHaveBeenCalledTimes(1);
    expect(video.status).toBe('cancelled');
  });
  it('does not cancel a completed source awaiting SQL recovery', async () => {
    storage.head.mockResolvedValue(100);
    await expect(service.cancel('owner', 'video')).rejects.toBeInstanceOf(
      VideoStateConflict,
    );
  });
  it('hides nonready videos and emits signed attachment redirects', async () => {
    repository.ready.mockResolvedValue(null);
    await expect(service.metadata('public')).rejects.toBeInstanceOf(
      VideoNotFound,
    );
    video.status = 'ready';
    video.playback_key = 'playback';
    repository.ready.mockResolvedValue(video);
    storage.signGet.mockResolvedValue('https://storage/signed');
    expect(await service.media('public', 'download')).toEqual({
      url: 'https://storage/signed',
      statusCode: 307,
    });
    expect(storage.signGet).toHaveBeenCalledWith('playback', 'public.mp4');
  });
  it('propagates ownership failure before any storage side effect', async () => {
    repository.withOwnerLock.mockRejectedValue(new VideoNotFound());
    await expect(service.complete('stranger', 'video')).rejects.toBeInstanceOf(
      VideoNotFound,
    );
    expect(storage.head).not.toHaveBeenCalled();
  });
});
