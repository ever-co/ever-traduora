import { PendingAccountStep } from './account-settings';

export class User {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  // `GET /users/me`: the versions of the terms and privacy policy accepted (SaaS mode), and what is still to do
  termsVersion?: string | null;
  privacyVersion?: string | null;
  pending?: PendingAccountStep | null;
}
