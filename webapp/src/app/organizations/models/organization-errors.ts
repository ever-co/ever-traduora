import { errorToMessage } from '../../shared/util/api-error';

/** Messages for the organization answers of the API, by their code; anything else reads as any other API error. */
const ORGANIZATION_MESSAGES: { [code: string]: string } = {
  slug_taken: 'This address is taken. Choose another one.',
  slug_invalid: 'This address is not allowed. Use 3 to 40 lowercase letters, digits and single hyphens.',
  owner_required: 'The owner stays in the organization. Transfer the ownership first.',
  owner_role: `The owner's role changes only by transferring the ownership.`,
  organization_suspended: 'This organization is suspended. Contact support to restore it.',
  saas_disabled: 'Organizations are not enabled on this installation.',
  billing_disabled: 'Billing is not set up on this installation.',
  billing_unavailable: 'Stripe is not answering for this plan right now. Please try again in a moment.',
  subscription_exists: 'The organization has a subscription already. Change it on this page instead.',
  no_subscription: 'The organization has no subscription. Start one with Checkout.',
  billing_account_missing: 'The organization has no billing account yet. It is made with the first Checkout.',
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
