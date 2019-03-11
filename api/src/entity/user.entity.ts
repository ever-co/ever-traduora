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

  @Column({ type: 'binary', length: 60 })
  encryptedPassword: Buffer;

  @Column({ nullable: true })
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
    type: 'timestamp',
    nullable: true,
    precision: 6,
  })
  tosAndPrivacyAcceptedDate: Date;

  @Column({
    type: 'varchar',
    nullable: true,
    length: 255,
  })
  tosAndPrivacyAcceptedVersion: string;

  @Column({
    type: 'int',
    nullable: false,
    default: 0,
  })
  numProjectsCreated: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
