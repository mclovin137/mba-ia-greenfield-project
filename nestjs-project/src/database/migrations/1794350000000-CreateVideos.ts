import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateVideos1794350000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.createTable(
      new Table({
        name: 'videos',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'public_id',
            type: 'uuid',
            isUnique: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'channel_id', type: 'uuid' },
          { name: 'title', type: 'varchar', length: '200' },
          { name: 'status', type: 'varchar', length: '16', default: "'draft'" },
          { name: 'source_key', type: 'text', isUnique: true },
          { name: 'upload_id', type: 'text', isNullable: true },
          { name: 'expected_size', type: 'bigint' },
          { name: 'content_type', type: 'varchar', length: '100' },
          { name: 'expires_at', type: 'timestamptz' },
          { name: 'playback_key', type: 'text', isNullable: true },
          { name: 'thumbnail_key', type: 'text', isNullable: true },
          { name: 'duration', type: 'double precision', isNullable: true },
          { name: 'metadata', type: 'jsonb', isNullable: true },
          {
            name: 'error_code',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
        foreignKeys: [
          {
            columnNames: ['channel_id'],
            referencedTableName: 'channels',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          { name: 'IDX_video_channel', columnNames: ['channel_id'] },
          {
            name: 'IDX_video_status_created',
            columnNames: ['status', 'created_at'],
          },
        ],
        checks: [
          {
            name: 'CHK_video_size',
            expression:
              '"expected_size" > 0 AND "expected_size" <= 10737418240',
          },
          {
            name: 'CHK_video_status',
            expression: `"status" IN ('draft','processing','ready','error','cancelled')`,
          },
        ],
      }),
      true,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable('videos', true);
  }
}
