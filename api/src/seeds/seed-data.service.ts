import { Injectable, Logger } from '@nestjs/common';
import * as chalk from 'chalk';
import { UserSeed } from './user.seed';

/**
 * Service responsible for orchestrating the data seeding process
 */
@Injectable()
export class SeedDataService {
  private readonly logger = new Logger(SeedDataService.name);

  constructor(private readonly userSeed: UserSeed) {}

  /**
   * Run all seed methods in the correct order
   */
  async runAllSeed(): Promise<void> {
    try {
      this.logger.log(chalk.blue('Starting complete data seeding process...'));

      // seed users
      await this.seedDefaultUsers();

      this.logger.log(chalk.green('✅ Data seeding completed successfully'));
    } catch (error) {
      this.logger.error(chalk.red(`❌ Data seeding failed: ${error.message}`), error.stack);
      throw error;
    }
  }

  /**
   * Seed default users including admin
   */
  async seedDefaultUsers(): Promise<void> {
    this.logger.log(chalk.yellow('🧑‍💼 Seeding default users...'));
    await this.userSeed.seed();
    this.logger.log(chalk.green('✅ Default users seeded successfully'));
  }

  /**
   * Method to run only the default seeding process (for API calls)
   */
  async runDefaultSeed(): Promise<void> {
    try {
      this.logger.log(chalk.blue('Starting default data seeding process...'));
      await this.seedDefaultUsers();
      this.logger.log(chalk.green('✅ Default data seeding completed successfully'));
    } catch (error) {
      this.logger.error(chalk.red(`❌ Default data seeding failed: ${error.message}`), error.stack);
      throw error;
    }
  }
}
