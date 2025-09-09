import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { AccessTimestamps } from './base';
import { Project } from './project.entity';
import { ProjectRole } from './project-user.entity';
import { EnumColumnType } from '../utils/database-type-helper';

/**
 * Defines the possible statuses for an invitation
 */
export enum InviteStatus {
  Sent = 'sent',
  Accepted = 'accepted',
}

/**
 * Represents invitations sent to users to join projects
 */
@Entity()
export class Invite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  @Column(EnumColumnType.inviteStatus(InviteStatus, InviteStatus.Sent))
  status: InviteStatus;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column(EnumColumnType.projectRole(ProjectRole, ProjectRole.Viewer))
  role: ProjectRole;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
