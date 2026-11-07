import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverPlatformException } from '../errors';
import { EverAdminGuard } from '../ever-instance/ever-admin.guard';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EVER_STATS_CLOCK, EverStatsClock, monthOf } from './ever-stats.clock';
import { MODULE_VERSION, STATS_REPORTS_KEPT, STATS_SEND_NOW_INTERVAL_MS } from './ever-stats.constants';
import { EVER_STATS_SETTINGS, EverStatsSettings } from './ever-stats.settings';
import { EverStatsCollectorService } from './ever-stats-collector.service';
import { EverStatsSchedulerService, SendNowRefused } from './ever-stats-scheduler.service';
import { EverStatsSenderService } from './ever-stats-sender.service';
import { EverStatsReportDTO, EverStatsStatusDTO, SetStatsEnabledRequest } from './dto/ever-stats.dto';

const iso = (value: Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/** A stored report as the operator sees it (the exact bytes, the date, the answer). */
function reportView(row: EverStatsReport): EverStatsReportDTO {
  return {
    reportId: row.id,
    period: row.period,
    final: row.final === true,
    payload: row.payload ?? '',
    signature: row.signature ?? '',
    createdAt: iso(row.createdAt),
    sentAt: iso(row.sentAt),
    httpStatus: row.httpStatus ?? null,
    status: row.status,
    attempts: row.attempts ?? 0,
    error: row.error ?? null,
    hint: row.hint ?? null,
  };
}

/**
 * The routes of the anonymous usage statistics (`/api/v1/ever-stats/*`). `health` answers anyone (it only says the
 * module is loaded); every other route answers the operator of the installation only, and 403 to any other user or
 * API client. No answer ever contains the statistics private key. With TR_EVER_STATS_ENABLED=false none of them exists.
 */
@Controller('api/v1/ever-stats')
@ApiTags('Ever Platform')
export class EverStatsController {
  constructor(
    @Inject(EVER_STATS_SETTINGS) private readonly settings: EverStatsSettings,
    @Inject(EVER_STATS_CLOCK) private readonly clock: EverStatsClock,
    private readonly instance: EverInstanceService,
    private readonly collector: EverStatsCollectorService,
    private readonly sender: EverStatsSenderService,
    private readonly scheduler: EverStatsSchedulerService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Whether the anonymous usage statistics are loaded (404 when TR_EVER_STATS_ENABLED=false)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Loaded' })
  health() {
    return { data: { module: 'ever-stats', loaded: true } };
  }

  @Get('status')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'State and reason, next and last send, instance id, key id, country and install source' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: EverStatsStatusDTO })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not the operator of this installation' })
  async status(): Promise<{ data: EverStatsStatusDTO }> {
    const record = await this.instance.ensure();
    const schedule = await this.scheduler.readSchedule();
    const toggleEnabled = record.statsEnabledUi !== false;
    const cloud = this.instance.isCloudManaged();
    const destinationUsable = this.settings.apiUrl !== null;
    const enabled = toggleEnabled && destinationUsable;
    let reason: EverStatsStatusDTO['reason'] = 'env';
    if (cloud) reason = 'cloud-managed';
    else if (!toggleEnabled) reason = 'ui';
    const nextSendAt = enabled ? (iso(schedule.nextSendAt) ?? (this.scheduler.nextAt ? new Date(this.scheduler.nextAt).toISOString() : null)) : null;
    return {
      data: {
        enabled,
        reason,
        toggleEnabled,
        toggleReadOnly: cloud,
        destinationUsable,
        nextSendAt,
        lastSentAt: iso(schedule.lastSentAt),
        lastStatus: schedule.lastStatus ?? null,
        refusedUntilUpgrade: schedule.blockedModuleVersion === MODULE_VERSION,
        instanceId: record.instanceId,
        keyId: record.statsKeyId,
        keyState: this.instance.keyState(record),
        country: this.settings.country,
        installSource: this.settings.installSource,
        version: this.settings.release.version,
        channel: this.settings.release.channel,
        moduleVersion: MODULE_VERSION,
      },
    };
  }

  /** "What is sent": the report built now, checked, never signed, stored or sent. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'What is sent: the report built now, without sending or storing it' })
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
  @ApiOperation({ summary: 'The last reports: the exact bytes, date, status and answer (at most 12 are kept)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: EverStatsReportDTO, isArray: true })
  async reports(@Query('limit') limit?: string) {
    const parsed = limit === undefined ? STATS_REPORTS_KEPT : Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > STATS_REPORTS_KEPT) {
      throw new EverPlatformException(HttpStatus.BAD_REQUEST, 'invalid_limit', `limit is a whole number from 1 to ${STATS_REPORTS_KEPT}`);
    }
    const rows = await this.sender.reports(parsed);
    return { data: rows.map(reportView) };
  }

  /**
   * *Send now*: 409 while the switch is off, while another report is being sent, and after Ever Platform refused this
   * module version until it is upgraded; at most once per 10 minutes (429).
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Send now (409 while switched off or refused until an upgrade; once per 10 minutes)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Sent (or attempted)', type: EverStatsReportDTO })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Nothing was sent' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Send now was used less than 10 minutes ago' })
  async send() {
    try {
      const result = await this.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS);
      return { data: reportView(result.row) };
    } catch (error) {
      if (error instanceof SendNowRefused) {
        if (error.code === 'rate_limited') {
          throw new EverPlatformException(HttpStatus.TOO_MANY_REQUESTS, error.code, 'Send now can be used once every 10 minutes.');
        }
        throw new EverPlatformException(HttpStatus.CONFLICT, error.code, 'Nothing was sent.');
      }
      throw error;
    }
  }

  @Put('enabled')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: "The operator's switch (409 cloud-managed on Ever Cloud)" })
  @ApiResponse({ status: HttpStatus.OK, description: 'Stored' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Managed by Ever Cloud' })
  async setEnabled(@Req() req, @Body() body: SetStatsEnabledRequest) {
    if (typeof body?.enabled !== 'boolean') {
      throw new EverPlatformException(HttpStatus.BAD_REQUEST, 'invalid_enabled', 'enabled must be true or false');
    }
    const record = await this.scheduler.setEnabled(req.user.id, body.enabled);
    return { data: { enabled: record.statsEnabledUi !== false } };
  }

  /** A new instance id and a new statistics key; the stored report history is cleared. */
  @Post('reset-identity')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Reset instance identity: a new instance id and statistics key' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Reset' })
  async resetIdentity(@Req() req) {
    const record = await this.scheduler.resetIdentity(req.user.id);
    return { data: this.instance.publicView(record) };
  }
}
