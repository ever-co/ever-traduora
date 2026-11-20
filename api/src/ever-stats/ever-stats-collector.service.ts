import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { And, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Project } from '../entity/project.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import { User } from '../entity/user.entity';
import { dayOf, monthBounds } from './ever-stats.clock';
import { EVER_STATS_CONFIG, EverStatsConfig } from './ever-stats.config';
import { MODULE_VERSION, PRODUCT, STATS_SCHEMA_ID } from './ever-stats.constants';
import { StatsCheck, StatsValidator } from './ever-stats-validator';

/** The figures a report is built from: row counts and one monthly aggregate, nothing else. */
export interface StatsCounters {
  users: number;
  projects: number;
  terms: number;
  translations: number;
  locales: number;
  projectClients: number;
  translationsChanged: number;
}

/** A report built and checked: `bytes` is what is signed, stored and sent, unchanged. */
export interface BuiltStatsReport {
  report: Record<string, unknown>;
  text: string;
  bytes: Buffer;
  check: StatsCheck;
  /** `schema_violation:<path>:<code>` (the path redacted) when the checks refused the report. */
  error: string | null;
}

const MAX_COUNT = 1000000000;

/** A count as a report integer: whole, within `0..1 000 000 000`. */
function count(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_COUNT, Math.floor(n));
}

/**
 * Builds the `ever.stats.v1` report of this installation: six row counts (users, projects, terms, translations, project
 * locales, API clients), the number of translations changed in the month, and two configuration switches. It reads no
 * name, e-mail, key, term or translation value. Then it checks the exact bytes; a report that fails the checks is never
 * signed or sent.
 */
@Injectable()
export class EverStatsCollectorService {
  readonly validator = new StatsValidator();

  constructor(
    @Inject(EVER_STATS_CONFIG) private readonly config: EverStatsConfig,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(Translation) private readonly translations: Repository<Translation>,
    @InjectRepository(ProjectLocale) private readonly projectLocales: Repository<ProjectLocale>,
    @InjectRepository(ProjectClient) private readonly projectClients: Repository<ProjectClient>,
  ) {}

  /** Counts the rows, and the translations changed during `period` (`YYYY-MM`, UTC). */
  async readCounters(period: string): Promise<StatsCounters> {
    const { start, end } = monthBounds(period);
    const [users, projects, terms, translations, locales, projectClients, translationsChanged] = await Promise.all([
      this.users.count(),
      this.projects.count(),
      this.terms.count(),
      this.translations.count(),
      this.projectLocales.count(),
      this.projectClients.count(),
      this.translations.count({ where: { date: { modified: And(MoreThanOrEqual(start), LessThan(end)) } } }),
    ]);
    return { users, projects, terms, translations, locales, projectClients, translationsChanged };
  }

  /** The report body: the envelope, then `counts`, `features` and `aggregates` (allow-listed keys only). */
  assemble(input: {
    instanceId: string;
    period: string;
    final: boolean;
    counters: StatsCounters;
    now: number;
    reportId?: string;
  }): Record<string, unknown> {
    const { counters } = input;
    return {
      schema: STATS_SCHEMA_ID,
      report_id: input.reportId || randomUUID(),
      instance_id: input.instanceId,
      sent_at: dayOf(input.now),
      module_version: MODULE_VERSION,
      product: PRODUCT,
      instance_kind: 'backend',
      serves: [PRODUCT],
      version: this.config.release.version,
      channel: this.config.release.channel,
      install_source: this.config.installSource,
      country: this.config.country,
      period: input.period,
      final: input.final,
      counts: {
        users: count(counters.users),
        projects: count(counters.projects),
        terms: count(counters.terms),
        translations: count(counters.translations),
        locales: count(counters.locales),
        project_clients: count(counters.projectClients),
      },
      features: {
        google_login: this.config.features.google_login === true,
        signups_enabled: this.config.features.signups_enabled === true,
      },
      aggregates: {
        translations_changed: count(counters.translationsChanged),
      },
    };
  }

  /** Serialises `report` once and checks those bytes. */
  check(report: Record<string, unknown>): BuiltStatsReport {
    const text = JSON.stringify(report);
    const bytes = Buffer.from(text, 'utf8');
    const check = this.validator.checkBytes(bytes, PRODUCT);
    let error: string | null = null;
    if (!check.ok) {
      const first = check.errors?.[0];
      const reason = check.status === 413 ? 'too_large' : 'schema_violation';
      error = `${reason}:${this.validator.redactPath(first?.path ?? '') || '(body)'}:${first?.code ?? 'type'}`;
    }
    return { report, text, bytes, check, error };
  }

  /** Builds and checks the report of `period`. */
  async build(input: { instanceId: string; period: string; final: boolean; now: number }): Promise<BuiltStatsReport> {
    const counters = await this.readCounters(input.period);
    return this.check(this.assemble({ ...input, counters }));
  }
}
