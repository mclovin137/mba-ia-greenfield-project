import { DomainException } from '../common/exceptions/domain.exception';
export class VideoNotFound extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}
export class VideoStateConflict extends DomainException {
  constructor() {
    super(
      'VIDEO_STATE_CONFLICT',
      409,
      'Upload expired or video state does not allow this operation',
    );
  }
}
export class InvalidUpload extends DomainException {
  constructor() {
    super(
      'INVALID_UPLOAD',
      400,
      'Uploaded parts do not match the declared video size',
    );
  }
}
