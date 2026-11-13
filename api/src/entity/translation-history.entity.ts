import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { User } from './user.entity';

/**
 * One change to the value of a translation: what it said before, what it says now and who changed it.
 * Rows are removed together with their term or locale, and keep their place when the user is deleted.
 */
@Entity()
@Index(['termId', 'projectLocaleId', 'revision'], { unique: true })
export class TranslationHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  termId: string;

  @Index('IDX_translation_history_project_locale_id')
  @Column()
  projectLocaleId: string;

  /** The number of the change within its translation, 1 for the first: gives the order, which timestamps cannot (they can tie) */
  @Column({ type: 'int' })
  revision: number;

  @Column({ type: 'text' })
  previousValue: string;

  @Column({ type: 'text' })
  value: string;

  /** Empty for changes made with an API client, and after the user's account was deleted */
  @Index('IDX_translation_history_user_id')
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  user: User | null;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
