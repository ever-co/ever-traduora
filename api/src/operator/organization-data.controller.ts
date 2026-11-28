import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Req, Res } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Access } from '../access/access.decorator';
import { OrganizationAction } from '../domain/organization-actions';
import { OrganizationException } from '../errors';
import AuthorizationService from '../services/authorization.service';
import { OrganizationDeletion } from '../services/organization/organization-deletion.service';
import { exportFileName, OrganizationExport } from '../services/organization/organization-export.service';
import { assertSaasEnabled } from '../services/organization/organization.service';
import { ZipWriter } from '../utils/zip-writer';
import { DeleteOrganizationRequest } from './operator.dto';

/** Organization export and deletion exist only in SaaS mode: on a single-tenant install they are not there (404). */
const SAAS_ONLY = { enabled: () => assertSaasEnabled() };

/**
 * An organization's data rights (DESIGN §3.9, §5): its owner and admins export everything it holds as a ZIP archive,
 * and its owner deletes it. The default organization holds every account of an upgraded install: it is neither exported
 * here (its members list would be every account, 404 `saas_disabled` as its member routes answer) nor deleted.
 */
@Controller('api/v1/organizations')
@ApiOAuth2([])
@ApiTags('Organizations')
export class OrganizationDataController {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly exports: OrganizationExport,
    private readonly deletion: OrganizationDeletion,
  ) {}

  @Access('organization:ExportOrganization', SAAS_ONLY)
  @Get(':organizationId/export')
  @ApiOperation({
    summary: 'Export everything of an organization as a ZIP archive (owner, admin)',
    description:
      'organization.json (organization, plan, usage), members.json, and per project project.json, terms.json, labels.json and ' +
      'translations/<locale>.json (flat JSON). Streamed as it is read.',
  })
  @ApiProduces('application/zip')
  @ApiResponse({ status: HttpStatus.OK, description: 'The archive' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found, or not SaaS mode' })
  async export(@Req() req, @Res() res: Response, @Param('organizationId') organizationId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const membership = await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.ExportOrganization);
    if (membership.organization.isDefault) {
      throw new OrganizationException(HttpStatus.NOT_FOUND, 'saas_disabled', 'Organizations are not enabled on this installation');
    }
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(membership.organization)}"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      await this.exports.write(membership, user, new ZipWriter(res));
    } catch (error) {
      if (!res.headersSent) {
        // Nothing went out yet: the error is answered as usual, not as a download
        res.removeHeader('Content-Disposition');
        res.removeHeader('Content-Type');
        throw error;
      }
      // Part of the archive went out already: break the download off, so that nobody keeps a truncated file as whole
      res.destroy(error instanceof Error ? error : undefined);
    }
  }

  @Access('organization:DeleteOrganization', SAAS_ONLY)
  @Delete(':organizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an organization, confirmed with its slug (owner)',
    description:
      'Cancels its subscription, deletes every project with everything in it, and keeps the organization as a deleted ' +
      'tombstone without members. The default organization is never deleted.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The slug typed differs (slug_mismatch), or the default organization (default_organization)',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found, or not SaaS mode' })
  async delete(@Req() req, @Param('organizationId') organizationId: string, @Body() payload: DeleteOrganizationRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const membership = await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.DeleteOrganization);
    await this.deletion.deleteByOwner(user, membership.organizationId, payload?.slug);
  }
}
