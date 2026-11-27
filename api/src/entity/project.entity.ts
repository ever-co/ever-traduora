import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Organization } from './organization.entity';
import { Plan } from './plan.entity';
import { NumberColumnType } from '../utils/database-type-helper';

@Entity()
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column(NumberColumnType.integer(0))
  termsCount: number;

  @Column(NumberColumnType.integer(0))
  localesCount: number;

  @ManyToOne(() => Plan, { onDelete: 'SET NULL', nullable: true })
  plan: Plan;

  /**
   * The organization the project belongs to: every project has exactly one. NOT NULL on PostgreSQL and MySQL; on SQLite
   * the column stays nullable (a NOT NULL there means rebuilding the table), every insert sets it and the boot check
   * (`OrganizationBootCheck`) refuses to start while a project has none.
   */
  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  organization: Organization;

  @Index('IDX_project_organization_id')
  @Column({ nullable: false })
  organizationId: string;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
