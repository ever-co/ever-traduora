import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { addPipesAndFilters, AppModule } from '../src/app.module';
import { ProjectRole } from '../src/entity/project-user.entity';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';

export interface TestingUser {
  id: string;
  name: string;
  email: string;
  accessToken: string;
}

export interface TestingProject {
  id: string;
  name: string;
  description: string;
  role: string;
}

export interface TestingProjectClient {
  id: string;
  name: string;
  role: string;
  accessToken: string;
}

export async function signupTestUser(app: INestApplication, email: string = 'e2e@test.com'): Promise<TestingUser> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({
      name: `End to End Tester (${email})`,
      email,
      password: 'mysupersecretpassword',
    });
  const result = res.body.data as TestingUser;
  if (!result.id || !result.name || !result.email || !result.accessToken) {
    throw new Error('Malformed signup user response! Maybe fields need updating?');
  }
  return result;
}

export async function createTestProject(app: INestApplication, user: TestingUser): Promise<TestingProject> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/projects')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({
      name: 'My test project',
    });
  const result = res.body.data as TestingProject;
  if (!result.id || !result.name || !result.role) {
    throw new Error('Malformed create project response! Maybe fields need updating?');
  }
  return result;
}

export async function createTestProjectClient(
  app: INestApplication,
  user: TestingUser,
  project: TestingProject,
  role: ProjectRole = ProjectRole.Viewer,
): Promise<TestingProjectClient> {
  const result = {
    id: '',
    name: '',
    role: '',
    accessToken: '',
  };

  let secret: string;

  await request(app.getHttpServer())
    .post(`/api/v1/projects/${project.id}/clients`)
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({
      name: 'My project client',
      role: role,
    })
    .expect(201)
    .expect(res => {
      expect(res.body.data).toHaveExactProperties(['id', 'name', 'role', 'secret']);
      result.id = res.body.data.id;
      result.name = res.body.data.name;
      result.role = res.body.data.role;
      secret = res.body.data.secret;
    });

  await request(app.getHttpServer())
    .post('/api/v1/auth/token')
    .send({
      grant_type: 'client_credentials',
      client_id: result.id,
      client_secret: secret,
    })
    .expect(200)
    .expect(res => {
      expect(res.body).toHaveExactProperties(['access_token', 'expires_in', 'token_type']);
      result.accessToken = res.body.access_token;
    });

  return result;
}

export async function createAndMigrateApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  let app = moduleFixture.createNestApplication<NestExpressApplication>(new ExpressAdapter());
  addPipesAndFilters(app);
  app = await app.init();

  const connection = app.get(Connection);
  await connection.dropDatabase();
  await connection.runMigrations();

  return app;
}

expect.extend({
  toHaveExactProperties(received: any, expectedProps: string[]) {
    if (!(received !== null && typeof received === 'object')) {
      return {
        message: () => `'${received}' must of type object`,
        pass: false,
      };
    }

    let remaining = expectedProps;
    for (const key of Object.keys(received)) {
      if (!expectedProps.find(k => k === key)) {
        return {
          message: () => `received object contains unexpected property '${key}'`,
          pass: false,
        };
      }
      remaining = remaining.filter(prop => prop !== key);
    }
    if (remaining.length > 0) {
      return {
        message: () => `'${Object.keys(received)}' does not contain properties '${remaining}'`,
        pass: false,
      };
    }
    return {
      message: () => '',
      pass: true,
    };
  },
});
