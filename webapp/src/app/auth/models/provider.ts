export interface Provider {
  slug: string;
  url: string;
  redirectUrl: string;
  clientId: string;
  // OpenID Connect providers (e.g. Ever ID) only: the scopes to request, and PKCE with state and nonce
  scope?: string;
  pkce?: boolean;
}
