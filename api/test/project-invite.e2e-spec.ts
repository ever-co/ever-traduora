import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('ProjectInviteController (e2e)', () => {
  let app: INestApplication;
  let testingUser1: TestingUser;
  
  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser1 = await signupTestUser(app);
  });
});