import { ApiProperty } from '@nestjs/swagger';

export class VideoStatusDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) public_id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ['draft', 'processing', 'ready', 'error', 'cancelled'] })
  status: string;
  @ApiProperty({ type: Number, nullable: true }) duration: number | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata: Record<string, unknown> | null;
  @ApiProperty({ type: String, nullable: true }) error_code: string | null;
  @ApiProperty({ format: 'date-time' }) expires_at: Date;
}
export class UploadSessionDto extends VideoStatusDto {
  @ApiProperty({ example: 67108864 }) part_size: number;
  @ApiProperty({ maximum: 160 }) part_count: number;
}
export class PartUrlDto {
  @ApiProperty({
    description: 'Presigned storage URL; do not log or rewrite its host',
  })
  url: string;
  @ApiProperty({ example: 900 }) expires_in: number;
}
export class VideoMetadataDto {
  @ApiProperty({ format: 'uuid' }) public_id: string;
  @ApiProperty() title: string;
  @ApiProperty() duration: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) metadata: Record<
    string,
    unknown
  >;
  @ApiProperty() stream_url: string;
  @ApiProperty() download_url: string;
  @ApiProperty() thumbnail_url: string;
}
