import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import { MAX_VIDEO_SIZE } from '../video.constants';
export class StartUploadDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/\S/)
  title: string;
  @ApiProperty({ minimum: 1, maximum: MAX_VIDEO_SIZE })
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE)
  size: number;
  @ApiProperty({
    enum: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'],
  })
  @IsIn(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'])
  content_type: string;
}
