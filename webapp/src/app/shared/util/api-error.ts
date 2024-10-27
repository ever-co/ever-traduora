import { get } from 'lodash';

export function errorToMessage(error: any, action = ''): string {
  const domainCode = get(error, 'error.error.code');

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
