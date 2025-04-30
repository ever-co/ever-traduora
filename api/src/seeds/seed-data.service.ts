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
    await this.runSeed('complete', [
      this.seedDefaultUsers,
      // Additional seed operations can be added here in the future
    ]);
  }

  /**
   * Seed default users including admin
   */
  async seedDefaultUsers(): Promise<void> {
    try {
      this.logger.log(chalk.yellow('🧑‍💼 Seeding default users...'));
      await this.userSeed.seed();
      this.logger.log(chalk.green('✅ Default users seeded successfully'));
    } catch (error) {
      this.logger.error(chalk.red(`❌ Default users seeding failed: ${error.message}`), error?.stack);
      throw error;
    }
  }

  /**
   * Run default seed methods
   */
  async runDefaultSeed(): Promise<void> {
    await this.runSeed('default', [this.seedDefaultUsers]);
  }

  /**
   * Run specified seed operations with appropriate logging
   * @param seedType Description of the seeding process type
   * @param seedOperations Array of functions to execute for seeding
   */
  private async runSeed(seedType: string, seedOperations: Array<() => Promise<void>>): Promise<void> {
    try {
      this.logger.log(chalk.blue(`Starting ${seedType} data seeding process...`));

      // Execute all seed operations in sequence
      for (const operation of seedOperations) {
        await operation.call(this);
      }

      this.logger.log(chalk.green(`✅ ${seedType} data seeding completed successfully`));
    } catch (error) {
      this.logger.error(chalk.red(`❌ ${seedType} data seeding failed: ${error.message}`), error.stack);
      throw error;
    }
  }
}
