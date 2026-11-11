import { DomainException } from '../common/exceptions/domain.exception';
export class ChannelNotFound extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel not found');
  }
}
