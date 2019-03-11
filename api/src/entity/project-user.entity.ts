import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Project } from './project.entity';
import { User } from './user.entity';

export enum ProjectRole {
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
}

@Entity()
@Index(['project', 'user'], { unique: true })
export class ProjectUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false, type: 'enum', enum: ProjectRole, default: ProjectRole.Viewer })
  role: ProjectRole;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
