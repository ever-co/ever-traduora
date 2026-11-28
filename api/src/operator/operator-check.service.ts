import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { isOperatorAccount, OPERATOR_CHECK, OperatorCheck } from '../access/operator-check';
import { config } from '../config';
import { normalizeEmail, parseEmailList } from '../ever-platform/env';

/**
 * The operators that the environment names explicitly: `TR_EVER_ADMIN_EMAILS`, else `TR_ADMIN_EMAIL`; none when neither
 * is set. Unlike `config.everPlatform.adminEmails`, never the built-in fallback address (`local.admin@ever.co`), which
 * anyone could sign up with on a hosted install that forgot to name its operators.
 */
export function explicitOperatorEmails(env: Record<string, string | undefined> = process.env): string[] {
  const listed = parseEmailList(env.TR_EVER_ADMIN_EMAILS);
  if (listed.length) {
    return listed;
  }
  const admin = normalizeEmail(env.TR_ADMIN_EMAIL);
  return admin ? [admin] : [];
}

/**
 * The operator check of the access guard's `operator` rule for the operator console, which exists without the Ever
 * Platform modules (in SaaS mode). The installation has one notion of an operator: where another module provides the
 * check too (the Ever Platform instance module, whose settings may be configured apart, as the e2e suites do), its
 * answer is the one used; otherwise the same rule (`isOperatorAccount`) on `TR_EVER_ADMIN_EMAILS`, else
 * `TR_ADMIN_EMAIL`. Core code does not import the Ever Platform modules, so the other check is found by its token.
 *
 * The console asks more ({@link isConsoleOperator}): an operator listed explicitly.
 */
@Injectable()
export class OperatorCheckService implements OperatorCheck {
  constructor(private readonly moduleRef: ModuleRef) {}

  isOperator(caller: unknown): boolean {
    const other = this.otherCheck();
    if (other) {
      return other.isOperator(caller);
    }
    return isOperatorAccount(caller, config.everPlatform.adminEmails.map(normalizeEmail));
  }

  /**
   * Whether the caller operates the console: an operator of the installation ({@link isOperator}) whose verified e-mail
   * the environment names explicitly ({@link explicitOperatorEmails}). With neither variable set there is no operator.
   */
  isConsoleOperator(caller: unknown, env: Record<string, string | undefined> = process.env): boolean {
    return this.isOperator(caller) && isOperatorAccount(caller, explicitOperatorEmails(env));
  }

  private otherCheck(): OperatorCheck | undefined {
    try {
      const checks = this.moduleRef.get<OperatorCheck, OperatorCheck>(OPERATOR_CHECK, { strict: false, each: true }) ?? [];
      return checks.find(check => check && check !== this && typeof check.isOperator === 'function');
    } catch {
      return undefined;
    }
  }
}

/**
 * The operator console's own guard, after the access guard (which signed the caller in and checked its `operator` rule):
 * 404 unless {@link OperatorCheckService.isConsoleOperator}.
 */
@Injectable()
export class OperatorConsoleGuard implements CanActivate {
  constructor(private readonly operators: OperatorCheckService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: unknown }>();
    if (!this.operators.isConsoleOperator(request?.user)) {
      throw new NotFoundException();
    }
    return true;
  }
}
