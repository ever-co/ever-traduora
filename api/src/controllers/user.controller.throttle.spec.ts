import { config } from '../config';
import UserController from './user.controller';

// @nestjs/throttler keeps a @Throttle({ default: { limit, ttl } }) on the handler under these metadata keys
const LIMIT_KEY = 'THROTTLER:LIMITdefault';
const TTL_KEY = 'THROTTLER:TTLdefault';

describe('UserController rate limits', () => {
  it('puts a profile update, which can send a confirmation email, under the auth rate limit', () => {
    const handler = UserController.prototype.update;
    expect(Reflect.getMetadata(LIMIT_KEY, handler)).toBe(config.throttle.auth.limit);
    expect(Reflect.getMetadata(TTL_KEY, handler)).toBe(config.throttle.auth.ttl);
  });
});
