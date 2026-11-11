import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import type { VideoStatus } from '../video.constants';

@Entity('videos')
@Check(
  'CHK_video_size',
  '"expected_size" > 0 AND "expected_size" <= 10737418240',
)
@Check(
  'CHK_video_status',
  `"status" IN ('draft','processing','ready','error','cancelled')`,
)
@Index('IDX_video_status_created', ['status', 'created_at'])
export class Video {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', unique: true, default: () => 'uuid_generate_v4()' })
  public_id: string;
  @Index('IDX_video_channel')
  @Column({ type: 'uuid' })
  channel_id: string;
  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: VideoStatus;
  @Column({ type: 'text', unique: true }) source_key: string;
  @Column({ type: 'text', nullable: true }) upload_id: string | null;
  @Column({
    type: 'bigint',
    transformer: { to: (n: number) => n, from: (n: string) => Number(n) },
  })
  expected_size: number;
  @Column({ type: 'varchar', length: 100 }) content_type: string;
  @Column({ type: 'timestamptz' }) expires_at: Date;
  @Column({ type: 'text', nullable: true }) playback_key: string | null;
  @Column({ type: 'text', nullable: true }) thumbnail_key: string | null;
  @Column({ type: 'double precision', nullable: true }) duration: number | null;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<
    string,
    string | number | null
  > | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) error_code:
    | string
    | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
