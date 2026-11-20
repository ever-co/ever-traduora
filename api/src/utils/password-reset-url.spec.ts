import { config } from '../config';
import { passwordResetUrl } from './password-reset-url';

describe('passwordResetUrl', () => {
  it('keeps the host intact and encodes the email, so a plus-addressed email survives the link', () => {
    expect(passwordResetUrl('jane+tr@example.com', 'abc')).toEqual(
      `${config.virtualHost}/reset-password?email=jane%2Btr%40example.com&resetToken=abc`,
    );
  });
});
