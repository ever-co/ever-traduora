// Many deletions from one address in this file: above the rate limit of organization changes (read with the config)
process.env.TR_ORGANIZATION_CHANGES_LIMIT = '1000';

import { INestApplication, Module, ServiceUnavailableException } from '@nestjs/common';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource, In } from 'typeorm';
import { addPipesAndFilters, AppModule } from '../src/app.module';
import { config } from '../src/config';
import { OrganizationRole, OrganizationStatus } from '../src/domain/organization-actions';
import { Invite } from '../src/entity/invite.entity';
import { Label } from '../src/entity/label.entity';
import { OrganizationInvite } from '../src/entity/organization-invite.entity';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { ProjectClient } from '../src/entity/project-client.entity';
import { ProjectLocale } from '../src/entity/project-locale.entity';
import { ProjectUser } from '../src/entity/project-user.entity';
import { Project } from '../src/entity/project.entity';
import { Term } from '../src/entity/term.entity';
import { TranslationHistory } from '../src/entity/translation-history.entity';
import { Translation } from '../src/entity/translation.entity';
import { User } from '../src/entity/user.entity';
import { OperatorAudit } from '../src/entity/operator-audit.entity';
import { BillingCancellationStatus, OrganizationBillingCancellation } from '../src/entity/organization-billing-cancellation.entity';
import { BILLING_CANCELLATION, BillingCancellation } from '../src/services/organization/billing-cancellation';
import * as membership from '../src/services/organization/organization-membership';
import { OrganizationExport } from '../src/services/organization/organization-export.service';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';
import { readZip, zipJson } from './zip';

const byText = (left: string, right: string) => left.localeCompare(right);

/** What the billing module (P4) would be asked: here a fake, registered the way P4 registers its own. */
const billing: BillingCancellation & {
  calls: string[];
  /** How many of the next calls fail */
  failing: number;
  /** What the call saw: the organization's status as given, and its projects left in the database */
  seen: Array<{ status: string; projects: number }>;
  dataSource?: DataSource;
} = {
  calls: [],
  failing: 0,
  seen: [],
  async cancelForDeletion(organization) {
    this.calls.push(organization.id);
    this.seen.push({
      status: organization.status,
      projects: await this.dataSource.getRepository(Project).count({ where: { organizationId: organization.id } }),
    });
    if (this.failing > 0) {
      this.failing -= 1;
      throw new ServiceUnavailableException('billing is down');
    }
  },
};

@Module({ providers: [{ provide: BILLING_CANCELLATION, useValue: billing }] })
class FakeBillingModule {}

/** Collects a binary response body (supertest leaves application/zip unparsed otherwise). */
const binary = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  let done = false;
  const settle = (error: Error | null) => {
    if (!done) {
      done = true;
      callback(error, Buffer.concat(chunks));
    }
  };
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => settle(null));
  // A download broken off by the server
  res.on('aborted', () => settle(new Error('aborted')));
  res.on('error', (error: Error) => settle(error));
};

/**
 * DESIGN §3.9: an organization's export (owner, admin) is a ZIP archive with every project's terms and translations
 * (flat JSON, one file per locale), labels, members and plan; its deletion (owner, slug typed) cancels the subscription,
 * deletes the projects with all their data, keeps the organization as a `deleted` tombstone, and touches nothing of
 * any other organization. The default organization is neither exported nor deleted.
 */
