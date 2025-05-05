import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { BinaryColumnType, NumberColumnType, TimeColumnType } from '../utils/database-type-helper';

/**
 * User entity representing application users
 */
@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column(BinaryColumnType.encryptedPassword())
  encryptedPassword: Buffer;

  @Column(BinaryColumnType.encryptedToken())
  encryptedPasswordResetToken: Buffer;

  @Column(TimeColumnType.date())
  passwordResetExpires: Date;

  @Column(NumberColumnType.integer(0))
  loginAttempts: number;

  @Column(TimeColumnType.date())
  lastLogin: Date;

  @Column(NumberColumnType.integer(0))
  numProjectsCreated: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
