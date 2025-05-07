import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Project } from './project.entity';
import { User } from './user.entity';
import { EnumColumnType } from '../utils/database-type-helper';

/**
 * Defines the roles a user can have within a project
 */
export enum ProjectRole {
  Admin = 'admin',
  Editor = 'editor',
  Viewer = 'viewer',
}

/**
 * Represents the relationship between users and projects
 */
@Entity()
@Index(['project', 'user'], { unique: true })
export class ProjectUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column(EnumColumnType.projectRole(ProjectRole, ProjectRole.Viewer))
  role: ProjectRole;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