describe('Organization export and deletion (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const saasBefore = config.saasEnabled;
  const operatorsBefore = process.env.TR_EVER_ADMIN_EMAILS;
  let operator: TestingUser;

  const server = () => app.getHttpServer();
  const as = (user: TestingUser | { accessToken: string }) => ({ Authorization: `Bearer ${user.accessToken}` });

  interface Side {
    organization: { id: string; name: string; slug: string };
    owner: TestingUser;
    admin: TestingUser;
    member: TestingUser;
    projectIds: string[];
    keyToken: string;
  }

  async function signup(email: string, organizationName: string): Promise<TestingUser> {
    const res = await request(server())
      .post('/api/v1/auth/signup')
      .send({ name: email, email, password: 'mysupersecretpassword', organizationName })
      .expect(200);
    await dataSource.getRepository(User).update({ id: res.body.data.id }, { emailVerified: true });
    return res.body.data;
  }

  /** An organization with an owner, an admin, a member, two projects full of data, an API key and pending invites. */
  async function makeSide(name: string): Promise<Side> {
    const slug = name.toLowerCase();
    const owner = await signup(`owner-${slug}@test.com`, `Data ${name}`);
    const organization = (await request(server()).get('/api/v1/organizations').set(as(owner)).expect(200)).body.data.find(
      o => o.name === `Data ${name}`,
    );
    const admin = await signupTestUser(app, `admin-${slug}@test.com`);
    const member = await signupTestUser(app, `member-${slug}@test.com`);
    for (const [person, role] of [
      [admin, 'admin'],
      [member, 'member'],
    ] as const) {
      await request(server()).post(`/api/v1/organizations/${organization.id}/invites`).set(as(owner)).send({ email: person.email, role }).expect(201);
    }
    await request(server())
      .post(`/api/v1/organizations/${organization.id}/invites`)
      .set(as(owner))
      .send({ email: `pending-${slug}@test.com`, role: 'member' })
      .expect(201);

    const projectIds: string[] = [];
    for (const projectName of [`Website ${name}`, `App ${name}`]) {
      const project = (
        await request(server()).post('/api/v1/projects').set(as(owner)).send({ name: projectName, organizationId: organization.id }).expect(201)
      ).body.data;
      projectIds.push(project.id);
      const base = `/api/v1/projects/${project.id}`;
      for (const code of ['en', 'de']) {
        await request(server()).post(`${base}/translations`).set(as(owner)).send({ code }).expect(201);
      }
      const hello = (
        await request(server())
          .post(`${base}/terms`)
          .set(as(owner))
          .send({ value: `hello.${slug}`, context: 'greeting' })
          .expect(201)
      ).body.data;
      await request(server())
        .post(`${base}/terms`)
        .set(as(owner))
        .send({ value: `bye.${slug}` })
        .expect(201);
      await request(server())
        .patch(`${base}/translations/de`)
        .set(as(owner))
        .send({ termId: hello.id, value: `Hallo ${name}` })
        .expect(200);
      await request(server())
        .patch(`${base}/translations/en`)
        .set(as(owner))
        .send({ termId: hello.id, value: `Hello ${name}` })
        .expect(200);
      const label = (
        await request(server())
          .post(`${base}/labels`)
          .set(as(owner))
          .send({ value: `web-${slug}`, color: '#336699' })
          .expect(201)
      ).body.data;
      await request(server()).post(`${base}/labels/${label.id}/terms/${hello.id}`).set(as(owner)).expect(201);
      await request(server()).post(`${base}/invites`).set(as(owner)).send({ email: member.email, role: 'editor' }).expect(201);
      await request(server())
        .post(`${base}/invites`)
        .set(as(owner))
        .send({ email: `pending-project-${slug}@test.com`, role: 'viewer' })
        .expect(201);
    }
    const client = (
      await request(server())
        .post(`/api/v1/projects/${projectIds[0]}/clients`)
        .set(as(owner))
        .send({ name: `ci-${slug}`, role: 'admin' })
        .expect(201)
    ).body.data;
    const keyToken = (
      await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })
        .expect(200)
    ).body.access_token;
    return { organization, owner, admin, member, projectIds, keyToken };
  }

  /** Everything an organization holds, counted, to show that a deletion elsewhere changes none of it. */
  async function snapshot(side: Side) {
    const projects = await dataSource.getRepository(Project).find({ where: { organizationId: side.organization.id } });
    const ids = projects.map(project => project.id);
    const locales = ids.length ? await dataSource.getRepository(ProjectLocale).find({ where: { project: { id: In(ids) } } }) : [];
    const localeIds = locales.map(locale => locale.id);
    const organization = await dataSource.getRepository(Organization).findOneBy({ id: side.organization.id });
    return {
      organization: { name: organization.name, slug: organization.slug, status: organization.status },
      projects: projects.map(project => project.name).sort(byText),
      terms: ids.length ? await dataSource.getRepository(Term).count({ where: { project: { id: In(ids) } } }) : 0,
      locales: locales.length,
      translations: localeIds.length ? await dataSource.getRepository(Translation).count({ where: { projectLocale: { id: In(localeIds) } } }) : 0,
      history: localeIds.length ? await dataSource.getRepository(TranslationHistory).count({ where: { projectLocaleId: In(localeIds) } }) : 0,
      labels: ids.length ? await dataSource.getRepository(Label).count({ where: { project: { id: In(ids) } } }) : 0,
      projectUsers: ids.length ? await dataSource.getRepository(ProjectUser).count({ where: { project: { id: In(ids) } } }) : 0,
      projectInvites: ids.length ? await dataSource.getRepository(Invite).count({ where: { project: { id: In(ids) } } }) : 0,
      clients: ids.length ? await dataSource.getRepository(ProjectClient).count({ where: { project: { id: In(ids) } } }) : 0,
      members: await dataSource.getRepository(OrganizationUser).count({ where: { organizationId: side.organization.id } }),
      invites: await dataSource.getRepository(OrganizationInvite).count({ where: { organizationId: side.organization.id } }),
    };
  }

  const exportOf = (organizationId: string, user: { accessToken: string }) =>
    request(server()).get(`/api/v1/organizations/${organizationId}/export`).set(as(user)).buffer(true).parse(binary);

  let a: Side;
  let b: Side;

  beforeAll(async () => {
    config.saasEnabled = true;
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule, FakeBillingModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>(new ExpressAdapter());
    addPipesAndFilters(app as NestExpressApplication);
    await app.init();
    dataSource = app.get(DataSource);
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    billing.dataSource = dataSource;
    a = await makeSide('A');
    b = await makeSide('B');
    process.env.TR_EVER_ADMIN_EMAILS = config.everPlatform.adminEmails[0];
    operator = await signupTestUser(app, config.everPlatform.adminEmails[0]);
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    if (operatorsBefore === undefined) {
      delete process.env.TR_EVER_ADMIN_EMAILS;
    } else {
      process.env.TR_EVER_ADMIN_EMAILS = operatorsBefore;
    }
    jest.restoreAllMocks();
    await app.close();
  });

  describe('export', () => {
    it('streams a ZIP archive with the organization, its plan, its members and every project, to the owner and the admins', async () => {
      for (const person of [a.owner, a.admin]) {
        const res = await exportOf(a.organization.id, person).expect(200);
        expect(res.headers['content-type']).toBe('application/zip');
        expect(res.headers['content-disposition']).toBe(
          `attachment; filename="${a.organization.slug}-export-${new Date().toISOString().slice(0, 10)}.zip"`,
        );
        const entries = readZip(res.body);

        const folders = a.projectIds.map(id =>
          [...entries.keys()]
            .find(name => name.startsWith('projects/') && name.includes(id))
            .split('/')
            .slice(0, 2)
            .join('/'),
        );
        expect([...entries.keys()].sort(byText)).toEqual(
          [
            'organization.json',
            'members.json',
            ...folders.flatMap(folder => [
              `${folder}/project.json`,
              `${folder}/terms.json`,
              `${folder}/labels.json`,
              `${folder}/translations/de.json`,
              `${folder}/translations/en.json`,
            ]),
          ].sort(byText),
        );
        expect(folders.sort(byText)).toEqual([`projects/app-a-${a.projectIds[1]}`, `projects/website-a-${a.projectIds[0]}`].sort(byText));

        const organization = zipJson(entries, 'organization.json');
        expect(organization).toMatchObject({
          format: 'ever-traduora-organization-export/1',
          exportedBy: { name: person.name, email: person.email },
          organization: { id: a.organization.id, name: 'Data A', slug: a.organization.slug, status: 'active', planCode: 'starter' },
          plan: { code: 'starter', name: 'Starter' },
          usage: { strings: { used: 8, limit: 10000 }, seats: { included: 15 } },
        });
        expect(zipJson(entries, 'members.json')).toEqual([
          { name: a.owner.name, email: a.owner.email, role: 'owner' },
          { name: a.admin.name, email: a.admin.email, role: 'admin' },
          { name: a.member.name, email: a.member.email, role: 'member' },
        ]);

        const website = `projects/website-a-${a.projectIds[0]}`;
        expect(zipJson(entries, `${website}/project.json`)).toMatchObject({
          id: a.projectIds[0],
          name: 'Website A',
          locales: ['de', 'en'],
          members: expect.arrayContaining([
            { name: a.owner.name, email: a.owner.email, role: 'admin' },
            { name: a.member.name, email: a.member.email, role: 'editor' },
          ]),
        });
        expect(zipJson(entries, `${website}/terms.json`).map(term => [term.value, term.context, term.labels])).toEqual([
          ['bye.a', null, []],
          ['hello.a', 'greeting', ['web-a']],
        ]);
        // With the translations each label is on (the label of the term went to its translations)
        expect(zipJson(entries, `${website}/labels.json`)).toEqual([{ value: 'web-a', color: '#336699', translations: expect.any(Array) }]);
        const onTranslations = zipJson(entries, `${website}/labels.json`)[0].translations;
        expect(onTranslations.every(on => on.term === 'hello.a' && ['de', 'en'].includes(on.locale))).toBe(true);
        expect(zipJson(entries, `${website}/translations/de.json`)).toEqual({ 'bye.a': '', 'hello.a': 'Hallo A' });
        expect(zipJson(entries, `${website}/translations/en.json`)).toEqual({ 'bye.a': '', 'hello.a': 'Hello A' });

        // Nothing of the other organization
        const all = [...entries.values()].map(entry => entry.toString('utf8')).join('\n');
        expect(all).not.toContain('hello.b');
        expect(all).not.toContain(b.owner.email);
      }
    });

    it('writes the same translations as the project export', async () => {
      const projectExport = await request(server())
        .get(`/api/v1/projects/${a.projectIds[0]}/exports`)
        .query({ locale: 'de', format: 'jsonflat' })
        .set(as(a.owner))
        .buffer(true)
        .parse(binary)
        .expect(200);
      const entries = readZip((await exportOf(a.organization.id, a.owner).expect(200)).body);
      expect(entries.get(`projects/website-a-${a.projectIds[0]}/translations/de.json`).toString('utf8')).toBe(projectExport.body.toString('utf8'));
    });

    it("refuses the members, the other organization's people and API keys", async () => {
      await exportOf(a.organization.id, a.member).expect(404);
      for (const person of [b.owner, b.admin, b.member]) {
        await exportOf(a.organization.id, person).expect(404);
      }
      await exportOf(a.organization.id, { accessToken: a.keyToken }).expect(401);
      await request(server()).get(`/api/v1/organizations/${a.organization.id}/export`).expect(401);
    });

    it('runs one export of an organization at a time', async () => {
      let release: () => void;
      const gate = new Promise<void>(resolve => (release = resolve));
      const original = (OrganizationExport.prototype as any).writeProject;
      jest.spyOn(OrganizationExport.prototype as any, 'writeProject').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
        await gate;
        return original.apply(this, args);
      });
      const first = exportOf(a.organization.id, a.owner).then(res => res);
      // The first one waits at its first project; a second one is refused meanwhile, by anyone
      await new Promise(resolve => setTimeout(resolve, 300));
      for (const person of [a.owner, a.admin]) {
        const second = await request(server()).get(`/api/v1/organizations/${a.organization.id}/export`).set(as(person)).expect(409);
        expect(second.body.error.code).toBe('export_running');
      }
      // Another organization's export runs
      await exportOf(b.organization.id, b.owner).expect(200);
      release();
      expect(readZip((await first).body).size).toBeGreaterThan(2);
      // Once it is done, the next one runs
      await exportOf(a.organization.id, a.owner).expect(200);
    });

    it('breaks the download off when the organization is suspended during the export', async () => {
      const original = (OrganizationExport.prototype as any).writeProject;
      jest.spyOn(OrganizationExport.prototype as any, 'writeProject').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
        await original.apply(this, args);
        await dataSource.getRepository(Organization).update({ id: a.organization.id }, { status: OrganizationStatus.Suspended });
      });
      try {
        const outcome = await exportOf(a.organization.id, a.owner).then(
          res => ({ body: res.body as Buffer }),
          error => ({ error }),
        );
        if ('body' in outcome) {
          // Ended without the end record: not an archive anyone can take as whole
          expect(() => readZip(outcome.body)).toThrow();
        } else {
          expect(outcome.error).toBeTruthy();
        }
      } finally {
        await dataSource.getRepository(Organization).update({ id: a.organization.id }, { status: OrganizationStatus.Active });
      }
      // The claim was released with the broken download
      await exportOf(a.organization.id, a.owner).expect(200);
    });

    it('refuses a suspended organization', async () => {
      await dataSource.getRepository(Organization).update({ id: a.organization.id }, { status: OrganizationStatus.Suspended });
      try {
        const res = await request(server()).get(`/api/v1/organizations/${a.organization.id}/export`).set(as(a.owner)).expect(403);
        expect(res.body.error.code).toBe('organization_suspended');
      } finally {
        await dataSource.getRepository(Organization).update({ id: a.organization.id }, { status: OrganizationStatus.Active });
      }
    });
  });

  describe('deletion', () => {
    it('needs the owner', async () => {
      for (const person of [a.admin, a.member, b.owner]) {
        await request(server()).delete(`/api/v1/organizations/${a.organization.id}`).set(as(person)).send({ slug: a.organization.slug }).expect(404);
      }
      await request(server())
        .delete(`/api/v1/organizations/${a.organization.id}`)
        .set(as({ accessToken: a.keyToken }))
        .send({ slug: a.organization.slug })
        .expect(401);
      expect(billing.calls).toEqual([]);
      expect((await snapshot(a)).projects).toHaveLength(2);
    });

    it('needs the slug typed', async () => {
      const before = await snapshot(a);
      for (const slug of ['', 'not-the-slug', `${a.organization.slug}x`]) {
        const res = await request(server()).delete(`/api/v1/organizations/${a.organization.id}`).set(as(a.owner)).send({ slug });
        expect([slug, res.status]).toEqual([slug, 400]);
        if (slug) {
          expect(res.body.error.code).toBe('slug_mismatch');
        }
      }
      await request(server()).delete(`/api/v1/organizations/${a.organization.id}`).set(as(a.owner)).expect(400);
      expect(billing.calls).toEqual([]);
      expect(await snapshot(a)).toEqual(before);
    });

    it('cancels nothing when the deletion is refused under its locks, after the choice', async () => {
      const before = await snapshot(a);
      // Between the request's checks and the deletion's locks, an operator suspends the organization
      const lock = membership.lockOrganization;
      jest.spyOn(membership, 'lockOrganization').mockImplementationOnce(async (tx, organizationId) => {
        await dataSource.getRepository(Organization).update({ id: organizationId }, { status: OrganizationStatus.Suspended });
        return lock(tx, organizationId);
      });
      try {
        const res = await request(server()).delete(`/api/v1/organizations/${a.organization.id}`).set(as(a.owner)).send({ slug: a.organization.slug });
        expect([res.status, res.body.error?.code]).toEqual([403, 'organization_suspended']);
      } finally {
        await dataSource.getRepository(Organization).update({ id: a.organization.id }, { status: OrganizationStatus.Active });
      }
      expect(billing.calls).toEqual([]);
      expect(await dataSource.getRepository(OrganizationBillingCancellation).count()).toBe(0);
      expect(await snapshot(a)).toEqual(before);
    });

    it('cancels the subscription, deletes every project with its data, keeps the tombstone, leaves the other organization alone', async () => {
      const otherBefore = await snapshot(b);
      const keptAccounts = await dataSource.getRepository(User).count();
      await request(server())
        .delete(`/api/v1/organizations/${a.organization.id}`)
        .set(as(a.owner))
        .send({ slug: ` ${a.organization.slug.toUpperCase()} ` })
        .expect(204);
      // Once the deletion committed: the tombstone, without its projects
      expect(billing.calls).toEqual([a.organization.id]);
      expect(billing.seen).toEqual([{ status: OrganizationStatus.Deleted, projects: 0 }]);
      expect(await dataSource.getRepository(OrganizationBillingCancellation).findOneBy({ organizationId: a.organization.id })).toMatchObject({
        status: BillingCancellationStatus.Done,
        attempts: 1,
        lastError: null,
      });

      expect(await snapshot(a)).toEqual({
        organization: { name: 'Data A', slug: a.organization.slug, status: OrganizationStatus.Deleted },
        projects: [],
        terms: 0,
        locales: 0,
        translations: 0,
        history: 0,
        labels: 0,
        projectUsers: 0,
        projectInvites: 0,
        clients: 0,
        members: 0,
        invites: 0,
      });
      // Nothing left anywhere of its projects, and every account stays
      expect(await dataSource.getRepository(Project).count({ where: { id: In(a.projectIds) } })).toBe(0);
      expect(await dataSource.getRepository(ProjectUser).count({ where: { project: { id: In(a.projectIds) } } })).toBe(0);
      expect(await dataSource.getRepository(User).count()).toBe(keptAccounts);
      const tombstone = await dataSource.getRepository(Organization).findOneBy({ id: a.organization.id });
      expect(tombstone).toMatchObject({ status: OrganizationStatus.Deleted, seatsUsed: 0, stringsUsed: 0 });

      expect(await snapshot(b)).toEqual(otherBefore);
      await request(server()).get(`/api/v1/projects/${b.projectIds[0]}/terms`).set(as(b.member)).expect(200);
      await request(server())
        .get(`/api/v1/projects/${b.projectIds[0]}/terms`)
        .set(as({ accessToken: b.keyToken }))
        .expect(200);
    });

    it('locks its former people and its API key out, and lists it nowhere', async () => {
      for (const token of [a.owner.accessToken, a.admin.accessToken, a.member.accessToken]) {
        await request(server())
          .get(`/api/v1/organizations/${a.organization.id}`)
          .set({ Authorization: `Bearer ${token}` })
          .expect(404);
        const listed = (
          await request(server())
            .get('/api/v1/organizations')
            .set({ Authorization: `Bearer ${token}` })
            .expect(200)
        ).body.data.map(o => o.id);
        expect(listed).not.toContain(a.organization.id);
        await request(server())
          .get(`/api/v1/projects/${a.projectIds[0]}`)
          .set({ Authorization: `Bearer ${token}` })
          .expect(404);
      }
      await request(server())
        .get(`/api/v1/projects/${a.projectIds[0]}/terms`)
        .set(as({ accessToken: a.keyToken }))
        .expect(401);
      await request(server()).delete(`/api/v1/organizations/${a.organization.id}`).set(as(a.owner)).send({ slug: a.organization.slug }).expect(404);
      await exportOf(a.organization.id, a.owner).expect(404);
    });

    it('deletes the organization when billing fails, and leaves the cancellation to an operator, who retries it', async () => {
      const c = await makeSide('C');
      billing.calls.length = 0;
      billing.failing = 3;
      await request(server()).delete(`/api/v1/organizations/${c.organization.id}`).set(as(c.owner)).send({ slug: c.organization.slug }).expect(204);
      expect(billing.calls).toEqual([c.organization.id, c.organization.id, c.organization.id]);
      expect((await snapshot(c)).projects).toEqual([]);
      const failed = (await request(server()).get(`/api/v1/operator/organizations/${c.organization.id}`).set(as(operator)).expect(200)).body.data;
      expect(failed).toMatchObject({ status: 'deleted', billingCancellation: { status: 'failed', attempts: 3 } });
      expect(failed.billingCancellation.lastError).toContain('billing is down');
      const unsettled = await request(server()).get('/api/v1/operator/organizations').query({ billing: 'unsettled' }).set(as(operator)).expect(200);
      expect(unsettled.body.data.map(row => [row.id, row.billingCancellation])).toEqual([[c.organization.id, 'failed']]);

      // Only operators retry, with a reason
      await request(server())
        .post(`/api/v1/operator/organizations/${c.organization.id}/billing-cancellation`)
        .set(as(c.owner))
        .send({ reason: 'Retry now' })
        .expect(404);
      const retried = await request(server())
        .post(`/api/v1/operator/organizations/${c.organization.id}/billing-cancellation`)
        .set(as(operator))
        .send({ reason: 'Stripe is back' })
        .expect(200);
      expect(retried.body.data.billingCancellation).toMatchObject({ status: 'done', attempts: 4, lastError: null });
      expect(retried.body.data.audit[0]).toMatchObject({ action: 'retry_billing_cancellation', reason: 'Stripe is back' });
      expect(await dataSource.getRepository(OperatorAudit).count({ where: { organizationId: c.organization.id } })).toBe(1);
      expect((await request(server()).get('/api/v1/operator/organizations').query({ billing: 'unsettled' }).set(as(operator))).body.data).toEqual([]);
    });

    it('never deletes the default organization', async () => {
      const fallback = await dataSource.getRepository(Organization).findOneBy({ isDefault: true });
      await dataSource.getRepository(OrganizationUser).save({ organizationId: fallback.id, userId: b.owner.id, role: OrganizationRole.Owner });
      try {
        const res = await request(server()).delete(`/api/v1/organizations/${fallback.id}`).set(as(b.owner)).send({ slug: fallback.slug }).expect(400);
        expect(res.body.error.code).toBe('default_organization');
        const exported = await request(server()).get(`/api/v1/organizations/${fallback.id}/export`).set(as(b.owner)).expect(404);
        expect(exported.body.error.code).toBe('saas_disabled');
        expect((await dataSource.getRepository(Organization).findOneBy({ id: fallback.id })).status).toBe(OrganizationStatus.Active);
      } finally {
        await dataSource.getRepository(OrganizationUser).delete({ organizationId: fallback.id, userId: b.owner.id });
      }
    });
  });
});

describe('Organization export and deletion on a single-tenant install (e2e)', () => {
  let app: INestApplication;
  const saasBefore = config.saasEnabled;

  beforeAll(async () => {
    config.saasEnabled = false;
    app = await createAndMigrateApp();
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  it('has neither route, for the owner of the default organization either', async () => {
    const owner = await signupTestUser(app, 'single-owner@test.com');
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const organization = (await request(app.getHttpServer()).get('/api/v1/organizations').set(auth).expect(200)).body.data[0];
    expect(organization.role).toBe('owner');
    const exported = await request(app.getHttpServer()).get(`/api/v1/organizations/${organization.id}/export`).set(auth).expect(404);
    expect(exported.body.error.code).toBe('saas_disabled');
    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/organizations/${organization.id}`)
      .set(auth)
      .send({ slug: organization.slug })
      .expect(404);
    expect(deleted.body.error.code).toBe('saas_disabled');
    expect((await request(app.getHttpServer()).get(`/api/v1/organizations/${organization.id}`).set(auth).expect(200)).body.data.status).toBe(
      'active',
    );
  });
});
