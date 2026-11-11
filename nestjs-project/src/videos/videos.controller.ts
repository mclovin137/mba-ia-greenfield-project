import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Redirect,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { StartUploadDto } from './dto/start-upload.dto';
import {
  VideoStatusDto,
  UploadSessionDto,
  PartUrlDto,
  VideoMetadataDto,
} from './dto/video-response.dto';
import { VideosService } from './videos.service';

function Contract(
  summary: string,
  status: number,
  authenticated = true,
  responseModel?: { new (): object },
) {
  return applyDecorators(
    ApiOperation({ summary, description: summary }),
    ApiResponse({
      status,
      description: summary,
      ...(responseModel
        ? { schema: { $ref: getSchemaPath(responseModel) } }
        : {}),
    }),
    ...[400, 404, 409, 429, 500, ...(authenticated ? [401] : [])].map((error) =>
      ApiResponse({
        status: error,
        description: 'Standard API error',
        schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
      }),
    ),
    ...(authenticated ? [ApiBearerAuth('access-token')] : []),
  );
}
@ApiExtraModels(VideoStatusDto, UploadSessionDto, PartUrlDto, VideoMetadataDto)
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}
  @Post('uploads')
  @Contract(
    'Create a draft and multipart upload (maximum 10GiB)',
    201,
    true,
    UploadSessionDto,
  )
  start(@CurrentUser() user: JwtPayload, @Body() dto: StartUploadDto) {
    return this.videos.start(user.sub, dto);
  }

  @Post(':id/upload-parts/:partNumber')
  @Contract(
    'Sign a direct storage part upload for 15 minutes',
    201,
    true,
    PartUrlDto,
  )
  sign(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('partNumber', ParseIntPipe) part: number,
  ) {
    return this.videos.signPart(user.sub, id, part);
  }

  @Post(':id/complete')
  @HttpCode(202)
  @Contract(
    'Verify storage parts and durably request processing',
    202,
    true,
    VideoStatusDto,
  )
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.complete(user.sub, id);
  }

  @Delete(':id/upload')
  @HttpCode(204)
  @Contract('Abort an unfinished upload', 204)
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.cancel(user.sub, id);
  }

  @Get(':id/status')
  @Contract('Get owner-only video status', 200, true, VideoStatusDto)
  status(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.status(user.sub, id);
  }

  @Public()
  @Get(':publicId/stream')
  @Redirect('', 307)
  @Contract(
    'Redirect to a signed MP4 URL; storage supports byte ranges',
    307,
    false,
  )
  stream(@Param('publicId', ParseUUIDPipe) id: string) {
    return this.videos.media(id, 'stream');
  }

  @Public()
  @Get(':publicId/download')
  @Redirect('', 307)
  @Contract(
    'Redirect to a signed MP4 download with attachment disposition',
    307,
    false,
  )
  download(@Param('publicId', ParseUUIDPipe) id: string) {
    return this.videos.media(id, 'download');
  }

  @Public()
  @Get(':publicId/thumbnail')
  @Redirect('', 307)
  @Contract('Redirect to a signed JPEG thumbnail URL', 307, false)
  thumbnail(@Param('publicId', ParseUUIDPipe) id: string) {
    return this.videos.media(id, 'thumbnail');
  }

  @Public()
  @Get(':publicId')
  @Contract(
    'Get metadata and stable URLs of a ready video',
    200,
    false,
    VideoMetadataDto,
  )
  metadata(@Param('publicId', ParseUUIDPipe) id: string) {
    return this.videos.metadata(id);
  }
}
