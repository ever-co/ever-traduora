/** A sign-in identity (e.g. Ever ID) connected to the signed-in account. */
export interface Identity {
  id: string;
  provider: string;
  // The provider's email when the identity was connected
  email: string;
  linkMethod: string;
  linkedAt: string;
  lastLoginAt: string | null;
}

/** An invitation the person may accept when creating their account. */
export interface PendingInvite {
  id: string;
  projectName: string;
}

/** What the sign-up confirmation screen shows, from the API's `signup_confirmation_required` answer. */
export interface ProviderSignupConfirmation {
  // Sealed by the API: sent back as is to create the account
  pending: string;
  name: string;
  email: string;
  invites: PendingInvite[];
}

/** A connection of an identity to the signed-in account, waiting for the person to confirm both emails. */
export interface IdentityConnection {
  // Sealed by the API: sent back as is to connect
  pending: string;
  emails: { account: string; everId: string };
}

/** What the webapp keeps (in session storage, read once) between the authorization request and the callback. */
export interface PendingAuthorization {
  provider: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  intent: 'signin' | 'connect';
  createdAt: number;
  /** Where a sign-in returns to once it succeeds: a path of this app (for example the provisioning page). */
  returnTo?: string;
}

/** A path of this app to return to after a sign-in: an absolute path, never another site (`//host`, `/\host`). */
export function localReturnPath(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && value.length <= 512 ? value : undefined;
}
