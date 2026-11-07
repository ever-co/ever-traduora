export interface UserSignup {
  name: string;
  email: string;
  password: string;
  inviteToken?: string;
}

export interface UserSignupWithProvider {
  code: string;
  // OpenID Connect providers (e.g. Ever ID) only; Google sign-ins send the code alone
  provider?: string;
  state?: string;
  nonce?: string;
  code_verifier?: string;
}
