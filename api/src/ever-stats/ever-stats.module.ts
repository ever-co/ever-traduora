import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverStatsSchedule } from '../entity/ever-stats-schedule.entity';
import { Project } from '../entity/project.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import { User } from '../entity/user.entity';
import { EverInstanceModule } from '../ever-instance/ever-instance.module';
import { EVER_STATS_CLOCK, systemClock } from './ever-stats.clock';
import { EVER_STATS_CONFIG, readEverStatsConfig } from './ever-stats.config';
import { EverStatsController } from './ever-stats.controller';
import { EverStatsCollectorService } from './ever-stats-collector.service';
import { EVER_STATS_AUTOSTART, EverStatsSchedulerService } from './ever-stats-scheduler.service';
import { defaultStatsFetch, EVER_STATS_FETCH, EverStatsSenderService } from './ever-stats-sender.service';

/**
 * Anonymous usage statistics: one `ever.stats.v1` report a day about this installation as a whole (row counts and two
 * configuration switches only), signed with its own statistics key and sent to Ever Platform.
 *
 * Loaded unless `TR_EVER_STATS_ENABLED=false` (see `app.module.ts`); the operator can also turn it off on the
 * Statistics page. See `docs/ever-platform/anonymous-usage-statistics.md`.
 */
@Module({
  imports: [
    EverInstanceModule,
    TypeOrmModule.forFeature([EverStatsReport, EverStatsSchedule, User, Project, Term, Translation, ProjectLocale, ProjectClient]),
  ],
  controllers: [EverStatsController],
  providers: [
    { provide: EVER_STATS_CONFIG, useFactory: () => readEverStatsConfig() },
    { provide: EVER_STATS_CLOCK, useValue: systemClock },
    { provide: EVER_STATS_FETCH, useValue: defaultStatsFetch },
    { provide: EVER_STATS_AUTOSTART, useValue: true },
    EverStatsCollectorService,
    EverStatsSenderService,
    EverStatsSchedulerService,
  ],
  exports: [EVER_STATS_CONFIG, EverStatsCollectorService, EverStatsSenderService, EverStatsSchedulerService],
})
export class EverStatsModule {}
