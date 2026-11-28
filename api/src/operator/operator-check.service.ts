import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { isOperatorAccount, OperatorCheck } from '../access/operator-check';
import { config } from '../config';
import { normalizeEmail } from '../ever-platform/env';
import { EverInstanceService } from '../ever-instance/ever-instance.service';

/**
 * The operator check of the access guard's `operator` rule for the operator console, which exists without the Ever
 * Platform modules (in SaaS mode). The installation has one notion of an operator: where the Ever Platform instance
 * module is loaded, its answer is the one used (its settings may be configured apart, as the e2e suites do); otherwise
 * the same rule (`isOperatorAccount`) on `TR_EVER_ADMIN_EMAILS`, else `TR_ADMIN_EMAIL`.
 */
@Injectable()
export class OperatorCheckService implements OperatorCheck {
  constructor(private readonly moduleRef: ModuleRef) {}

  isOperator(caller: unknown): boolean {
    const instance = this.instance();
    if (instance) {
      return instance.isOperator(caller);
    }
    return isOperatorAccount(caller, config.everPlatform.adminEmails.map(normalizeEmail));
  }

  private instance(): EverInstanceService | undefined {
    try {
      return this.moduleRef.get(EverInstanceService, { strict: false }) ?? undefined;
    } catch {
      return undefined;
    }
  }
}
