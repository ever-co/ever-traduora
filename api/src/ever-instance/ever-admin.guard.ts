import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EverInstanceService } from './ever-instance.service';

/**
 * The operator of the installation only: a signed-in user (never an API client token) whose confirmed e-mail is in
 * `TR_EVER_ADMIN_EMAILS` (default `TR_ADMIN_EMAIL`). A signed-out caller gets 401; every other user and every API client
 * gets 404, as for any other resource they may not see: instance-wide figures stay with the operator.
 */
@Injectable()
export class EverAdminGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly instance: EverInstanceService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest();
    if (!this.instance.isOperator(request?.user)) {
      throw new NotFoundException();
    }
    return true;
  }
}
