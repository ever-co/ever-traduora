import { get } from 'lodash';

/** Messages of the Ever ID (OpenID Connect) sign-in, by the API's error code. */
const PROVIDER_SIGN_IN_MESSAGES: { [code: string]: string } = {
  account_exists:
    'An account with this email already exists. Sign in the usual way, then connect Ever ID in your account settings (Connected sign-in methods).',
  signup_disabled: 'Signups are invitation based only. Ask a project admin to invite you first.',
  email_unverified: 'Please verify your email with Ever ID first, then try again.',
  sign_in_failed: 'The sign-in with Ever ID could not be completed. Please try again.',
  issuer_rejected: 'The sign-in with Ever ID could not be completed. Please try again.',
  session_ended: 'This Ever ID session has ended. Please sign in again.',
  pending_invalid: 'This step expired. Please start again.',
  pending_mismatch: 'This connection was started from another account. Please start again.',
  provider_disabled: 'Sign-in with Ever ID is not available.',
  reauth_required: 'Please sign in to Ever ID again to connect it.',
  subject_linked: 'This Ever ID is connected to another Traduora account.',
  already_linked: 'An Ever ID is connected to your account already.',
  last_sign_in_method: 'This is the only way to sign in to your account. Set a password first (e.g. with "Forgot password"), then disconnect it.',
};

export function errorToMessage(error: any, action = ''): string {
  const domainCode = get(error, 'error.error.code');

  if (domainCode && Object.prototype.hasOwnProperty.call(PROVIDER_SIGN_IN_MESSAGES, domainCode)) {
    return PROVIDER_SIGN_IN_MESSAGES[domainCode];
  }

  if (error.status === 429) {
    switch (action) {
      case 'Login':
        return 'Too many login attempts, this account has been locked for 15 minutes.';
      default:
        return 'Error too many requests, please wait a while before making another request.';
    }
  } else if (error.status === 413) {
    switch (action) {
      case 'ImportLocale':
        // tslint:disable-next-line:max-line-length
        return 'The file that you are trying to import is too large, try importing it as multiple smaller files instead.';
      default:
        return 'Payload too large';
    }
  } else if (domainCode === 'PublishedPassword') {
    return 'This password is publicly known, for example a former default password. Please choose a different one.';
  } else if (domainCode === 'BadRequest') {
    switch (action) {
      case 'ImportLocale':
        // tslint:disable-next-line:max-line-length
        return 'The file that you are trying to import is either malformed or not the right format, please check that it is valid before trying again.';
      default:
        return 'Bad request, please check your values and try again.';
    }
  } else if (domainCode === 'AlreadyExists') {
    switch (action) {
      case 'Signup':
        return 'A user with this email already exists. Please use a different one.';
      case 'InviteProjectUser':
        return `This user is already part of the project's team`;
      default:
        return 'A resource with this value already exists. Please use a different one.';
    }
  } else if (error.status === 404) {
    switch (action) {
      case 'ResetPassword':
      case 'Login':
        return 'We could not find a user with the provided email. Did you type it correctly?';
      case 'InviteProjectUser':
        return 'We could not find a user with the provided email. Has the user already registered on traduora?';
      default:
        return 'Error, resource not found';
    }
  } else if (error.status === 422) {
    switch (action) {
      case 'DeleteAccount':
        return (
          `We are unable to delete your account as you are the last admin for one or more projects. ` +
          `Please assign another admin for those projects or delete the projects first and try again.`
        );
      case 'Login':
        return (
          `This account has no password to sign in with: it was created through a sign-in provider, ` +
          `or its password was publicly known and has been removed. Use "Forgot password" to set a new one.`
        );
      default:
        return 'The server was unable to process the request, please check your request.';
    }
  } else if (error.status === 402) {
    // tslint:disable-next-line:max-line-length
    return `It seems like you would go over the limit of your current project plan. Please review your current usage or upgrade your plan.`;
  } else if (error.status === 401) {
    switch (action) {
      case 'ResetPassword':
        return 'It appears that your password reset token is not valid. Request a new password reset token.';
      case 'Login':
        return 'Bad credentials.';
      case 'ChangePassword':
        return 'Could not change your password, it appears that you entered the wrong current password.';
      case 'Signup':
        return 'This email has a pending invitation. Please sign up with the link from your invitation email, or ask the project admin to send the invitation again.';
      default:
        return 'Error, unauthorized.';
    }
  }

  switch (action) {
    case 'ExportLocale':
      return 'Something went wrong while downloading the export, please try again.';
    case 'ImportLocale':
      return 'There was an error while importing the locale';
    default:
      return 'There was an error while loading, please refresh the page.';
  }
}
