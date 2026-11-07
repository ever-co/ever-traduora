import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { And, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import { User } from '../entity/user.entity';
import { dayOf, periodRange } from './ever-stats.clock';
import { MODULE_VERSION, PRODUCT, STATS_SCHEMA_ID } from './ever-stats.constants';
import { EVER_STATS_SETTINGS, EverStatsSettings } from './ever-stats.settings';
import { StatsCheck, StatsValidator } from './ever-stats-validator';

/** The instance-wide numbers a report is built from. */
export interface StatsNumbers {
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

const MAX_COUNT = 1_000_000_000;

/** A count as a report integer: whole, within `0..1 000 000 000`. */
function count(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_COUNT, Math.floor(n));
}

/**
 * Builds the `ever.stats.v1` report of this installation: six row counts and one monthly count, each a single
 * aggregate statement on an existing table, and two switches of the configuration. It reads no name, e-mail, term,
 * translation value, key or secret. The report's exact bytes are checked; a report that fails is never signed or sent.
 */
@Injectable()
export class EverStatsCollectorService {
  readonly validator = new StatsValidator();

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(Translation) private readonly translations: Repository<Translation>,
    @InjectRepository(ProjectLocale) private readonly projectLocales: Repository<ProjectLocale>,
    @InjectRepository(ProjectClient) private readonly projectClients: Repository<ProjectClient>,
    @Inject(EVER_STATS_SETTINGS) private readonly settings: EverStatsSettings,
  ) {}

  /**
   * The counts: every row of `user`, `project`, `term`, `translation`, `project_locale` (the locales in use) and
   * `project_client`, and the translations whose modification time falls in `period` (a calendar month, UTC).
   */
  async readNumbers(period: string): Promise<StatsNumbers> {
    const { start, end } = periodRange(period);
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
  assemble(input: { instanceId: string; period: string; final: boolean; numbers: StatsNumbers; now: number; reportId?: string }): Record<string, unknown> {
    const { numbers } = input;
    const features = this.settings.features();
    return {
      schema: STATS_SCHEMA_ID,
      report_id: input.reportId ?? randomUUID(),
      instance_id: input.instanceId,
      sent_at: dayOf(input.now),
      module_version: MODULE_VERSION,
      product: PRODUCT,
      instance_kind: 'backend',
      serves: [PRODUCT],
      version: this.settings.release.version,
      channel: this.settings.release.channel,
      install_source: this.settings.installSource,
      country: this.settings.country,
      period: input.period,
      final: input.final,
      counts: {
        users: count(numbers.users),
        projects: count(numbers.projects),
        terms: count(numbers.terms),
        translations: count(numbers.translations),
        locales: count(numbers.locales),
        project_clients: count(numbers.projectClients),
      },
      features: {
        google_login: features.google_login === true,
        signups_enabled: features.signups_enabled === true,
      },
      aggregates: {
        translations_changed: count(numbers.translationsChanged),
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
    const numbers = await this.readNumbers(input.period);
    return this.check(this.assemble({ ...input, numbers }));
  }
}
