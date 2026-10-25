export interface UserSignup {
  name: string;
  email: string;
  password: string;
  inviteToken?: string;
}

export interface UserSignupWithProvider {
  code: string;
}
