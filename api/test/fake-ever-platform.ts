import { ProblemError } from '@ever-co/connect-sdk';
import {
  EverConnectClientFactory,
  EverConnectClientOptions,
  EverConnectPlatformClient,
  PersonLinkReport,
  PersonRequestAnswer,
  PlatformEvent,
  PlatformIntegrationState,
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
  /** When set, the next answer to a person request fails with this problem (then the setting clears). */
  answerProblem: { status: number; code: string } | null = null;
  linkState = 'active';
  instanceStatus = 'active';
  entitlementSeq = 1;
  /** When set, the next calls fail as if the platform could not be reached. */
  unreachable = false;
  /** When set, calls answer `401 credential_revoked`. */
  revoked = false;

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
        const events = this.events;
        this.events = [];
        return { events, lastId: events.length ? events[events.length - 1].id : cursor || 'cursor-0', hasMore: false };
      },
      ack: async lastId => this.record('ack', lastId),
      integrations: async () => {
        this.record('integrations');
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
      answerPersonRequest: async answer => {
        this.record('answerPersonRequest', { ...answer });
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
