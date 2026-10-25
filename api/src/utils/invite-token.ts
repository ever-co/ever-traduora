import { createHash, randomBytes } from 'crypto';
import { config } from '../config';

/**
 * Invite tokens prove that whoever signs up for an invitation can read the invited mailbox (or was handed the link
 * by the inviting admin). Only their SHA-256 hash is stored.
 */
export const generateInviteToken = (): string => randomBytes(32).toString('hex');

export const hashInviteToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const inviteSignupUrl = (token: string): string => `${config.virtualHost}/signup?invite=${token}`;
