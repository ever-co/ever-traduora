import { config } from '../config';
import { generateInviteToken, hashInviteToken } from './invite-token';

/**
 * Email verification tokens prove that the account owner can read the account's mailbox: unlike invite links, they are
 * only ever emailed. They are generated and hashed like invite tokens, and only the hash is stored.
 */
export const generateEmailVerificationToken = generateInviteToken;

export const hashEmailVerificationToken = hashInviteToken;

export const verifyEmailUrl = (token: string): string => `${config.virtualHost}/verify-email?token=${token}`;

export const EMAIL_VERIFICATION_VALID_DAYS = 7;
