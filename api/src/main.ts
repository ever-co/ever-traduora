import { NestFactory } from '@nestjs/core';
import { Connection } from 'typeorm';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

// see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
import * as dotenv from 'dotenv';
dotenv.config({ path: join(__dirname, '../../.env') });

import { addPipesAndFilters, AppModule } from './app.module';
import { config } from './config';
import { version } from '../package.json';

interface Closable {
    close(): Promise<void>;
}

const closables: Closable[] = [];

process.on('SIGINT', async () => {
    console.log('Shutting down...');
    try {
        await Promise.all(closables.map((closable) => closable.close()));
        console.log('All resources closed successfully.');
    } catch (error) {
        console.error('Error while shutting down:', error);
    } finally {
        process.exit(1);
    }
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
        console.log(`Listening at http://${host}:${port}`);
    });
}

bootstrap();
