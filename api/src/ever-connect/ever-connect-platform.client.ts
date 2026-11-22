import {
  createEverPlatformClient,
  EverPlatformClient,
  generateInstanceKeyPair,
  KeySet,
  makeNodeSigner,
  ProblemError,
  publicJwkOf,
} from '@ever-co/connect-sdk';

/** The last verified entitlement document of a subject, with the claims the status ladder reads. */
export interface StoredEntitlement {
  /** The document exactly as received. */
  jws: string;
  seq: number;
  /** Unix seconds. */
  iat: number;
  /** Unix seconds. */
  exp: number;
  graceS: number;
  tier: string | null;
}

/** An integration state as Ever Platform reports it. */
export interface PlatformIntegrationState {
  state: string;
  enabled: boolean;
  consentId: string | null;
  scopeVersion: number | null;
}

/** What a redeem answers. */
export interface RedeemAnswer {
  registryInstanceId: string;
  kid: string;
  status: string;
  link: { id: string; orgId: string; state: string; displayName: string | null } | null;
}

/** One event of the instance feed: its id, its type and, for the types that carry one, its data. */
export interface PlatformEvent {
  id: string;
  type: string;
  data?: Record<string, unknown> | null;
}

/** A person link: a Traduora user and the Ever ID they signed in with (ids only, never an e-mail or a name). */
export interface PersonLinkReport {
  productUserRef: string;
  identityIssuer: string;
  identitySubject: string;
  /** `explicit` (the user linked it) or `confirmed` (the user confirmed it when the account was made). */
  linkMethod: 'explicit' | 'confirmed';
  productTenantId?: string;
  tenantLinkId?: string;
  displayName?: string;
}

/** This installation's answer to a person's deletion or export request (the receipt). */
export interface PersonRequestAnswer {
  jobId: string;
  result: 'anonymised' | 'exported' | 'no_account';
  reasonCode?: string;
}

/** What a key generation answers: the private key is only ever stored wrapped. */
export interface GeneratedConnectKey {
  publicKey: string;
  privateKeyDer: Uint8Array;
}

/**
 * Every call the connection module makes to Ever Platform, in the module's own words. The SDK implementation is
 * {@link sdkPlatformClient}; tests replace the factory with a fake.
 */
export interface EverConnectPlatformClient {
  redeem(input: {
    code: string;
    version: string;
    installSource: string;
    publicKey: string;
    displayName: string;
    idempotencyKey: string;
  }): Promise<RedeemAnswer>;
  heartbeat(body: { version: string; moduleVersion: string; integrationsDenied: string[] }): Promise<void>;
  /** The installation's state (`active`, `pending_approval`, ...) and its link as Ever Platform sees them now. */
  self(): Promise<{ status: string; link: { id: string; state: string; displayName: string | null } | null }>;
  /** The newer verified document of the installation (`linkId` null) or of its link, `null` when unchanged. */
  entitlement(linkId: string | null, cached: StoredEntitlement | null): Promise<StoredEntitlement | null>;
  events(cursor: string | null, waitS: number): Promise<{ events: PlatformEvent[]; lastId: string; hasMore: boolean }>;
  ack(lastId: string): Promise<void>;
  integrations(): Promise<Record<string, PlatformIntegrationState>>;
  consentUrl(key: string): Promise<string>;
  disableIntegration(key: string, reason: 'instance' | 'policy'): Promise<void>;
  acceptIntegration(key: string, consentId: string, accepted: boolean, idempotencyKey: string): Promise<void>;
  putPublicUrl(url: string, idempotencyKey: string): Promise<void>;
  deletePublicUrl(): Promise<void>;
  statsLink(body: { statement: string; statsInstanceId: string; statsPublicKey: string }, idempotencyKey: string): Promise<void>;
  disconnect(idempotencyKey: string): Promise<void>;
  /** Reports a person link (the same report again answers the recorded link). */
  reportPersonLink(link: PersonLinkReport): Promise<void>;
  /** Removes the person link of a Traduora user. */
  removePersonLink(productUserRef: string): Promise<void>;
  /** Answers a person's deletion or export request. */
  answerPersonRequest(answer: PersonRequestAnswer): Promise<void>;
  /** Reports the result of a maintenance operation: status, version and size only. */
  managedOperationResult(operationId: string, result: ManagedResult): Promise<void>;
  /**
   * The public key (raw base64url Ed25519 `x`) of the provisioning-intent key `kid` in the root-verified key set, and the
   * issuer intents must name; `null` when the set has no such key for intents now. An unknown `kid` refreshes the set
   * once (at most every 10 minutes).
   */
  intentKey(kid: string, nowS: number): Promise<{ x: string; issuer: string } | null>;
  /** Tells Ever Platform what became of a provisioning intent (`/v1/provision-intents/{jti}/complete`). */
  completeProvisionIntent(jti: string, body: ProvisionComplete): Promise<{ status: string; tenantLinkId: string | null }>;
}

