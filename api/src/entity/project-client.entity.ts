import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { ProjectRole } from './project-user.entity';
import { Project } from './project.entity';

@Entity()
export class ProjectClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: false, type: 'enum', enum: ProjectRole, default: ProjectRole.Viewer })
  role: ProjectRole;

  @Column({ type: 'bytea' })
  encryptedSecret: Buffer;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
