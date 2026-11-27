import { config } from '../config';
import { AuthController } from './auth.controller';

// @nestjs/throttler keeps a @Throttle({ default: { limit, ttl } }) on the handler under these metadata keys
const LIMIT_KEY = 'THROTTLER:LIMITdefault';
const TTL_KEY = 'THROTTLER:TTLdefault';

describe('AuthController rate limits', () => {
  it.each([['token'], ['resendVerificationEmail'], ['forgotPassword'], ['resetPassword']])(
    '%s takes the auth rate limit (TR_AUTH_THROTTLE_LIMIT per TR_AUTH_THROTTLE_TTL)',
    handlerName => {
      const handler = AuthController.prototype[handlerName];

      expect(Reflect.getMetadata(LIMIT_KEY, handler)).toBe(config.throttle.auth.limit);
      expect(Reflect.getMetadata(TTL_KEY, handler)).toBe(config.throttle.auth.ttl);
    },
  );
});
