import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { User } from './user.entity';

/**
 * One change to the value of a translation: what it said before, what it says now and who changed it.
 * Rows are removed together with their term or locale, and keep their place when the user is deleted.
 */
@Entity()
@Index(['termId', 'projectLocaleId'])
export class TranslationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  termId: string;

  @Column()
  projectLocaleId: string;

  @Column({ type: 'text' })
  previousValue: string;

  @Column({ type: 'text' })
  value: string;

  /** Empty for changes made with an API client, and after the user's account was deleted */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  user: User | null;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
