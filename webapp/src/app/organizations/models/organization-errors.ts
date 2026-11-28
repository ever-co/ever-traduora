import { errorToMessage } from '../../shared/util/api-error';

/** Messages for the organization answers of the API, by their code; anything else reads as any other API error. */
const ORGANIZATION_MESSAGES: { [code: string]: string } = {
  slug_taken: 'This address is taken. Choose another one.',
  slug_invalid: 'This address is not allowed. Use 3 to 40 lowercase letters, digits and single hyphens.',
  owner_required: 'The owner stays in the organization. Transfer the ownership first.',
  owner_role: `The owner's role changes only by transferring the ownership.`,
  organization_suspended: 'This organization is suspended. Contact support to restore it.',
  saas_disabled: 'Organizations are not enabled on this installation.',
  organization_status: `This organization's status changed meanwhile. The page shows the current one.`,
  default_organization: 'The default organization holds every account of this installation. It is never suspended or deleted.',
  slug_mismatch: 'The address you typed does not match. Type it exactly as shown.',
  transfer_invalid: 'A person you chose is no longer a member there. Check again and choose someone else.',
  export_running: 'An export of this organization is being made already. Try again once it is done.',
  slug_released: 'Its address was released already. The page shows the current one.',
  billing_cancellation_none: 'Nothing waits to be cancelled for this organization any more. The page shows the current state.',
};

export function organizationErrorMessage(error: any): string {
  const code = error?.error?.error?.code;
  if (code && Object.prototype.hasOwnProperty.call(ORGANIZATION_MESSAGES, code)) {
    return ORGANIZATION_MESSAGES[code];
  }
  if (error?.status === 409) {
    return 'This person is a member already.';
  }
  return errorToMessage(error);
}
