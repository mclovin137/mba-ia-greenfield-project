import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { VideosCoreModule } from './videos-core.module';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
@Module({
  imports: [VideosCoreModule, ChannelsModule],
  providers: [VideosService],
  controllers: [VideosController],
})
export class VideosModule {}
