import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DbType, isDbType } from '../utils/database-type-helper';
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

/**
 * The time of a change, to spread into the history row that records it. On SQLite the column's default keeps whole
 * seconds, so changes to different translations made in one second tied and the project activity listed them out of
 * order: there the app's clock sets it, in milliseconds (a whole-second time stored before still sorts right next to
 * these). Postgres and MySQL keep microseconds by their own clock, so nothing is set there.
 */
export function changeTime(): { date?: AccessTimestamps } {
  if (!isDbType(DbType.BETTER_SQLITE3)) {
    return {};
  }
  const now = new Date();
  return { date: { created: now, modified: now } };
}
