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

/** One event of the instance feed. */
export interface PlatformEvent {
  id: string;
  type: string;
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
  /** The link of this installation as Ever Platform sees it now, or null when it has none. */
  link(): Promise<{ id: string; state: string; displayName: string | null } | null>;
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
    async link() {
      const self = await client.instances.self();
      const link = self.tenant_links.find(candidate => candidate.state !== 'unlinked');
      return link ? { id: link.id, state: link.state, displayName: link.display_name ?? null } : null;
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
      return { events: page.events.map(event => ({ id: event.id, type: event.type })), lastId: page.last_id, hasMore: page.has_more };
    },
    async ack(lastId) {
      await client.instances.ackEvents(lastId);
    },
    async integrations() {
      const answer = await client.instances.integrations();
      const out: Record<string, PlatformIntegrationState> = {};
      for (const [key, value] of Object.entries(answer.instance as Record<string, Record<string, unknown>>)) {
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
  };
};
