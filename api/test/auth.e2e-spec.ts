import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import MailService from '../src/services/mail.service';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingUser } from './util';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
  });

  it('/api/v1/auth/signup (POST) should signup user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Another End to End Tester',
        email: 'e2eanother@test.com',
        password: 'myTrulysupersecretpassword',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'email', 'accessToken']);
      });
  });

  it('/api/v1/auth/signup (POST) should reject signup with invalid email', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'End to End Tester',
        email: 'e2etest.com',
        password: 'mysupersecretpassword',
      })
      .expect(400);
  });

  it('/api/v1/auth/signup (POST) should reject signup with invalid password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'End to End Tester',
        email: 'anothere2e@test.com',
        password: 'short',
      })
      .expect(400);
  });

  it('/api/v1/auth/signup (POST) should reject signup if missing params or malfomed request', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 100,
        email: 100,
        password: 12301920,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Totally',
        email: 'totally@valid.com',
        password: 12301920,
      })
      .expect(400);
  });

  it('/api/v1/auth/signup (POST) should reject signup when user already exists', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        name: 'Another End to End Tester',
        email: testingUser.email,
        password: 'myothersupersecretpassword',
      })
      .expect(409)
      .expect(res => expect(res.body.error.code).toBe('AlreadyExists'));
  });

  it('/api/v1/auth/token (POST) should grant token to user with valid credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
        password: 'mysupersecretpassword',
      })
      .expect(200)
      .expect(res => expect(res.body).toHaveExactProperties(['access_token', 'expires_in', 'token_type']));
  });

  it('/api/v1/auth/token (POST) should not grant a token to user with missing credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        password: 'mysupersecretpassword',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: '',
        password: 'mysupersecretpassword',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
        password: '',
      })
      .expect(400);
  });

  it('/api/v1/auth/token (POST) should grant token to client with valid credentials', async () => {
    const testProject = await createTestProject(app, testingUser);

    let clientId: string;
    let clientSecret: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/clients`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My project client',
        role: 'viewer',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'role', 'secret']);
        clientId = res.body.data.id;
        clientSecret = res.body.data.secret;
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      })
      .expect(200)
      .expect(res => expect(res.body).toHaveExactProperties(['access_token', 'expires_in', 'token_type']));

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret + 'bla',
      })
      .expect(401)
      .expect(res => expect(res.body.data).toBeUndefined());
  });

  it('/api/v1/auth/token (POST) should not grant a token to client with missing credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        username: testingUser.email,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        password: 'mysupersecretpassword',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        username: '',
        password: 'mysupersecretpassword',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        username: testingUser.email,
        password: '',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        username: testingUser.email,
        password: 'mysupersecretpassword',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        username: testingUser.email,
        password: 'mysupersecretpassword',
      })
      .expect(400)
      .expect(res => expect(res.body.data).toBeUndefined());
  });

  it('/api/v1/auth/token (POST) should not grant token to user with invalid credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
        password: 'mynotsupersecretpassword',
      })
      .expect(401)
      .expect(res => expect(res.body.data).toBeUndefined());

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        username: testingUser.email,
        password: 'mysupersecretpassword',
      })
      .expect(400)
      .expect(res => expect(res.body.data).toBeUndefined());
  });

  it('/api/v1/auth/forgot-password (POST) should send forgotten password email to requested user', async () => {
    const mail = app.get(MailService);
    jest.spyOn(mail, 'passwordResetToken');

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({
        email: testingUser.email,
      })
      .expect(200)
      .expect(res => {
        expect(mail.passwordResetToken).toHaveBeenCalledTimes(1);
      });
  });

  it('/api/v1/auth/change-password (POST) should change the password if the old one is valid', async () => {
    const mail = app.get(MailService);
    jest.spyOn(mail, 'passwordChanged');

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        email: 'anothere2e@test.com',
        oldPassword: 'mysupersecretpassword',
        newPassword: 'myevenmoresupersecretpassword',
      })
      .expect(204)
      .expect(res => {
        expect(res.body).toEqual({});
        expect(mail.passwordChanged).toHaveBeenCalledTimes(1);
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        email: 'anothere2e@test.com',
        oldPassword: 'myevenmoresupersecretpassword',
        newPassword: 'mysupersecretpassword',
      })
      .expect(204)
      .expect(res => {
        expect(res.body).toEqual({});
        expect(mail.passwordChanged).toHaveBeenCalledTimes(2);
      });
  });

  it('/api/v1/auth/change-password (POST) should not change the password if the old one is invalid', async () => {
    const mail = app.get(MailService);
    jest.spyOn(mail, 'passwordChanged');

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        oldPassword: 'myincorrectpassword',
        newPassword: 'myevenmoresupersecretpassword',
      })
      .expect(401);

    expect(mail.passwordChanged).toHaveBeenCalledTimes(0);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
        password: 'mysupersecretpassword',
      })
      .expect(200);
  });

  it('/api/v1/auth/change-password (POST) should not change the password if the request is malformed or invalid', async () => {
    const mail = app.get(MailService);
    jest.spyOn(mail, 'passwordChanged');

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        oldPassword: 'mysupersecretpassword',
        newPassword: '',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        oldPassword: '',
        newPassword: 'myevenmoresupersecretpassword',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        newPassword: 'myevenmoresupersecretpassword',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        oldPassword: 'mysupersecretpassword',
      })
      .expect(400);

    expect(mail.passwordChanged).toHaveBeenCalledTimes(0);

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
        password: 'mysupersecretpassword',
      })
      .expect(200);
  });

  it('/api/v1/auth/change-password (POST) should reject the request if the user is not authenticated', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .send({
        email: 'anothere2e@test.com',
        oldPassword: 'mysupersecretpassword',
        newPassword: 'anewpasswordhasbeenreach',
      })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testingUser.accessToken}wrongtoken`)
      .send({
        email: 'anothere2e@test.com',
        oldPassword: 'mysupersecretpassword',
        newPassword: 'anewpasswordhasbeenreach',
      })
      .expect(401);
  });

  it('/api/v1/auth/reset-password (POST) should reset password when token is valid', async () => {
    const mail = app.get(MailService);

    let capturedToken;
    jest.spyOn(mail, 'passwordResetToken').mockImplementation((user, token) => {
      capturedToken = token;
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({
        email: testingUser.email,
        password: 'mysupersecretpassword',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        email: testingUser.email,
        token: capturedToken,
        newPassword: 'mynewpassword',
      })
      .expect(200);

    // Check that re-using token is rejected
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        email: testingUser.email,
        token: capturedToken,
        newPassword: 'mynewerpassword',
      })
      .expect(401);

    // Check that password was actually changed
    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
        password: 'mynewpassword',
      })
      .expect(200);

    // Check that re-use token attempt did not change the password
    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'password',
        username: testingUser.email,
        password: 'mynewerpassword',
      })
      .expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
