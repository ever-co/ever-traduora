import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entity/user.entity';
import { UserService } from '../services/user.service';
import { UserLoginAttemptsStorage } from '../redis/user-login-attempts.storage';
import { SeedDataService } from './seed-data.service';
import { UserSeed } from './user.seed';

/**
 * Module for handling data seeding functionality
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserSeed, UserService, UserLoginAttemptsStorage, SeedDataService],
  exports: [SeedDataService],
})
export class SeedModule {}
