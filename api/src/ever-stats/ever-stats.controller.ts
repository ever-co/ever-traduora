import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverPlatformException } from '../errors';
import { EverAdminGuard } from '../ever-instance/ever-admin.guard';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EVER_STATS_CLOCK, EverStatsClock, monthOf } from './ever-stats.clock';
import { EVER_STATS_CONFIG, EverStatsConfig } from './ever-stats.config';
import { STATS_REPORTS_KEPT, STATS_SEND_NOW_INTERVAL_MS } from './ever-stats.constants';
import { EverStatsEnabledRequest } from './ever-stats.dto';
import { EverStatsCollectorService } from './ever-stats-collector.service';
import { EverStatsSchedulerService, SendNowRefused } from './ever-stats-scheduler.service';
import { EverStatsSenderService } from './ever-stats-sender.service';

/** Why the statistics are on or off. */
export type StatsReason = 'env' | 'ui' | 'cloud-managed' | 'no-destination';

/** A stored report as the operator sees it (the exact bytes, the date, the answer). */
function reportView(row: EverStatsReport) {
  return {
    reportId: row.reportId,
    period: row.period,
    final: row.final === true,
    payload: row.payload || '',
    createdAt: row.createdAt,
    sentAt: row.sentAt ?? null,
    httpStatus: row.httpStatus ?? null,
    status: row.status,
    attempts: row.attempts || 0,
    error: row.error ?? null,
    hint: row.hint ?? null,
  };
}

const SEND_NOW_ANSWERS: Record<string, { status: HttpStatus; message: string }> = {
  stats_disabled: { status: HttpStatus.CONFLICT, message: 'Anonymous usage statistics are turned off' },
  no_destination: { status: HttpStatus.CONFLICT, message: 'The statistics address is not usable' },
  busy: { status: HttpStatus.CONFLICT, message: 'Another report is being sent' },
  refused_until_upgrade: { status: HttpStatus.CONFLICT, message: 'Ever Platform refused reports of this version until an upgrade' },
  rate_limited: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Send now can be used once every 10 minutes' },
};

/**
 * The routes of the anonymous usage statistics (`/api/v1/ever-stats/*`), present only when the module is loaded
 * (`TR_EVER_STATS_ENABLED=true`). `health` is public; every other route answers the operator of the installation only.
 * No answer ever contains the statistics private key.
 */
@Controller('api/v1/ever-stats')
@ApiTags('Ever Platform')
export class EverStatsController {
  constructor(
    @Inject(EVER_STATS_CONFIG) private readonly config: EverStatsConfig,
    @Inject(EVER_STATS_CLOCK) private readonly clock: EverStatsClock,
    private readonly instance: EverInstanceService,
    private readonly collector: EverStatsCollectorService,
    private readonly sender: EverStatsSenderService,
    private readonly scheduler: EverStatsSchedulerService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Whether the anonymous usage statistics module is loaded' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Loaded' })
  health() {
    return { data: { module: 'ever-stats', loaded: true } };
  }

  @Get('status')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'State of the anonymous usage statistics (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async status() {
    const record = await this.instance.read();
    const row = await this.scheduler.schedule.read();
    const uiOn = !record || record.statsEnabledUi !== false;
    const destinationUsable = this.config.apiUrl !== null;
    const enabled = uiOn && destinationUsable;
    let reason: StatsReason = 'env';
    if (this.instance.isCloudManaged()) reason = 'cloud-managed';
    else if (!uiOn) reason = 'ui';
    else if (!destinationUsable) reason = 'no-destination';
    return {
      data: {
        enabled,
        reason,
        toggleEnabled: uiOn,
        toggleReadOnly: this.instance.isCloudManaged(),
        destinationUsable,
        nextSendAt: enabled ? (row.nextSendAt ?? this.scheduler.nextAt ?? null) : null,
        lastSentAt: row.lastSentAt ?? null,
        lastStatus: row.lastStatus ?? null,
        instanceId: record ? record.instanceId : null,
        keyId: record ? record.statsKeyId : null,
        keyState: record ? this.instance.keyState(record) : null,
        country: this.config.country,
        installSource: this.config.installSource,
        version: this.config.release.version,
        channel: this.config.release.channel,
      },
    };
  }

  /** "What is sent": the report built now, checked, never signed, stored or sent. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'The report that would be sent now; nothing is sent (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async preview() {
    const record = await this.instance.ensure();
    const now = this.clock();
    const built = await this.collector.build({ instanceId: record.instanceId, period: monthOf(now), final: false, now });
    return { data: { valid: built.error === null, error: built.error, payload: built.report } };
  }

  @Get('reports')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'The last reports, with the exact bytes sent (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async reports(@Query('limit') limit?: string) {
    const parsed = limit === undefined ? STATS_REPORTS_KEPT : Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > STATS_REPORTS_KEPT) {
      throw new BadRequestException(`limit is a whole number from 1 to ${STATS_REPORTS_KEPT}`);
    }
    const rows = await this.sender.reports(parsed);
    return { data: rows.map(reportView) };
  }

  /** *Send now*: 409 while the switch is off or another report is being sent, 429 more than once per 10 minutes. */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Send the report of the running month now (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Sent, or the attempt recorded' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Nothing was sent' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Used less than 10 minutes ago' })
  async send() {
    try {
      const row = await this.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS);
      return { data: reportView(row) };
    } catch (error) {
      if (error instanceof SendNowRefused) {
        const answer = SEND_NOW_ANSWERS[error.reason];
        throw new EverPlatformException(answer.status, error.reason, answer.message);
      }
      throw error;
    }
  }

  @Put('enabled')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Turn the anonymous usage statistics on or off (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Saved' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Managed by the deployment' })
  async setEnabled(@Req() req, @Body() body: EverStatsEnabledRequest) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be true or false');
    }
    const enabled = await this.instance.setStatsEnabledUi(req.user.id, body.enabled);
    return { data: { enabled } };
  }

  /** A new instance id and a new statistics key; the stored report history is cleared. */
  @Post('reset-identity')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Reset the anonymous identity of this installation (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Reset' })
  async resetIdentity(@Req() req) {
    const record = await this.instance.resetIdentity(req.user.id);
    await this.scheduler.afterIdentityReset();
    return { data: this.instance.publicView(record) };
  }
}
