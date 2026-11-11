import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, LessThan } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { VideoNotFound } from './video.errors';

@Injectable()
export class VideosRepository {
  constructor(private readonly db: DataSource) {}
  async channelOwner(id: string): Promise<string> {
    const channel = await this.db
      .getRepository(Channel)
      .findOneByOrFail({ id });
    return channel.user_id;
  }
  create(fields: Partial<Video>): Promise<Video> {
    const repo = this.db.getRepository(Video);
    return repo.save(repo.create(fields));
  }
  find(id: string): Promise<Video | null> {
    return this.db.getRepository(Video).findOneBy({ id });
  }
  ready(public_id: string): Promise<Video | null> {
    return this.db
      .getRepository(Video)
      .findOneBy({ public_id, status: 'ready' });
  }
  async owned(id: string, userId: string): Promise<Video> {
    const video = await this.db
      .getRepository(Video)
      .findOne({ where: { id, channel: { user_id: userId } } });
    if (!video) throw new VideoNotFound();
    return video;
  }
  withOwnerLock<T>(
    id: string,
    userId: string,
    action: (video: Video, manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (manager) => {
      const video = await manager
        .getRepository(Video)
        .createQueryBuilder('video')
        .innerJoin('video.channel', 'channel')
        .where('video.id = :id AND channel.user_id = :userId', { id, userId })
        .setLock('pessimistic_write', undefined, ['video'])
        .getOne();
      if (!video) throw new VideoNotFound();
      return action(video, manager);
    });
  }
  async processing(): Promise<Video[]> {
    return this.db
      .getRepository(Video)
      .find({ where: { status: 'processing' }, order: { created_at: 'ASC' } });
  }
  async expired(): Promise<Video[]> {
    return this.db.getRepository(Video).find({
      where: { status: 'draft', expires_at: LessThan(new Date()) },
      take: 100,
    });
  }
  async updateProcessing(id: string, values: Partial<Video>): Promise<void> {
    await this.db
      .getRepository(Video)
      .update({ id, status: 'processing' }, values);
  }
}
