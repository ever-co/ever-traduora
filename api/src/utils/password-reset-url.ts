import { config } from '../config';

/**
 * The link of the password reset email. The email is encoded so that a plus-addressed one (jane+tr@example.com)
 * reaches the reset page unchanged: an unencoded '+' is read as a space there.
 */
export const passwordResetUrl = (email: string, token: string): string =>
  `${config.virtualHost}/reset-password?email=${encodeURIComponent(email)}&resetToken=${encodeURIComponent(token)}`;
