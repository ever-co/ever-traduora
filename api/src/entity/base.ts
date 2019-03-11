import { CreateDateColumn, UpdateDateColumn } from 'typeorm';

export class AccessTimestamps {
  @CreateDateColumn({ type: 'timestamp' })
  created: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  modified: Date;
}
