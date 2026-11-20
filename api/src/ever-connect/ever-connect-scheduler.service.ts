import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectManagedService } from './ever-connect-managed.service';
import { EverConnectPersonService } from './ever-connect-person.service';
import { problemOf } from './ever-connect-platform.client';
import { CONNECTION_ID, EverConnectService } from './ever-connect.service';
import { EVER_CONNECT_SETTINGS, EverConnectSettings } from './ever-connect.settings';

/** `false` keeps the timers from starting at boot (tests drive `tick()` themselves). */
export const EVER_CONNECT_AUTOSTART = Symbol('ever connect autostart');

const MINUTE_MS = 60 * 1000;
const HEARTBEAT_MS = 24 * 60 * MINUTE_MS;
const ENTITLEMENT_MS = 6 * 60 * MINUTE_MS;
const INTERVAL_FEED_MS = 15 * MINUTE_MS;
const LONG_POLL_S = 25;
const LEASE_MS = 2 * MINUTE_MS;

/**
 * The background calls of a connected installation: the heartbeat (within 5 minutes of connecting, then once a day),
 * the entitlement documents (every 6 hours) and the event feed (a long poll, or one read every 15 minutes). A
 * `setTimeout` chain that never keeps the process alive. Before an operator connects, and after a disconnect or a
 * revocation, it reads its own row once a minute and calls nothing. Several API processes share a lease on the
 * connection row, so one of them makes the calls.
 */
