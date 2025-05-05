import { CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TimeColumnType } from '../utils/database-type-helper';

/**
 * Base class for tracking creation and modification timestamps
 */
export class AccessTimestamps {
  @CreateDateColumn(TimeColumnType.createDate())
  created: Date;

  @UpdateDateColumn(TimeColumnType.updateDate())
  modified: Date;
}
