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

  @Column({ ...BinaryColumnType.encryptedPassword(), nullable: true })
  encryptedPassword: Buffer;

  @Column({ ...BinaryColumnType.encryptedToken(), nullable: true })
  encryptedPasswordResetToken: Buffer;

  @Column({ ...TimeColumnType.date(), nullable: true })
  passwordResetExpires: Date;

  @Column(NumberColumnType.integer(0))
  loginAttempts: number;

  @Column({ ...TimeColumnType.date(), nullable: true })
  lastLogin: Date;

  @Column(NumberColumnType.integer(0))
  numProjectsCreated: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
