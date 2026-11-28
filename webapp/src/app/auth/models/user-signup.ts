export interface UserSignup {
  name: string;
  email: string;
  password: string;
  inviteToken?: string;
  organizationName?: string;
  // SaaS mode: the versions of the terms and privacy policy accepted with the sign-up
  termsVersion?: string;
  privacyVersion?: string;
  // Cloudflare Turnstile, when it is on
  turnstileToken?: string;
}

export interface UserSignupWithProvider {
  code: string;
  // OpenID Connect providers (e.g. Ever ID) only; Google sign-ins send the code alone
  provider?: string;
  state?: string;
  nonce?: string;
  code_verifier?: string;
}
