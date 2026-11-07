import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { TimeColumnType } from '../utils/database-type-helper';

/**
 * A Traduora session opened by signing in with an OpenID Connect provider (e.g. Ever ID), keyed by the provider's
 * session id (`sid`). Its access tokens carry that `sid`: they stop working once the provider ends the session
 * through a back-channel logout (`revokedAt`). Rows are deleted a day after they expire.
 */
@Entity('ever_id_session')
export class EverIdSession {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  sid: string;

  @Index('IDX_ever_id_session_user_id')
  @Column({ type: 'varchar', length: 255 })
  userId: string;

  // Id of the latest access token issued for this session
  @Column({ type: 'varchar', length: 64 })
  jti: string;

  @Column(TimeColumnType.createDate())
  issuedAt: Date;

  @Column(TimeColumnType.createDate())
  expiresAt: Date;

  @Column({ ...TimeColumnType.date(), nullable: true })
  revokedAt: Date | null;
}
