import { ProblemError } from '@ever-co/connect-sdk';
import { generateKeyPairSync, KeyObject, randomBytes, sign } from 'node:crypto';
import {
  EverConnectClientFactory,
  EverConnectClientOptions,
  EverConnectPlatformClient,
  PersonLinkReport,
  PersonRequestAnswer,
  PlatformEvent,
  PlatformIntegrationState,
  ProvisionComplete,
  StoredEntitlement,
} from '../src/ever-connect/ever-connect-platform.client';

/** One call the fake platform received: its name and what it carried (never a key). */
export interface FakeCall {
  name: string;
  args: unknown[];
}

/**
 * A stand-in for Ever Platform in tests: it records every call and answers as the platform would, with states the test
 * sets. It knows one connect code.
 */
export class FakeEverPlatform {
  readonly calls: FakeCall[] = [];
  readonly clients: EverConnectClientOptions[] = [];
  code = 'EVC-TEST-0000-0001';
  redeemStatus = 'active';
  integrationStates: Record<string, PlatformIntegrationState> = {};
  events: PlatformEvent[] = [];
  /** The person links the fake holds, by Traduora user id. */
  personLinks: Record<string, PersonLinkReport> = {};
  /** Person link reports of these Traduora users are refused (422). */
  refuseLinksOf = new Set<string>();
  /** The answers to person requests the fake recorded. */
  answers: PersonRequestAnswer[] = [];
  /** When set, reading the feed answers 410 with this position to continue from. */
  eventsGone: string | null = null;
  /** When set, reading the integration states answers 503. */
  integrationsFailing = false;
  /** The results of maintenance operations the fake recorded, by operation id. */
  managedResults: Record<string, unknown> = {};
  /** When set, the next answer to a person request fails with this problem (then the setting clears). */
  answerProblem: { status: number; code: string } | null = null;
  linkState = 'active';
  instanceStatus = 'active';
  entitlementSeq = 1;
  /** When set, the next calls fail as if the platform could not be reached. */
  unreachable = false;
  /** When set, calls answer `401 credential_revoked`. */
  revoked = false;
  /** The issuer the fake's documents name, and its key for provisioning intents. */
  readonly issuer = 'https://api.ever.test';
  readonly intentKid = 'intent-key-1';
  private readonly intentKeys = generateKeyPairSync('ed25519');
  /** The completions of provisioning intents the fake recorded, by intent id. */
  completions: Record<string, ProvisionComplete> = {};
  /** When set, the next completion fails with this problem (then the setting clears). */
  completeProblem: { status: number; code: string } | null = null;

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
    if (this.unreachable) {
      throw new Error('connect ECONNREFUSED');
    }
    if (this.revoked && name !== 'redeem') {
      throw new ProblemError(401, 'credential_revoked');
    }
  }

  names(): string[] {
    return this.calls.map(call => call.name);
  }

  /**
   * A provisioning intent as app.ever.co issues it (`ever.provision_intent.v1`, EdDSA with the fake's intent key), with
   * `claims` and `header` overriding the defaults; `key` signs it with another key.
   */
  intent(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key: KeyObject = this.intentKeys.privateKey): string {
    const now = Math.floor(Date.now() / 1000);
    const part = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const head = part({ alg: 'EdDSA', typ: 'ever-intent+jwt', kid: this.intentKid, ...header });
    const body = part({
      iss: this.issuer,
      aud: 'ever-connect:traduora',
      jti: `01JPROVISION${randomBytes(5).toString('hex').toUpperCase()}`,
      iat: now,
      exp: now + 600,
      typ: 'ever.provision_intent.v1',
      ever_purpose: 'intent',
      product: 'traduora',
      mode: 'handoff',
      org: { id: '01JMQCK0RG000000000000000B', handle: 'acme', display_name: 'Acme Translations' },
      person: { ever_id_sub: 'alice-subject' },
      instance_id: '01JMQCKINSTANCE0000000000A',
      return_to: 'https://app.ever.test/start/done',
      ...claims,
    });
    const signature = sign(null, Buffer.from(`${head}.${body}`, 'utf8'), key).toString('base64url');
    return `${head}.${body}.${signature}`;
  }

  /** The claims of an intent the fake made. */
  claimsOf(intent: string): Record<string, any> {
    return JSON.parse(Buffer.from(intent.split('.')[1], 'base64url').toString('utf8'));
  }

  entitlement(): StoredEntitlement {
    const now = Math.floor(Date.now() / 1000);
    return {
      jws: `header.payload-${this.entitlementSeq}.signature`,
      seq: this.entitlementSeq,
      iat: now,
      exp: now + 7 * 86400,
      graceS: 30 * 86400,
      tier: 'free',
    };
  }

  readonly factory: EverConnectClientFactory = options => {
    this.clients.push(options);
    const client: EverConnectPlatformClient = {
      redeem: async input => {
        this.record('redeem', { ...input });
        if (input.code !== this.code) {
          throw new ProblemError(422, 'code_invalid');
        }
        return {
          registryInstanceId: '01JMQCKINSTANCE0000000000A',
          kid: 'kid-1',
          status: this.redeemStatus,
          link: { id: '01JMQCKLINK000000000000000', orgId: '01JMQCK0RG000000000000000A', state: 'active', displayName: input.displayName },
        };
      },
      heartbeat: async body => this.record('heartbeat', body),
      self: async () => {
        this.record('self');
        return { status: this.instanceStatus, link: { id: '01JMQCKLINK000000000000000', state: this.linkState, displayName: 'Traduora' } };
      },
      entitlement: async (linkId, cached) => {
        this.record('entitlement', linkId, cached ? cached.seq : null);
        return cached && cached.seq >= this.entitlementSeq ? null : this.entitlement();
      },
      events: async (cursor, waitS) => {
        this.record('events', cursor, waitS);
        if (this.eventsGone) {
          // The position is older than what the platform keeps: continue from `lastId`
          throw Object.assign(new ProblemError(410, 'cursor_expired'), { lastId: this.eventsGone });
        }
        const events = this.events;
        this.events = [];
        return { events, lastId: events.length ? events[events.length - 1].id : cursor || 'cursor-0', hasMore: false };
      },
      ack: async lastId => this.record('ack', lastId),
      integrations: async () => {
        this.record('integrations');
        if (this.integrationsFailing) {
          throw new ProblemError(503, 'unavailable');
        }
        return { ...this.integrationStates };
      },
      consentUrl: async key => {
        this.record('consentUrl', key);
        return `https://app.ever.co/consent/${key}`;
      },
      disableIntegration: async (key, reason) => {
        this.record('disableIntegration', key, reason);
        delete this.integrationStates[key];
      },
      acceptIntegration: async (key, consentId, accepted) => {
        this.record('acceptIntegration', key, consentId, accepted);
        this.integrationStates[key] = { state: accepted ? 'enabled' : 'revoked', enabled: accepted, consentId, scopeVersion: 1 };
      },
      putPublicUrl: async url => this.record('putPublicUrl', url),
      deletePublicUrl: async () => this.record('deletePublicUrl'),
      statsLink: async body => this.record('statsLink', { statsInstanceId: body.statsInstanceId }),
      disconnect: async () => this.record('disconnect'),
      reportPersonLink: async link => {
        this.record('reportPersonLink', { ...link });
        if (this.refuseLinksOf.has(link.productUserRef)) {
          throw new ProblemError(422, 'schema_violation');
        }
        this.personLinks[link.productUserRef] = { ...link };
      },
      removePersonLink: async productUserRef => {
        this.record('removePersonLink', productUserRef);
        if (!this.personLinks[productUserRef]) {
          throw new ProblemError(404, 'not_found');
        }
        delete this.personLinks[productUserRef];
      },
      managedOperationResult: async (operationId, result) => {
        this.record('managedOperationResult', operationId, { ...result });
        this.managedResults[operationId] = { ...result };
      },
      intentKey: async kid => {
        this.record('intentKey', kid);
        if (kid !== this.intentKid) {
          return null;
        }
        const x = (this.intentKeys.publicKey.export({ format: 'jwk' }) as { x: string }).x;
        return { x, issuer: this.issuer };
      },
      completeProvisionIntent: async (jti, body) => {
        this.record('completeProvisionIntent', jti, { ...body });
        if (this.completeProblem) {
          const problem = this.completeProblem;
          this.completeProblem = null;
          throw new ProblemError(problem.status, problem.code);
        }
        const known = !!this.completions[jti];
        this.completions[jti] = { ...body };
        return { status: known ? 'already_completed' : 'completed', tenantLinkId: body.result === 'created' ? '01JMQCKLINK00000000000000P' : null };
      },
      answerPersonRequest: async answer => {
        this.record('answerPersonRequest', { ...answer });
        // As Ever Platform: an `exported` receipt names the https address of the product's export
        if (answer.result === 'exported' && !/^https:\/\/[^/@\s]+/.test(answer.exportUrl || '')) {
          throw new ProblemError(422, 'validation_failed');
        }
        if (this.answerProblem) {
          const problem = this.answerProblem;
          this.answerProblem = null;
          throw new ProblemError(problem.status, problem.code);
        }
        this.answers.push({ ...answer });
      },
    };
    return client;
  };
}
