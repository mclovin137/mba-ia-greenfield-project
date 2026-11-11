import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import videoConfig from '../config/video.config';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { StorageService } from './storage.service';
@Module({
  imports: [
    ConfigModule.forFeature(videoConfig),
    TypeOrmModule.forFeature([Video]),
  ],
  providers: [VideosRepository, StorageService],
  exports: [VideosRepository, StorageService, ConfigModule, TypeOrmModule],
})
export class VideosCoreModule {}
