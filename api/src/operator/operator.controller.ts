import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Access } from '../access/access.decorator';
import { OperatorAuditAction } from '../entity/operator-audit.entity';
import { User } from '../entity/user.entity';
import { isId } from '../services/authorization.service';
import { assertSaasEnabled } from '../services/organization/organization.service';
import { OperatorOrganizations, REASON_MAX, REASON_MIN } from '../services/organization/organization-operator.service';
import {
  ListOperatorAuditResponse,
  ListOperatorOrganizationsResponse,
  OperatorAuditQuery,
  OperatorOrganizationResponse,
  OperatorOrganizationsQuery,
  OperatorReasonRequest,
  OperatorStatusResponse,
  pageNumber,
} from './operator.dto';

/** The operator console exists only in SaaS mode: on a single-tenant install it is not there, for anyone (404). */
const SAAS_ONLY = { enabled: () => assertSaasEnabled() };

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAGE = 100_000;

/**
 * The operator console (DESIGN §3.9, §5): the installation's operators (a verified e-mail in `TR_EVER_ADMIN_EMAILS`)
 * list and search every organization, see one with its plan and usage, suspend or restore it with a reason, and read the
 * audit log of those actions. `@Access('operator')`: everyone else, API keys included, gets 404, as for any route they
 * may not see. The `:id` parameter is not `:organizationId`: these routes are not a member's organization routes.
 */
@Controller('api/v1/operator')
@ApiOAuth2([])
@ApiTags('Operator')
export class OperatorController {
  constructor(private readonly organizations: OperatorOrganizations) {}

  @Access('operator', SAAS_ONLY)
  @Get('status')
  @ApiOperation({ summary: 'Whether the caller operates this installation (the web app shows the operator pages then)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'An operator', type: OperatorStatusResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not an operator, or not SaaS mode' })
  status() {
    return { data: { operator: true } };
  }

  @Access('operator', SAAS_ONLY)
  @Get('organizations')
  @ApiOperation({ summary: 'List and search every organization, newest first (operator)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListOperatorOrganizationsResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not an operator, or not SaaS mode' })
  async list(@Query() query: OperatorOrganizationsQuery) {
    return this.organizations.list({
      q: query.q,
      status: query.status,
      page: pageNumber(query.page, 1, MAX_PAGE),
      limit: pageNumber(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
    });
  }

  @Access('operator', SAAS_ONLY)
  @Get('organizations/:id')
  @ApiOperation({ summary: 'An organization with its effective plan, its usage counted now and its latest audit rows (operator)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: OperatorOrganizationResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async detail(@Param('id') id: string) {
    return { data: await this.found(id) };
  }

  @Access('operator', SAAS_ONLY)
  @Post('organizations/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suspend an organization, with a reason (operator)',
    description: "Its members and API keys are refused (403 organization_suspended) from their next request on. Audited.",
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Suspended', type: OperatorOrganizationResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'No reason, or the default organization (default_organization)' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Not active (organization_status)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async suspend(@Req() req, @Param('id') id: string, @Body() payload: OperatorReasonRequest) {
    return this.change(req, id, OperatorAuditAction.Suspend, payload);
  }

  @Access('operator', SAAS_ONLY)
  @Post('organizations/:id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a suspended organization, with a reason (operator)', description: 'Audited.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Restored', type: OperatorOrganizationResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'No reason' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Not suspended (organization_status)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async restore(@Req() req, @Param('id') id: string, @Body() payload: OperatorReasonRequest) {
    return this.change(req, id, OperatorAuditAction.Restore, payload);
  }

  @Access('operator', SAAS_ONLY)
  @Get('audit')
  @ApiOperation({ summary: 'The audit log of the operator actions, newest first (operator)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListOperatorAuditResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not an operator, or not SaaS mode' })
  async audit(@Query() query: OperatorAuditQuery) {
    return this.organizations.audit({
      organizationId: query.organizationId,
      page: pageNumber(query.page, 1, MAX_PAGE),
      limit: pageNumber(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
    });
  }

  private async change(req: { user?: unknown }, id: string, action: OperatorAuditAction, payload: OperatorReasonRequest) {
    const operator = req.user;
    // The access guard let only an operator's account through; the audit names it
    if (!(operator instanceof User) || !isId(operator.id) || typeof operator.email !== 'string') {
      throw new NotFoundException();
    }
    const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
    if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
      throw new BadRequestException(`a reason of ${REASON_MIN} to ${REASON_MAX} characters is required`);
    }
    if (!isId(id)) {
      throw new NotFoundException();
    }
    await this.organizations.changeStatus({ id: operator.id, email: operator.email }, id, action, reason);
    return { data: await this.found(id) };
  }

  private async found(id: string) {
    const organization = isId(id) ? await this.organizations.detail(id) : null;
    if (!organization) {
      throw new NotFoundException('organization not found');
    }
    return organization;
  }
}
