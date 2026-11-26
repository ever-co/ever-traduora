import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateOrganizationRequest,
  InviteOrganizationMemberRequest,
  ListOrganizationInvitesResponse,
  ListOrganizationMembersResponse,
  ListOrganizationsResponse,
  OrganizationInviteCreatedResponse,
  OrganizationMemberResponse,
  OrganizationResponse,
  TransferOwnershipRequest,
  UpdateOrganizationMemberRequest,
  UpdateOrganizationRequest,
} from '../domain/http';
import { OrganizationAction } from '../domain/organization-actions';
import AuthorizationService from '../services/authorization.service';
import { assertSaasEnabled, organizationView, OrganizationService } from '../services/organization/organization.service';

/**
 * Organizations (DESIGN §5). A single-tenant install answers only the caller's own memberships (`GET /organizations`,
 * `GET /organizations/:id`); everything else is SaaS mode only and answers 404 `saas_disabled` there, since every
 * account of such an install is in the one default organization.
 */
@Controller('api/v1/organizations')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Organizations')
export default class OrganizationController {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly organizations: OrganizationService,
  ) {}

  @Get()
  @ApiOperation({ summary: `List the caller's organizations, with their role in each` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListOrganizationsResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    return { data: await this.organizations.listForUser(user.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an organization, with the caller as its owner (SaaS mode)' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: OrganizationResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request, or the slug is not allowed (slug_invalid)' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The slug is taken (slug_taken)' })
  async create(@Req() req, @Body() payload: CreateOrganizationRequest) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    return { data: await this.organizations.create(user, payload) };
  }

  @Get(':organizationId')
  @ApiOperation({ summary: 'Get an organization' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: OrganizationResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async findOne(@Req() req, @Param('organizationId') organizationId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const membership = await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.ViewOrganization);
    return { data: organizationView(membership.organization, membership.role) };
  }

  @Patch(':organizationId')
  @ApiOperation({ summary: 'Rename an organization or change its slug (owner, admin)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: OrganizationResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The slug is taken (slug_taken)' })
  async update(@Req() req, @Param('organizationId') organizationId: string, @Body() payload: UpdateOrganizationRequest) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const membership = await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.EditOrganization);
    return { data: await this.organizations.rename(membership.organization, payload, membership.role) };
  }

  @Get(':organizationId/members')
  @ApiOperation({ summary: `List an organization's members` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListOrganizationMembersResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async members(@Req() req, @Param('organizationId') organizationId: string) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.ViewMembers);
    return { data: await this.organizations.listMembers(organizationId) };
  }

  @Patch(':organizationId/members/:userId')
  @ApiOperation({ summary: `Change a member's role to admin or member (owner, admin)` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: OrganizationMemberResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Your own role, or the owner (owner_role)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async updateMember(
    @Req() req,
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @Body() payload: UpdateOrganizationMemberRequest,
  ) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.EditMembers);
    return { data: await this.organizations.changeRole(organizationId, user.id, userId, payload.role) };
  }

  @Delete(':organizationId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member (owner, admin), or leave the organization (your own user id)',
    description: 'Their project memberships in the organization go with them. The owner transfers the ownership first.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Removed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'The owner (owner_required)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async removeMember(@Req() req, @Param('organizationId') organizationId: string, @Param('userId') userId: string) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    // Leaving needs only the membership; removing someone else needs EditMembers
    const action = userId === user.id ? OrganizationAction.ViewOrganization : OrganizationAction.EditMembers;
    await this.auth.authorizeOrganizationAction(user, organizationId, action);
    await this.organizations.removeMember(organizationId, user.id, userId);
  }

  @Post(':organizationId/transfer-ownership')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make another member the owner; the current owner becomes an admin (owner)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Transferred: the members with their new roles', type: ListOrganizationMembersResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async transferOwnership(@Req() req, @Param('organizationId') organizationId: string, @Body() payload: TransferOwnershipRequest) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.TransferOwnership);
    return { data: await this.organizations.transferOwnership(organizationId, user.id, payload.userId) };
  }

  @Get(':organizationId/invites')
  @ApiOperation({ summary: `List an organization's pending invites (owner, admin)` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListOrganizationInvitesResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async invites(@Req() req, @Param('organizationId') organizationId: string) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.EditMembers);
    return { data: await this.organizations.listInvites(organizationId) };
  }

  @Post(':organizationId/invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite someone to the organization (owner, admin)',
    description: 'An account with a verified email joins at once; anyone else gets an invitation link by email.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: OrganizationInviteCreatedResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The person is a member already' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async invite(@Req() req, @Param('organizationId') organizationId: string, @Body() payload: InviteOrganizationMemberRequest) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const membership = await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.EditMembers);
    const result = await this.organizations.invite(membership.organization, user, payload);
    return { data: 'member' in result ? result.member : result.invite };
  }

  @Delete(':organizationId/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending invite (owner, admin)' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Revoked' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async revokeInvite(@Req() req, @Param('organizationId') organizationId: string, @Param('inviteId') inviteId: string) {
    assertSaasEnabled();
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.EditMembers);
    await this.organizations.revokeInvite(organizationId, inviteId);
  }
}
