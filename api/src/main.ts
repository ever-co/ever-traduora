import { NestFactory } from '@nestjs/core';
import { Connection } from 'typeorm';
import { addPipesAndFilters, AppModule } from './app.module';
import { config } from './config';

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
  const app = await NestFactory.create(AppModule);
  addPipesAndFilters(app);
  closables.push(app);

  // Run migrations
  if (config.autoMigrate) {
    console.log('Running DB migrations if necessary');
    const connection = app.get(Connection);
    await connection.runMigrations();
    console.log('DB migrations up to date');
  }

  await app.listen(config.port, '0.0.0.0');
}

bootstrap();