@Injectable()
export class EverConnectSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EverConnectSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastFeedAt = 0;
  private running: Promise<void> | null = null;
  /** Whether the last feed page's handlers failed (its state refresh may not have been applied). */
  private feedFailed = false;
  /** This process, as the lease names it (random, nothing else). */
  readonly holderId = randomUUID();

  constructor(
    @InjectRepository(EverConnectConnection) private readonly connections: Repository<EverConnectConnection>,
    @Inject(EVER_CONNECT_SETTINGS) private readonly settings: EverConnectSettings,
    private readonly connect: EverConnectService,
    @Optional() @Inject(EVER_CONNECT_AUTOSTART) private readonly autostart?: boolean,
    @Optional() private readonly person?: EverConnectPersonService,
    @Optional() private readonly managed?: EverConnectManagedService,
  ) {}

  onModuleInit(): void {
    if (this.autostart === false) {
      return;
    }
    // The first look happens a moment after the start, never during it
    this.arm(10 * 1000, () => this.boot());
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(delayMs: number, work: () => Promise<void> = () => this.tick()): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void work()
        .catch(error => this.logger.warn(`ever_connect.scheduler error=${(error && error.name) || 'error'}`))
        .then(() => {
          if (!this.timer) this.arm(this.nextDelay());
        });
    }, delayMs);
    this.timer.unref?.();
  }

  private nextDelay(): number {
    return this.settings.feedMode === 'longpoll' && this.lastFeedAt > 0 ? 1000 : MINUTE_MS;
  }

  /** At boot: the connect code of `TR_EVER_CONNECT_CODE`, when one is set and was never tried. */
  async boot(): Promise<void> {
    await this.connect.connectFromEnv();
  }

  /** Whether the connection with this key is still the active one. */
  private async isCurrent(kid: string | null): Promise<boolean> {
    const current = await this.connect.read();
    return !!current && current.status === 'active' && current.kid === kid;
  }

  /** Takes the lease of the background calls when it is free or expired (or already ours). */
  private async acquire(now: number): Promise<boolean> {
    const result = await this.connections
      .createQueryBuilder()
      .update(EverConnectConnection)
      .set({ leasedBy: this.holderId, leaseUntil: now + LEASE_MS })
      .where('id = :id', { id: CONNECTION_ID })
      .andWhere('(lease_until IS NULL OR lease_until < :now OR leased_by = :me)', { now, me: this.holderId })
      .execute();
    if (result.affected === undefined || result.affected === null) {
      const row = await this.connections.findOne({ where: { id: CONNECTION_ID } });
      return !!row && row.leasedBy === this.holderId;
    }
    return result.affected === 1;
  }

  private async release(): Promise<void> {
    await this.connections
      .createQueryBuilder()
      .update(EverConnectConnection)
      .set({ leasedBy: null, leaseUntil: null })
      .where('id = :id', { id: CONNECTION_ID })
      .andWhere('leased_by = :me', { me: this.holderId })
      .execute();
  }

  /** One round of the due calls. Exposed for tests; the timer calls it. */
  tick(): Promise<void> {
    if (!this.running) {
      const done = () => {
        this.running = null;
      };
      this.running = this.round().then(done, error => {
        done();
        throw error;
      });
    }
    return this.running;
  }

  private async round(): Promise<void> {
    // Expired exports and old receipts go, connected or not
    if (this.person) {
      await this.person.sweep().catch(error => this.logger.warn(`ever_connect.person_sweep error=${(error && error.name) || 'error'}`));
    }
    const before = await this.connect.read();
    if (!this.connect.isLive(before) || !this.settings.apiUrl) {
      this.lastFeedAt = 0;
      return;
    }
    const now = Date.now();
    if (!(await this.acquire(now))) {
      return;
    }
    try {
      // Read again under the lease: another process may have made the due calls meanwhile
      const connection = await this.connect.read();
      if (!this.connect.isLive(connection)) {
        return;
      }
      if (connection.status === 'pending_approval') {
        // Until an owner or admin approves it, Ever Platform answers only the installation's own state
        await this.connect.refreshSelf().catch(error => this.connect.handleCallError(error, 'state', connection.kid));
        return;
      }
      if (!connection.nextHeartbeatAt || connection.nextHeartbeatAt <= now) {
        await this.connect.heartbeat();
        await this.connections.update({ id: CONNECTION_ID, kid: connection.kid }, { nextHeartbeatAt: now + HEARTBEAT_MS });
      }
      if (connection.status === 'active' && (!connection.nextEntitlementAt || connection.nextEntitlementAt <= now)) {
        await this.connect.refreshEntitlements().catch(() => undefined);
        await this.connections.update({ id: CONNECTION_ID, kid: connection.kid }, { nextEntitlementAt: now + ENTITLEMENT_MS });
      }
      const feedDue = this.settings.feedMode === 'longpoll' || now - this.lastFeedAt >= INTERVAL_FEED_MS;
      if (connection.status === 'active' && feedDue) {
        this.lastFeedAt = now;
        await this.readFeed(this.settings.feedMode === 'longpoll' ? LONG_POLL_S : 0);
      }
      if (connection.status === 'active' && this.person) {
        await this.person.syncLinks().catch(error => this.connect.handleCallError(error, 'person_link', connection.kid));
      }
      if (connection.status === 'active' && this.managed) {
        const live = await this.connect.liveClient();
        // Only for the connection that is still active now (the feed may have ended it)
        if (live && live.connection.status === 'active' && live.connection.kid === connection.kid) {
          // Not while a state refresh of the feed failed: a revoked consent may not have been applied yet
          if (!this.feedFailed) {
            await this.managed
              .runDue(live.client, connection.kid, Date.now(), () => this.isCurrent(connection.kid))
              .catch(error => this.connect.handleCallError(error, 'managed', connection.kid));
          }
        }
      }
    } finally {
      await this.release();
    }
  }

  /**
   * One page of the event feed: each event updates what it is about (integration states, entitlement documents, the
   * link, the connection), then the page is acknowledged and the position stored. An event repeated after a restart
   * changes nothing: every handler reads the state again from Ever Platform.
   */
  async readFeed(waitS: number): Promise<number> {
    const live = await this.connect.liveClient();
    if (!live) return 0;
    let page;
    try {
      page = await live.client.events(live.connection.feedCursor, waitS);
    } catch (error) {
      const problem = problemOf(error);
      if (problem && problem.status === 410) {
        // The position is older than what Ever Platform keeps: read the state again, then continue from where it says
        await this.applyTypes(['ever.consent', 'ever.entitlements', 'ever.registry.tenant_link'], live.connection.kid);
        const lastId = (error as { lastId?: string }).lastId || null;
        if (lastId) await live.client.ack(lastId);
        await this.connections.update({ id: CONNECTION_ID }, { feedCursor: lastId });
        // The state was read again in full: due work no longer waits for an earlier failed page
        this.feedFailed = false;
        return 0;
      }
      await this.connect.handleCallError(error, 'feed', live.connection.kid);
      return 0;
    }
    if (!page.events.length) {
      this.feedFailed = false;
    }
    if (page.events.length) {
      // A person's answer that must be retried never holds back the state refresh (a revoked consent applies at once);
      // the page is acknowledged only once every handler went through
      const failures: unknown[] = [];
      if (this.person) {
        try {
          await this.person.handleEvents(live.client, page.events);
        } catch (error) {
          failures.push(error);
        }
        if (page.events.some(event => event.type.startsWith('ever.consent'))) {
          // The ever_id_login consent decides whether person links are reported
          this.person.requestSync();
        }
      }
      try {
        await this.applyTypes(
          page.events.map(event => event.type),
          live.connection.kid,
        );
        // After the state refresh: a consent in the same page counts for a request that follows it, and a page that
        // ended the connection runs no maintenance work
        if (this.managed && !failures.length && (await this.isCurrent(live.connection.kid))) {
          await this.managed.handleEvents(live.client, page.events, live.connection.kid, () => this.isCurrent(live.connection.kid));
        }
      } catch (error) {
        failures.push(error);
      }
      this.feedFailed = failures.length > 0;
      if (failures.length) {
        // Not acknowledged: the same page comes again with the next read, and every handler reads the state again.
        // Each error is handled (a revoked credential ends the connection whichever handler met it)
        for (const failure of failures) {
          await this.connect.handleCallError(failure, 'feed_apply', live.connection.kid);
        }
        return 0;
      }
      await live.client.ack(page.lastId);
    }
    if (page.lastId && page.lastId !== live.connection.feedCursor) {
      // Only from the position this read started at: a later reader's newer position is never moved back
      await this.connections.update(
        { id: CONNECTION_ID, kid: live.connection.kid, feedCursor: live.connection.feedCursor === null ? IsNull() : live.connection.feedCursor },
        { feedCursor: page.lastId },
      );
    }
    return page.events.length;
  }

  /**
   * Applies what a page (or a full re-read) is about. `kid` is the key of the connection the page was read for: a page
   * read before a disconnect and a new connect never ends or changes the connection that replaced it.
   */
  private async applyTypes(types: string[], kid: string | null): Promise<void> {
    const has = (prefix: string) => types.some(type => type.startsWith(prefix));
    if (types.includes('ever.registry.instance.revoked')) {
      await this.connect.endedByPlatform('revoked', 'feed', kid);
      return;
    }
    if (types.includes('ever.registry.instance.disconnected')) {
      await this.connect.endedByPlatform('disconnected', 'feed', kid);
      return;
    }
    if (has('ever.registry.tenant_link')) {
      await this.connect.refreshSelf();
    }
    if (has('ever.consent')) {
      await this.connect.refreshIntegrations();
    }
    if (has('ever.entitlements') || has('ever.registry.tenant_link')) {
      await this.connect.refreshEntitlements('system', true);
    }
    const known = ['ever.registry.instance.', 'ever.registry.tenant_link', 'ever.consent', 'ever.entitlements'];
    if (this.person) known.push('ever.registry.person.deletion_requested', 'ever.registry.person.export_requested');
    if (this.managed) known.push('ever.registry.managed_operation.requested');
    for (const type of types) {
      if (!known.some(prefix => type.startsWith(prefix))) {
        this.logger.log(`ever_connect.feed event=${type.slice(0, 96)} outcome=acknowledged`);
      }
    }
  }
}