/** What this installation tells Ever Platform about a provisioning intent: ids and the result only. */
export interface ProvisionComplete {
  instance_id: string;
  /** The project created for the organization, or `none` for a refusal. */
  product_tenant_id: string;
  product_user_ref?: string;
  urls?: { app: string };
  result: 'created' | 'refused';
}

/** The result of a maintenance operation as Ever Platform receives it (never a path or a file name). */
export interface ManagedResult {
  status: 'succeeded' | 'failed';
  version?: string;
  artefact_ref?: string;
  size_bytes?: number;
}

/** What a client is built from. */
export interface EverConnectClientOptions {
  baseUrl: string;
  version: string;
  issuer: string | null;
  rootKeysFile: string | null;
  privateKeyDer: Uint8Array;
  registryInstanceId: () => string | null;
  onWarning: (message: string) => void;
}

/** Builds the client of one connection key; replaced in tests. */
export type EverConnectClientFactory = (options: EverConnectClientOptions) => EverConnectPlatformClient;

export const EVER_CONNECT_CLIENT_FACTORY = Symbol('ever connect client factory');

/** A new connection key (Ed25519). */
export function generateConnectKey(): GeneratedConnectKey {
  const { publicJwk, privateKeyPkcs8Der } = generateInstanceKeyPair();
  return { publicKey: publicJwk.x, privateKeyDer: privateKeyPkcs8Der };
}

