import { raw } from 'express';

/** The route of Stripe's webhook, without its leading slash */
export const BILLING_WEBHOOK_PATH = 'api/v1/billing/webhook';

/** Stripe's events are small; anything larger is not one */
const WEBHOOK_BODY_LIMIT = '1mb';

interface UsesMiddleware {
  use(path: string, handler: (...args: any[]) => void): unknown;
}

/**
 * Keeps the webhook's body as it arrived (a Buffer in `req.body`): its Stripe signature is over those exact bytes, and
 * the app's JSON parser would replace them with an object. Mounted on the application before Nest registers its body
 * parsers (`addPipesAndFilters`, before `init`), so it runs first for this one route; the JSON parser then finds the
 * body read and leaves it alone. Every other route keeps the parsers as they are.
 */
export function mountBillingWebhookBody(app: UsesMiddleware): void {
  app.use(`/${BILLING_WEBHOOK_PATH}`, raw({ type: () => true, limit: WEBHOOK_BODY_LIMIT }));
}
