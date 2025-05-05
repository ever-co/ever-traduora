import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as chalk from 'chalk';
import { AppModule } from '../app.module';
import { SeedDataService } from './seed-data.service';
import { config } from '../config';

/**
 * Bootstrap function to set up the NestJS application and run seed operations
 */

async function bootstrap() {
  const logger = new Logger('SeedCLI');
  logger.log(chalk.blue('🚀 Starting seed CLI...'));

  if (!config.seedData) {
    logger.warn(chalk.yellow('⚠️ Seeding is disabled. Set TR_SEED_DATA=true to enable.'));
    process.exitCode = 1;
    return;
  }

  try {
    // Create a standalone application context
    const app = await NestFactory.createApplicationContext(AppModule);

    // Get the seed service
    const seedService = app.get(SeedDataService);

    // Check if we should run only default seeds
    const runDefaultOnly = process.env.TR_DEFAULT_SEED_ONLY === 'true';

    if (runDefaultOnly) {
      logger.log(chalk.yellow('🌱 Running default seeds only...'));
      await seedService.runDefaultSeed();
    } else {
      logger.log(chalk.yellow('🌱 Running all seeds...'));
      await seedService.runAllSeed();
    }

    logger.log(chalk.green('✅ Seeding completed successfully'));

    // Gracefully shut down the application
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    logger.error(chalk.red(`❌ Seeding failed: ${error.message}`), error?.stack);
    process.exitCode = 1;
  }
}

// Run the bootstrap function
bootstrap();
