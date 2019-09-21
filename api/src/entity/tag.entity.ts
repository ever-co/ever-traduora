import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Project } from './project.entity';

@Entity()
@Index(['project', 'value'], { unique: true })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  value: string;

  @Column({ length: 8 })
  color: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  project: Project;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
