import { NestFactory } from '@nestjs/core';
import { Connection } from 'typeorm';
import { addPipesAndFilters, AppModule } from './app.module';
import { config } from './config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';

interface Closable {
  close(): Promise<void>;
}

const closables: Closable[] = [];

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const closable of closables) {
    await closable.close();
  }
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter());
  addPipesAndFilters(app);
  closables.push(app);

  // Run migrations
  if (config.autoMigrate) {
    console.log('Running DB migrations if necessary');
    const connection = app.get(Connection);
    await connection.runMigrations();
    console.log('DB migrations up to date');
  }

  // Setup swagger
  {
    const options = new DocumentBuilder()
      .setTitle('Traduora API')
      .setDescription(
        'Documentation for the traduora REST API\n\n' +
          'Official website: https://traduora.com\n' +
          'Additional documentation: https://docs.traduora.com\n' +
          'Source code: https://github.com/traduora/traduora',
      )
      .setVersion('1.0')
      .setBasePath('/')
      .addOAuth2('password', '/api/v1/auth/token', '/api/v1/auth/token')
      .setSchemes('http', 'https')
      .build();

    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('api/v1/swagger', app, document, { customSiteTitle: 'Traduora API v1 docs' });
  }

  await app.listenAsync(config.port, '0.0.0.0');
}

bootstrap();
