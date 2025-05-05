import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { version } from '../package.json';
import { setupShutdownHandler } from './shutdown.handler';
import { checkEnvVariables } from './env.logger';
import { Closable } from './types';
import { config } from './config';
import { addPipesAndFilters, AppModule } from './app.module';
import { SeedDataService } from './seeds/seed-data.service';
import * as chalk from 'chalk';
import { getDataSourceConnection } from './connection/datasource';
import { getDbType } from './utils/database-type-helper';

const closables: Closable[] = [];

/**
 * Bootstraps the application by creating an instance of the AppModule and configuring the necessary components.
 * This function also sets up the necessary shutdown handler for graceful application termination.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter());

  addPipesAndFilters(app);
  closables.push(app);

  // Get current database type
  const dbType = getDbType();

  // Run migrations
  if (config.autoMigrate) {
    console.log('Running DB migrations if necessary');
    const dataSource = await getDataSourceConnection();
    await dataSource.runMigrations();
    console.log('DB migrations up to date');
  }

  if (config.seedData) {
    console.log(chalk.yellow('🌱 Seeding initial data...'));
    const seedService = app.get(SeedDataService);
    await seedService.runAllSeed();
  }

  const port = config.port;
  const host = '0.0.0.0';

  // Setup swagger
  {
    const options = new DocumentBuilder()
      .setTitle('Traduora API')
      .setDescription(
        `<p>Documentation for the traduora REST API <p/>` +
          `<p>Official website: <a target="_blank" href="https://traduora.co">https://traduora.co</a><br/>` +
          `Additional documentation: <a target="_blank" href="https://docs.traduora.co">https://docs.traduora.co</a> <br/>` +
          `Source code: <a target="_blank" href="https://github.com/ever-co/ever-traduora">https://github.com/ever-co/ever-traduora</a></p>`,
      )
      .setVersion(version)
      .setBasePath('/')
      .addOAuth2({
        type: 'oauth2',
        flows: {
          password: {
            authorizationUrl: '/api/v1/auth/token',
            tokenUrl: '/api/v1/auth/token',
            scopes: [],
          },
        },
      })
      .build();

    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('api/v1/swagger', app, document, { customSiteTitle: 'Traduora API v1 docs' });
    console.log(`Swagger UI available at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api/v1/swagger`);
  }

  await app.listen(port, host, () => {
    console.log(`Using database type: ${dbType}`);
    console.log(`Listening at http://${host}:${port}`);
  });
}

// Initialize Check Env Variables
checkEnvVariables();

// Bootstrap the application
bootstrap().then(() => {
  // Initialize the shutdown handler
  setupShutdownHandler(closables);
});
