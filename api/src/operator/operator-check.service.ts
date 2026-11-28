import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { isOperatorAccount, OPERATOR_CHECK, OperatorCheck } from '../access/operator-check';
import { config } from '../config';
import { normalizeEmail } from '../ever-platform/env';

/**
 * The operator check of the access guard's `operator` rule for the operator console, which exists without the Ever
 * Platform modules (in SaaS mode). The installation has one notion of an operator: where another module provides the
 * check too (the Ever Platform instance module, whose settings may be configured apart, as the e2e suites do), its
 * answer is the one used; otherwise the same rule (`isOperatorAccount`) on `TR_EVER_ADMIN_EMAILS`, else
 * `TR_ADMIN_EMAIL`. Core code does not import the Ever Platform modules, so the other check is found by its token.
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

  private otherCheck(): OperatorCheck | undefined {
    try {
      const checks = this.moduleRef.get<OperatorCheck, OperatorCheck>(OPERATOR_CHECK, { strict: false, each: true }) ?? [];
      return checks.find(check => check && check !== this && typeof check.isOperator === 'function');
    } catch {
      return undefined;
    }
  }
}
