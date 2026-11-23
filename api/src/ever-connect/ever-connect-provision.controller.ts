import { Body, CanActivate, Controller, Header, HttpCode, HttpStatus, Injectable, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { EverConnectProvisionService } from './ever-connect-provision.service';
import { EverConnectProvisionConfirmRequest, EverConnectProvisionIntentRequest } from './ever-connect.dto';
import { EverSignedInUserGuard } from './ever-connect-person.controller';

/** The provisioning routes exist only with `TR_EVER_CONNECT_PROVISION_ENABLED=true`: 404 otherwise, for everyone. */
@Injectable()
export class EverConnectProvisionEnabledGuard implements CanActivate {
  constructor(private readonly provision: EverConnectProvisionService) {}

  canActivate(): boolean {
    this.provision.ensureEnabled();
    return true;
  }
}

/** A few attempts a minute per address on these routes (two of them are public). */
const PROVISION_THROTTLE = { default: { limit: 30, ttl: 60000 } };

/**
 * Traduora cloud provisioning from app.ever.co, hand-off only (`/api/v1/ever-connect/provision/*`): the web app's landing
 * page posts the intent it received; the person confirms (signed in with the same Ever ID) or declines. Nothing is
 * created before the confirmation. Present only with the connection module loaded, and answering only with
 * `TR_EVER_CONNECT_PROVISION_ENABLED=true`.
 */
@Controller('api/v1/ever-connect/provision')
@ApiTags('Ever Platform')
@UseGuards(EverConnectProvisionEnabledGuard)
@Throttle(PROVISION_THROTTLE)
export class EverConnectProvisionController {
  constructor(private readonly provision: EverConnectProvisionService) {}

  @Post('intent')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Check a provisioning intent from app.ever.co; creates nothing' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The intent verifies: a sealed confirmation and the organization to show' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Expired, already used, or this installation is not connected' })
  async intent(@Body() body: EverConnectProvisionIntentRequest) {
    return { data: await this.provision.intent(body?.intent) };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EverSignedInUserGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create the project for the organization, with the signed-in person (same Ever ID) as its admin' })
  @ApiResponse({ status: HttpStatus.OK, description: '`created`, or `exists` for a replay' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The account is not signed in with the Ever ID of the intent' })
  async confirm(@Req() req, @Body() body: EverConnectProvisionConfirmRequest) {
    return { data: await this.provision.confirm(body?.provisionTxn, req.user.id) };
  }

  /** The sealed confirmation is the capability: whoever holds it (valid while the intent is) may decline. */
  @Post('intents/:jti/reject')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Decline a provisioning intent; Ever Platform is told' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Declined' })
  async reject(@Param('jti') jti: string, @Body() body: EverConnectProvisionConfirmRequest) {
    return { data: await this.provision.reject(jti, body?.provisionTxn) };
  }
}