/** The problem code of an Ever Platform answer, or null for any other error (a timeout, no connection). */
export function problemOf(error: unknown): { status: number; code: string } | null {
  return error instanceof ProblemError ? { status: error.status, code: error.code } : null;
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The SDK client: the URL guard, the client assertion, the instance token and the document verifiers are the SDK's. */
export const sdkPlatformClient: EverConnectClientFactory = options => {
  const client: EverPlatformClient = createEverPlatformClient({
    baseUrl: options.baseUrl,
    userAgentProduct: { product: 'traduora', version: options.version },
    signer: makeNodeSigner(options.privateKeyDer),
    registryInstanceId: options.registryInstanceId,
    // Both are honoured by the SDK for a local test platform only, and ignored with a warning otherwise
    ...(options.issuer ? { issuer: options.issuer } : {}),
    env: options.rootKeysFile ? { EVER_PLATFORM_ROOT_KEYS_FILE: options.rootKeysFile } : {},
    onWarning: options.onWarning,
  });
  let keySet: KeySet | undefined;
  /** The key-set refresh in flight, shared by every lookup that needs one meanwhile. */
  let refreshing: Promise<void> | null = null;
  const refreshKeys = (): Promise<void> => {
    refreshing ??= client.keys
      .refresh(keySet)
      .then(update => {
        keySet = update.keySet;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  const verify = async (jws: string, subject: string, cached: StoredEntitlement | null): Promise<StoredEntitlement> => {
    if (!keySet || keySet.needsRefresh()) {
      keySet = (await client.keys.refresh(keySet)).keySet;
    }
    const result = await client.verifyEntitlementRefreshing(jws, {
      keySet,
      subject,
      cached: cached ? { seq: cached.seq, iat: cached.iat } : null,
    });
    keySet = result.keySet;
    const claims = result.verified.claims;
    return {
      jws: result.verified.jws,
      seq: result.verified.seq,
      iat: claims.iat,
      exp: claims.exp,
      graceS: claims.ever.grace_s,
      tier: asString((claims.ever as Record<string, unknown>).tier),
    };
  };

  return {
    async redeem(input) {
      const answer = await client.connect.redeem(
        {
          code: input.code,
          product: 'traduora',
          version: input.version,
          install_source: input.installSource,
          public_jwk: publicJwkOf(makeNodeSigner(options.privateKeyDer)) as unknown as Record<string, never>,
          // One link for the whole installation: Ever Platform records it as `*` for Traduora
          tenant: { product_tenant_id: '*', display_name: input.displayName },
        },
        input.idempotencyKey,
      );
      return {
        registryInstanceId: answer.instance_id,
        kid: answer.kid,
        status: answer.status,
        link: answer.link
          ? {
              id: answer.link.id,
              orgId: answer.link.org_id,
              state: asString((answer.link as Record<string, unknown>).state) || 'active',
              displayName: answer.link.display_name ?? null,
            }
          : null,
      };
    },
    async heartbeat(body) {
      await client.instances.heartbeat({
        version: body.version,
        module_version: body.moduleVersion,
        serves_products: ['traduora'],
        integrations_denied: body.integrationsDenied,
      });
    },
    async self() {
      const self = await client.instances.self();
      const link = self.tenant_links.find(candidate => candidate.state !== 'unlinked');
      return {
        status: asString((self.instance as Record<string, unknown>).status) || 'active',
        link: link ? { id: link.id, state: link.state, displayName: link.display_name ?? null } : null,
      };
    },
    async entitlement(linkId, cached) {
      const answer = linkId ? await client.instances.linkEntitlement(linkId, cached?.seq) : await client.instances.entitlement(cached?.seq);
      if ('notModified' in answer) {
        return null;
      }
      return verify(answer.document, linkId ? `link:${linkId}` : undefined, cached);
    },
    async events(cursor, waitS) {
      const page = await client.instances.events(cursor, { waitS });
      return {
        events: page.events.map(event => {
          const data = (event as { data?: unknown }).data;
          return {
            id: event.id,
            type: event.type,
            data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null,
          };
        }),
        lastId: page.last_id,
        hasMore: page.has_more,
      };
    },
    async ack(lastId) {
      await client.instances.ackEvents(lastId);
    },
    async integrations() {
      const answer = await client.instances.integrations();
      const out: Record<string, PlatformIntegrationState> = {};
      const states = answer && (answer.instance as unknown);
      if (!states || typeof states !== 'object' || Array.isArray(states)) {
        throw new Error('integration states: unexpected answer');
      }
      for (const [key, value] of Object.entries(states as Record<string, Record<string, unknown>>)) {
        // A malformed entry fails the whole read: the stored states (and any revoke still to send) stay as they are
        if (!value || typeof value !== 'object' || typeof value.state !== 'string') {
          throw new Error('integration states: unexpected entry');
        }
        out[key] = {
          state: asString(value.state) || 'available',
          enabled: value.enabled === true,
          consentId: asString(value.consent_id),
          scopeVersion: typeof value.scope_version === 'number' ? value.scope_version : null,
        };
      }
      return out;
    },
    async consentUrl(key) {
      return (await client.instances.consentUrl({ integration: key })).url;
    },
    async disableIntegration(key, reason) {
      await client.instances.setIntegration(key, { enabled: false, reason });
    },
    async acceptIntegration(key, consentId, accepted, idempotencyKey) {
      await client.instances.acceptIntegration(key, { accepted, consent_id: consentId }, idempotencyKey);
    },
    async putPublicUrl(url, idempotencyKey) {
      await client.call('instancePutPublicUrl', { body: { base_url: url }, idempotencyKey });
    },
    async deletePublicUrl() {
      await client.call('instanceDeletePublicUrl', {});
    },
    async statsLink(body, idempotencyKey) {
      await client.instances.statsLink(
        {
          statement_sig: body.statement,
          stats_instance_id: body.statsInstanceId,
          stats_public_jwk: { kty: 'OKP', crv: 'Ed25519', x: body.statsPublicKey },
        },
        idempotencyKey,
      );
    },
    async disconnect(idempotencyKey) {
      await client.instances.disconnect(idempotencyKey);
    },
    async reportPersonLink(link) {
      await client.instances.personLinks.create({
        product_user_ref: link.productUserRef,
        identity_issuer: link.identityIssuer,
        identity_subject: link.identitySubject,
        link_method: link.linkMethod,
        ...(link.productTenantId ? { product_tenant_id: link.productTenantId } : {}),
        ...(link.tenantLinkId ? { tenant_link_id: link.tenantLinkId } : {}),
        ...(link.displayName ? { display_name: link.displayName } : {}),
      });
    },
    async removePersonLink(productUserRef) {
      await client.instances.personLinks.remove(productUserRef);
    },
    async managedOperationResult(operationId, result) {
      await client.instances.managedOperationResult(operationId, { ...result });
    },
    async intentKey(kid, nowS) {
      if (!keySet || keySet.needsRefresh(nowS)) {
        await refreshKeys();
      }
      let key = keySet.find(kid, 'intent', nowS);
      // A key published after the set was read: one refresh, as the SDK allows it (the window is taken before the
      // request). A lookup that finds a refresh in flight waits for it and looks again, whoever started it.
      if (!key && !keySet.has(kid) && (refreshing || keySet.unknownKidRefreshAllowed(nowS))) {
        await refreshKeys();
        key = keySet.find(kid, 'intent', nowS);
      }
      return key ? { x: key.x, issuer: client.issuer } : null;
    },
    async completeProvisionIntent(jti, body) {
      const answer = await client.connect.completeProvisionIntent(jti, { ...body } as never);
      return { status: answer.status, tenantLinkId: answer.tenant_link_id ?? null };
    },
    async answerPersonRequest(answer) {
      await client.instances.ack({
        job_id: answer.jobId,
        result: answer.result,
        ...(answer.reasonCode ? { detail: { reason_code: answer.reasonCode } } : {}),
      });
    },
  };
};
