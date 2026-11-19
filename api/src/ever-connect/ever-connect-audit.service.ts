import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';

/** How many audit rows are kept. */
export const EVER_CONNECT_AUDIT_KEPT = 500;

/** The hash of a row: the previous row's hash and this row's fields, so a removed or edited row shows. */
export function auditHash(row: Pick<EverConnectAudit, 'prevHash' | 'at' | 'action' | 'actorRef' | 'detail'>): string {
  return createHash('sha256')
    .update([row.prevHash || '', String(row.at), row.action, row.actorRef, row.detail || ''].join('\n'))
    .digest('hex');
}

/** The audit trail of the Ever Platform connection: who (a user id, never an e-mail), what and when. */
@Injectable()
export class EverConnectAuditService {
  /** Rows of this process are chained one at a time. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(@InjectRepository(EverConnectAudit) private readonly repo: Repository<EverConnectAudit>) {}

  /** Appends one row. `detail` names codes and keys only: no secret, address, e-mail or document. */
  record(action: string, actorRef: string, detail: string | null = null): Promise<void> {
    const write = this.chain.then(async () => {
      const [last] = await this.repo.find({ order: { at: 'DESC', id: 'DESC' }, take: 1 });
      const row = new EverConnectAudit();
      row.id = randomUUID();
      row.at = Math.max(Date.now(), last ? last.at + 1 : 0);
      row.action = action;
      row.actorRef = actorRef;
      row.detail = detail ? detail.slice(0, 255) : null;
      row.prevHash = last ? last.hash : null;
      row.hash = auditHash(row);
      await this.repo.insert(row);
    });
    this.chain = write.catch(() => undefined);
    return write;
  }

  /** The newest rows first. */
  rows(limit = 100): Promise<EverConnectAudit[]> {
    return this.repo.find({ order: { at: 'DESC', id: 'DESC' }, take: Math.max(1, Math.min(EVER_CONNECT_AUDIT_KEPT, limit)) });
  }
}
