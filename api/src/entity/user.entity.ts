import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ type: 'bytea', nullable: true })
  encryptedPassword: Buffer;

  @Column({ type: 'bytea', nullable: true })
  encryptedPasswordResetToken: Buffer;

  @Column({
    type: 'timestamp',
    nullable: true,
    precision: 6,
  })
  passwordResetExpires: Date;

  @Column({ type: 'int', default: 0 })
  loginAttempts: number;

  @Column({
    type: 'timestamp',
    nullable: true,
    precision: 6,
  })
  lastLogin: Date;

  @Column({
    type: 'int',
    nullable: false,
    default: 0,
  })
  numProjectsCreated: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
