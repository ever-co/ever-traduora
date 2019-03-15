import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { AccessTimestamps } from "./base";
import { Project } from "./project.entity";
import { ProjectRole } from "./project-user.entity";

export enum InviteStatus {
  Sent = 'sent',
  Failed = 'failed',
  Accepted = 'accepted',
  Declined = 'declined',
}

@Entity()
export class Invite {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  email: string;
  
  @Column({ nullable: false, type: 'enum', enum: InviteStatus, default: InviteStatus.Sent })
  status: InviteStatus;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column({ nullable: false, type: 'enum', enum: ProjectRole, default: ProjectRole.Viewer })
  role: ProjectRole;

  @Column({
    type: 'timestamp',
    nullable: true,
    precision: 6,
  })
  expires: Date;
  
  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}