import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EverAdminGuard } from '../ever-instance/ever-admin.guard';
import { EverConnectAuditService } from './ever-connect-audit.service';
import { EverConnectManagedService } from './ever-connect-managed.service';
import { EverConnectAcceptRequest, EverConnectConnectRequest, EverConnectManagedRequest, EverConnectPublicUrlRequest } from './ever-connect.dto';
import { EverConnectService } from './ever-connect.service';
import { Access } from '../access/access.decorator';

/** Who acts, as the audit trail names them: the user id, never an e-mail. */
const actor = (req: { user?: { id?: string } }) => (req.user && req.user.id ? `user:${req.user.id}` : 'unknown');

/**
 * The routes of the Ever Platform connection (`/api/v1/ever-connect/*`), present only when the module is loaded
 * (`TR_EVER_CONNECT_ENABLED=true`). `health` is public; every other route answers the operator of the installation only.
 * No answer ever contains a key, a token or an entitlement document.
 */
@Controller('api/v1/ever-connect')
@ApiTags('Ever Platform')
export class EverConnectController {
  constructor(
    private readonly connect: EverConnectService,
    private readonly audit: EverConnectAuditService,
    private readonly managed: EverConnectManagedService,
  ) {}

  @Access('operator')
  @Get('managed')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The opt-in to maintenance operations and their history (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async managedView() {
    return { data: await this.managed.view() };
  }

  @Access('operator')
  @Put('managed')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Opt in or out of maintenance operations, their kinds, windows and backup directory (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Saved' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'A kind, window or directory this installation cannot use' })
  async managedUpdate(@Req() req, @Body() body: EverConnectManagedRequest) {
    return { data: await this.managed.update(body || {}, actor(req)) };
  }

  @Access('public')
  @Get('health')
  @ApiOperation({ summary: 'Whether the Ever Platform connection module is loaded' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Loaded' })
  health() {
    return { data: { module: 'ever-connect', loaded: true } };
  }

  @Access('operator')
  @Get('status')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'State of the Ever Platform connection (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async status() {
    return { data: await this.connect.status() };
  }

  @Access('operator')
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Connect this installation with a connect code (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Connected' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Already connected, or TR_SECRET is not set' })
  async connectInstance(@Req() req, @Body() body: EverConnectConnectRequest) {
    return { data: await this.connect.connect(body.code, body.displayName, actor(req)) };
  }

  @Access('operator')
  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Disconnect this installation (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Disconnected' })
  async disconnect(@Req() req) {
    return { data: await this.connect.disconnect(actor(req)) };
  }

  @Access('operator')
  @Post('entitlement/refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Fetch and verify the entitlement documents now (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async refreshEntitlement(@Req() req) {
    return { data: await this.connect.refreshEntitlements(actor(req)) };
  }

  @Access('operator')
  @Get('integrations')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'The integrations, their states and what each one moves (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async integrations() {
    return { data: await this.connect.integrations() };
  }

  @Access('operator')
  @Post('integrations/refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Read the integration states from Ever Platform again (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async refreshIntegrations() {
    return { data: await this.connect.refreshIntegrations() };
  }

  @Access('operator')
  @Get('integrations/:key/consent-url')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Where an organization owner or admin consents to an integration (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async consentUrl(@Param('key') key: string) {
    return { data: { url: await this.connect.consentUrl(key) } };
  }

  @Access('operator')
  @Post('integrations/:key/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Accept or decline an installation-wide integration (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async acceptIntegration(@Req() req, @Param('key') key: string, @Body() body: EverConnectAcceptRequest) {
    return { data: await this.connect.acceptIntegration(key, body.accepted, actor(req)) };
  }

  @Access('operator')
  @Post('integrations/:key/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Switch an integration off (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async disableIntegration(@Req() req, @Param('key') key: string) {
    return { data: await this.connect.disableIntegration(key, actor(req)) };
  }

  @Access('operator')
  @Put('public-url')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Tell Ever Platform the address of this installation, after its consent (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Saved' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The organization has not enabled the installation address' })
  async setPublicUrl(@Req() req, @Body() body: EverConnectPublicUrlRequest) {
    return { data: await this.connect.setPublicUrl(body.url, actor(req)) };
  }

  @Access('operator')
  @Delete('public-url')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Remove the address of this installation from Ever Platform (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Removed' })
  async clearPublicUrl(@Req() req) {
    return { data: await this.connect.clearPublicUrl(actor(req)) };
  }

  @Access('operator')
  @Get('audit')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Every change of the connection: who, what and when (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async auditRows(@Query('limit') limit?: string) {
    const rows = await this.audit.rows(limit === undefined ? 100 : Number(limit) || 100);
    return { data: rows.map(row => ({ at: row.at, action: row.action, actor: row.actorRef, detail: row.detail })) };
  }
}
