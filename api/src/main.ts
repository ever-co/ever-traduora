import { NestFactory } from '@nestjs/core';
import { Connection } from 'typeorm';
import { addPipesAndFilters, AppModule } from './app.module';
import { config } from './config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';

import { version } from '../package.json';

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
			`<p>Documentation for the traduora REST API <p/>` +
			`<p>Official website: <a target="_blank" href="https://traduora.com">https://traduora.com</a><br/>` +
			`Additional documentation: <a target="_blank" href="https://docs.traduora.com">https://docs.traduora.com</a> <br/>` +
			`Source code: <a target="_blank" href="https://github.com/traduora/traduora">https://github.com/traduora/traduora</a></p>`
		)
      	.setVersion(version)
      	.setBasePath('/')
		.addOAuth2({
			type: 'oauth2',
			flows: {
				password: {
					authorizationUrl: '/api/v1/auth/token',
					tokenUrl: '/api/v1/auth/token',
					scopes: []
				}
			}
		})
		.build();

    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('api/v1/swagger', app, document, { customSiteTitle: 'Traduora API v1 docs' });
  }

  await app.listenAsync(config.port, '0.0.0.0');
}

bootstrap();
