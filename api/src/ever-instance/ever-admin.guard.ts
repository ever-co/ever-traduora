import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EverPlatformException } from '../errors';
import { EverInstanceService } from './ever-instance.service';

/**
 * The operator of the installation only: signed in (the existing JWT guard, so 401 without a valid token), as a user
 * whose e-mail is one of TR_EVER_ADMIN_EMAILS (default TR_ADMIN_EMAIL). Every other user, a project admin included,
 * and every API client token gets 403: instance-wide settings stay with the operator.
 */
@Injectable()
export class EverAdminGuard extends AuthGuard('jwt') {
  constructor(private readonly instance: EverInstanceService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const principal = context.switchToHttp().getRequest()?.user;
    if (!this.instance.isOperator(principal)) {
      throw new EverPlatformException(HttpStatus.FORBIDDEN, 'not_operator', 'Only the operator of this installation can use this page.');
    }
    return true;
  }
}
