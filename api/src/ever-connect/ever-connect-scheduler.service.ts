import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
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
  /** This process, as the lease names it (random, nothing else). */
  readonly holderId = randomUUID();

  constructor(
    @InjectRepository(EverConnectConnection) private readonly connections: Repository<EverConnectConnection>,
    @Inject(EVER_CONNECT_SETTINGS) private readonly settings: EverConnectSettings,
    private readonly connect: EverConnectService,
    @Optional() @Inject(EVER_CONNECT_AUTOSTART) private readonly autostart?: boolean,
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
      work()
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
    const connection = await this.connect.read();
    if (!this.connect.isLive(connection) || !this.settings.apiUrl) {
      this.lastFeedAt = 0;
      return;
    }
    const now = Date.now();
    if (!(await this.acquire(now))) {
      return;
    }
    try {
      if (!connection.nextHeartbeatAt || connection.nextHeartbeatAt <= now) {
        await this.connect.heartbeat();
        await this.connections.update({ id: CONNECTION_ID }, { nextHeartbeatAt: now + HEARTBEAT_MS });
      }
      if (connection.status === 'active' && (!connection.nextEntitlementAt || connection.nextEntitlementAt <= now)) {
        await this.connect.refreshEntitlements().catch(() => undefined);
        await this.connections.update({ id: CONNECTION_ID }, { nextEntitlementAt: now + ENTITLEMENT_MS });
      }
      const feedDue = this.settings.feedMode === 'longpoll' || now - this.lastFeedAt >= INTERVAL_FEED_MS;
      if (connection.status === 'active' && feedDue) {
        this.lastFeedAt = now;
        await this.readFeed(this.settings.feedMode === 'longpoll' ? LONG_POLL_S : 0);
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
        await this.applyTypes(['ever.consent', 'ever.entitlements', 'ever.registry.tenant_link']);
        const lastId = (error as { lastId?: string }).lastId || null;
        if (lastId) await live.client.ack(lastId);
        await this.connections.update({ id: CONNECTION_ID }, { feedCursor: lastId });
        return 0;
      }
      await this.connect.handleCallError(error, 'feed');
      return 0;
    }
    if (page.events.length) {
      await this.applyTypes(page.events.map(event => event.type));
      await live.client.ack(page.lastId);
    }
    if (page.lastId && page.lastId !== live.connection.feedCursor) {
      await this.connections.update({ id: CONNECTION_ID }, { feedCursor: page.lastId });
    }
    return page.events.length;
  }

  private async applyTypes(types: string[]): Promise<void> {
    const has = (prefix: string) => types.some(type => type.startsWith(prefix));
    if (types.includes('ever.registry.instance.revoked')) {
      await this.connect.endedByPlatform('revoked', 'feed');
      return;
    }
    if (types.includes('ever.registry.instance.disconnected')) {
      await this.connect.endedByPlatform('disconnected', 'feed');
      return;
    }
    if (has('ever.registry.tenant_link')) {
      await this.connect.refreshLink().catch(error => this.connect.handleCallError(error, 'link'));
    }
    if (has('ever.consent')) {
      await this.connect.refreshIntegrations().catch(error => this.connect.handleCallError(error, 'integrations'));
    }
    if (has('ever.entitlements') || has('ever.registry.tenant_link')) {
      await this.connect.refreshEntitlements().catch(() => undefined);
    }
    const known = ['ever.registry.instance.', 'ever.registry.tenant_link', 'ever.consent', 'ever.entitlements'];
    for (const type of types) {
      if (!known.some(prefix => type.startsWith(prefix))) {
        this.logger.log(`ever_connect.feed event=${type.slice(0, 96)} outcome=acknowledged`);
      }
    }
  }
}
