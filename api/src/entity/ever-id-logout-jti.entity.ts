import { Column, Entity, PrimaryColumn } from 'typeorm';
import { TimeColumnType } from '../utils/database-type-helper';

/**
 * Ids (`jti`) of the back-channel logout tokens already processed, so a copy of one is refused. Kept until
 * `expiresAt`, well past the 300 s a logout token is accepted for.
 */
@Entity('ever_id_logout_jti')
export class EverIdLogoutJti {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  jti: string;

  @Column(TimeColumnType.createDate())
  expiresAt: Date;
}
