import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TimeColumnType } from '../utils/database-type-helper';

/** What an operator did to an organization (DESIGN §3.9). */
export enum OperatorAuditAction {
  Suspend = 'suspend',
  Restore = 'restore',
}

/** When the row was written: set by the service (with milliseconds, so rows of the same second keep their order). */
export class OperatorAuditDate {
  @Column(TimeColumnType.createDate())
  created: Date;
}

/**
 * One action of an installation operator on an organization (DESIGN §3.9, §4.5): who (their account id and the e-mail
 * it had then), what, which organization, why and when. Written in the transaction of the action itself, so an action
 * without its row cannot be. No foreign keys: the row outlives the operator's account, and organizations are only ever
 * marked `deleted`, never removed.
 */
@Entity()
export class OperatorAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  operatorUserId: string;

  @Column({ type: 'varchar', length: 255 })
  operatorEmail: string;

  @Column({ type: 'varchar', length: 32 })
  action: OperatorAuditAction;

  @Column({ type: 'varchar', length: 255 })
  organizationId: string;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column(type => OperatorAuditDate)
  date: OperatorAuditDate;
}
