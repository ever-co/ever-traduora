import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { ProjectRole } from './project-user.entity';
import { Project } from './project.entity';
import { BinaryColumnType, EnumColumnType } from '../utils/database-type-helper';

/**
 * Represents API clients that can access projects
 */
@Entity()
export class ProjectClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column(EnumColumnType.projectRole(ProjectRole, ProjectRole.Viewer))
  role: ProjectRole;

  @Column({ ...BinaryColumnType.encryptedSecret(), nullable: true })
  encryptedSecret: Buffer;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
