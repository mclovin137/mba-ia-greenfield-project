import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { VideosCoreModule } from '../videos/videos-core.module';
import { VideoQueueService } from '../videos/video-queue.service';
import { VideoWorkerService } from './video-worker.service';
import { VideoProcessingService } from './video-processing.service';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (cfg: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password,
        database: cfg.name,
        autoLoadEntities: true,
        synchronize: false,
        entities: [User, Channel],
      }),
    }),
    VideosCoreModule,
  ],
  providers: [VideoQueueService, VideoProcessingService, VideoWorkerService],
})
export class WorkerModule {}
