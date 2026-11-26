import { subjectHash } from '@ever-co/connect-sdk';
import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { FakeEverPlatform } from '../../test/fake-ever-platform';
import { config } from '../config';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverConnectPersonExport } from '../entity/ever-connect-person-export.entity';
import { EverConnectPersonLink } from '../entity/ever-connect-person-link.entity';
import { EverConnectPersonRequest } from '../entity/ever-connect-person-request.entity';
import { EverIdSession } from '../entity/ever-id-session.entity';
import { EverInstance } from '../entity/ever-instance.entity';
import { Project } from '../entity/project.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { IdentityLinkMethod, UserIdentity } from '../entity/user-identity.entity';
import { User } from '../entity/user.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EverInstanceSettings } from '../ever-instance/ever-instance.settings';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';
import { EverConnectAuditService } from './ever-connect-audit.service';
import {
  EverConnectPersonService,
  PERSON_EXPORT_TTL_MS,
  PERSON_LINK_CALLS_PER_SYNC,
  PERSON_LINK_RETRY_MS,
  personExportUrl,
  subjectHashesOf,
} from './ever-connect-person.service';
import { EverConnectSchedulerService } from './ever-connect-scheduler.service';
import { EverConnectService } from './ever-connect.service';
import { EverConnectSettings } from './ever-connect.settings';

const SETTINGS: EverConnectSettings = {
  apiUrl: 'http://127.0.0.1:8080',
  installSource: 'self-hosted',
  version: '0.23.0',
  connectCode: null,
  integrationsDeny: [],
  feedMode: 'interval',
  issuer: null,
  rootKeysFile: null,
  statsLoaded: false,
};

const INSTANCE_SETTINGS: EverInstanceSettings = { installSource: 'self-hosted', adminEmails: [], secret: 'unit-test-secret-of-this-installation' };

const ISSUER = 'https://auth.ever.test';
const DELETION = 'ever.registry.person.deletion_requested';
const EXPORT = 'ever.registry.person.export_requested';

// Runs the real migrations on an in-memory SQLite database: they follow TR_DB_TYPE, so only when it is SQLite (the
// default); the e2e suite covers the other databases
const describeOnSqlite = config.db.default.type === 'better-sqlite3' ? describe : describe.skip;

describeOnSqlite('EverConnectPersonService', () => {
  let dataSource: DataSource;
  let platform: FakeEverPlatform;
  let alice: User;
  let bob: User;

  const build = (settings: Partial<EverConnectSettings> = {}, instanceSettings: EverInstanceSettings = INSTANCE_SETTINGS) => {
    const all = { ...SETTINGS, ...settings };
    const instance = new EverInstanceService(dataSource.getRepository(EverInstance), instanceSettings);
    const audit = new EverConnectAuditService(dataSource.getRepository(EverConnectAudit));
    const connect = new EverConnectService(
      dataSource.getRepository(EverConnectConnection),
      dataSource.getRepository(EverConnectIntegration),
      all,
      instanceSettings,
      platform.factory,
      instance,
      audit,
    );
    const person = new EverConnectPersonService(
      dataSource.getRepository(EverConnectPersonLink),
      dataSource.getRepository(EverConnectPersonRequest),
      dataSource.getRepository(EverConnectPersonExport),
      dataSource.getRepository(EverConnectIntegration),
      dataSource.getRepository(UserIdentity),
      all,
      instanceSettings,
      connect,
      audit,
    );
    const scheduler = new EverConnectSchedulerService(dataSource.getRepository(EverConnectConnection), all, connect, false, person);
    return { connect, person, scheduler, audit };
  };

  const createUser = async (email: string, password?: string) => {
    const users = dataSource.getRepository(User);
    return users.save(users.create({ name: `Name of ${email}`, email, encryptedPassword: password ? Buffer.from(password) : null }));
  };

  const linkIdentity = async (
    user: User,
    subject: string,
    options: { method?: IdentityLinkMethod; personId?: string | null; issuer?: string } = {},
  ) => {
    const identities = dataSource.getRepository(UserIdentity);
    return identities.save(
      identities.create({
        user: { id: user.id },
        provider: 'everid',
        issuer: options.issuer || ISSUER,
        subject,
        everPersonId: options.personId === undefined ? `person-${subject}` : options.personId,
        emailAtLink: user.email,
        linkMethod: options.method || IdentityLinkMethod.Explicit,
        linkedAt: new Date(),
        lastLoginAt: null,
      }),
    );
  };

  const openSession = (user: User, sid: string) =>
    dataSource
      .getRepository(EverIdSession)
      .insert({ sid, userId: user.id, jti: 'j', issuedAt: new Date(), expiresAt: new Date(Date.now() + 3600000), revokedAt: null });

  const request = (type: string, jobId: string, hashes: string[]) => ({
    id: `evt-${jobId}`,
    type,
    data: { job_id: jobId, person_id: 'p', subject_hashes: hashes },
  });

  const connected = async (settings: Partial<EverConnectSettings> = {}, instanceSettings: EverInstanceSettings = INSTANCE_SETTINGS) => {
    const built = build(settings, instanceSettings);
    await built.connect.connect('EVC-TEST-0000-0001', 'Our translations', 'user:u1');
    platform.calls.length = 0;
    return built;
  };

  const enableEverIdLogin = async (connect: EverConnectService) => {
    platform.integrationStates.ever_id_login = { state: 'enabled', enabled: true, consentId: 'c-everid', scopeVersion: 2 };
    await connect.refreshIntegrations();
    platform.calls.length = 0;
  };

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      foreignKeys: true,
      entities: [join(__dirname, '../entity/*.entity.ts')],
      migrations: [join(__dirname, '../migrations/*.ts')],
      namingStrategy: new SnakeNamingStrategy(),
      logging: false,
    } as DataSourceOptions);
    await dataSource.initialize();
    await dataSource.runMigrations();
    platform = new FakeEverPlatform();
    alice = await createUser('alice@example.test', 'hashed-password');
    bob = await createUser('bob@example.test', 'hashed-password');
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('reads the subject hashes of a request, and nothing else', () => {
    const hash = subjectHash(ISSUER, 's1');
    expect(subjectHashesOf({ subject_hashes: [hash.toUpperCase(), 'nope', 42], subject_hash: hash })).toEqual([hash]);
    expect(subjectHashesOf(null)).toEqual([]);
  });

  /** The installation's address, as the operator reports it for `instance_url` (`null`: none reported). */
  const reportAddress = (baseUrl: string | null, state = 'enabled') =>
    dataSource.getRepository(EverConnectIntegration).save(
      dataSource.getRepository(EverConnectIntegration).create({
        key: 'instance_url',
        state,
        consentId: 'c-url',
        scopeVersion: 1,
        pendingRemoteRevoke: false,
        config: baseUrl ? JSON.stringify({ base_url: baseUrl }) : null,
        updatedAt: Date.now(),
      }),
    );

  it('offers an export only at an https address of this installation', () => {
    expect(personExportUrl('https://translate.example.test')).toBe('https://translate.example.test/user-settings');
    expect(personExportUrl('https://example.test/traduora/')).toBe('https://example.test/traduora/user-settings');
    expect(personExportUrl('http://localhost:8080')).toBeNull();
    expect(personExportUrl('https://user:pw@example.test')).toBeNull();
    expect(personExportUrl(undefined)).toBeNull();
  });

  const createProject = async (name: string, members: Array<[User, ProjectRole]>) => {
    const project = await dataSource.getRepository(Project).save(dataSource.getRepository(Project).create({ name, description: '' }));
    for (const [user, role] of members) {
      await dataSource.getRepository(ProjectUser).save(dataSource.getRepository(ProjectUser).create({ project, user, role }));
    }
    return project;
  };

  describe('deletion requests', () => {
    it('switched off (the default): removes the Ever ID, ends its sessions, keeps the account, answers account_deletion_pending', async () => {
      const { person } = await connected();
      await linkIdentity(alice, 's1');
      await linkIdentity(bob, 's2');
      await openSession(alice, 'sid-a');
      await openSession(bob, 'sid-b');
      const live = await build().connect.liveClient();

      await person.handleEvents(live.client, [request(DELETION, 'job-1', [subjectHash(ISSUER, 's1')])]);

      const identities = await dataSource.getRepository(UserIdentity).find({ relations: ['user'] });
      expect(identities.map(identity => identity.user.id)).toEqual([bob.id]);
      const sessions = await dataSource.getRepository(EverIdSession).find();
      expect(sessions.find(session => session.sid === 'sid-a').revokedAt).not.toBeNull();
      expect(sessions.find(session => session.sid === 'sid-b').revokedAt).toBeNull();
      // The account itself and its password stay
      const account = await dataSource.getRepository(User).findOne({ where: { id: alice.id } });
      expect(account.encryptedPassword).toBeTruthy();
      expect(platform.answers).toEqual([{ jobId: 'job-1', result: 'failed', reasonCode: 'account_deletion_pending' }]);
      const receipt = await dataSource.getRepository(EverConnectPersonRequest).findOne({ where: { jobId: 'job-1' } });
      expect(receipt).toMatchObject({ kind: 'deletion', result: 'failed', reasonCode: 'account_deletion_pending', accounts: 1 });
      expect(receipt.answeredAt).not.toBeNull();
      const audit = await dataSource.getRepository(EverConnectAudit).find({ order: { seq: 'ASC' } });
      const row = audit.find(entry => entry.action === 'person.deletion');
      expect(row.detail).toBe('result=failed accounts=1');
      expect(JSON.stringify(audit)).not.toContain('alice@example.test');
    });

    it('answers no_account when nothing matches, and deletes nothing', async () => {
      const { person } = await connected();
      await linkIdentity(alice, 's1');
      const live = await build().connect.liveClient();
      await person.handleEvents(live.client, [request(DELETION, 'job-2', [subjectHash(ISSUER, 'someone-else')])]);
      expect(await dataSource.getRepository(UserIdentity).count()).toBe(1);
      expect(platform.answers).toEqual([{ jobId: 'job-2', result: 'no_account' }]);
    });

    it('answers a request read again the same way, and only once', async () => {
      const { person } = await connected();
      await linkIdentity(alice, 's1');
      const live = await build().connect.liveClient();
      const event = request(DELETION, 'job-3', [subjectHash(ISSUER, 's1')]);

      // The answer cannot be sent: the page is read again later
      platform.unreachable = true;
      await expect(person.handleEvents(live.client, [event])).rejects.toThrow();
      platform.unreachable = false;
      expect(await dataSource.getRepository(UserIdentity).count()).toBe(0);

      // The identity is gone by now, yet the decided answer is kept
      await person.handleEvents(live.client, [event]);
      expect(platform.answers).toEqual([{ jobId: 'job-3', result: 'failed', reasonCode: 'account_deletion_pending' }]);
      await person.handleEvents(live.client, [event]);
      expect(platform.answers).toHaveLength(1);
    });

    it('does not send again an answer Ever Platform already holds', async () => {
      const { person } = await connected();
      const live = await build().connect.liveClient();
      platform.answerProblem = { status: 409, code: 'receipt_final' };
      await person.handleEvents(live.client, [request(DELETION, 'job-4', [])]);
      const receipt = await dataSource.getRepository(EverConnectPersonRequest).findOne({ where: { jobId: 'job-4' } });
      expect(receipt.answeredAt).not.toBeNull();
      platform.calls.length = 0;
      await person.handleEvents(live.client, [request(DELETION, 'job-4', [])]);
      expect(platform.names()).toEqual([]);
    });

    it('switched on: deletes the account as Delete account does, and answers deleted', async () => {
      const { person } = await connected({ personDeletionEnabled: true });
      await linkIdentity(alice, 's1');
      await openSession(alice, 'sid-a');
      // A member of Bob's project: the membership goes with the account, the project stays
      const project = await createProject('Shared', [
        [bob, ProjectRole.Admin],
        [alice, ProjectRole.Editor],
      ]);
      const live = await build().connect.liveClient();

      await person.handleEvents(live.client, [request(DELETION, 'job-d1', [subjectHash(ISSUER, 's1')])]);

      expect(platform.answers).toEqual([{ jobId: 'job-d1', result: 'deleted' }]);
      expect(await dataSource.getRepository(User).count({ where: { id: alice.id } })).toBe(0);
      expect(await dataSource.getRepository(User).count({ where: { id: bob.id } })).toBe(1);
      const members = await dataSource.getRepository(ProjectUser).find({ where: { project: { id: project.id } }, relations: { user: true } });
      expect(members.map(member => member.user.id)).toEqual([bob.id]);
      // Ever Platform is still told to remove her person link
      expect(await dataSource.getRepository(EverConnectPersonLink).count({ where: { userId: alice.id } })).toBe(1);
    });

    it('switched on, but the account is the last admin of a project: kept, account_deletion_pending', async () => {
      const { person } = await connected({ personDeletionEnabled: true });
      await linkIdentity(alice, 's1');
      await createProject('Her own', [[alice, ProjectRole.Admin]]);
      const live = await build().connect.liveClient();

      await person.handleEvents(live.client, [request(DELETION, 'job-d2', [subjectHash(ISSUER, 's1')])]);

      expect(platform.answers).toEqual([{ jobId: 'job-d2', result: 'failed', reasonCode: 'account_deletion_pending' }]);
      expect(await dataSource.getRepository(User).count({ where: { id: alice.id } })).toBe(1);
      // Her Ever ID goes all the same
      expect(await dataSource.getRepository(UserIdentity).count()).toBe(0);
    });

    it('switched on: an admin of a project with another admin is deleted', async () => {
      const { person } = await connected({ personDeletionEnabled: true });
      await linkIdentity(alice, 's1');
      await createProject('Two admins', [
        [alice, ProjectRole.Admin],
        [bob, ProjectRole.Admin],
      ]);
      const live = await build().connect.liveClient();
      await person.handleEvents(live.client, [request(DELETION, 'job-d3', [subjectHash(ISSUER, 's1')])]);
      expect(platform.answers).toEqual([{ jobId: 'job-d3', result: 'deleted' }]);
      expect(await dataSource.getRepository(User).count({ where: { id: alice.id } })).toBe(0);
    });

    it('switched on: two matched accounts that are the only admins of a project are both kept', async () => {
      const { person } = await connected({ personDeletionEnabled: true });
      await linkIdentity(alice, 's1');
      await linkIdentity(bob, 's2');
      await createProject('Theirs', [
        [alice, ProjectRole.Admin],
        [bob, ProjectRole.Admin],
      ]);
      const live = await build().connect.liveClient();
      await person.handleEvents(live.client, [request(DELETION, 'job-d5', [subjectHash(ISSUER, 's1'), subjectHash(ISSUER, 's2')])]);
      expect(platform.answers).toEqual([{ jobId: 'job-d5', result: 'failed', reasonCode: 'account_deletion_pending' }]);
      expect(await dataSource.getRepository(User).count()).toBe(2);
    });

    it('switched on, but the account operates this installation: kept', async () => {
      const { person } = await connected({ personDeletionEnabled: true }, { ...INSTANCE_SETTINGS, adminEmails: ['alice@example.test'] });
      await linkIdentity(alice, 's1');
      const live = await build().connect.liveClient();
      await person.handleEvents(live.client, [request(DELETION, 'job-d4', [subjectHash(ISSUER, 's1')])]);
      expect(platform.answers).toEqual([{ jobId: 'job-d4', result: 'failed', reasonCode: 'account_deletion_pending' }]);
      expect(await dataSource.getRepository(User).count({ where: { id: alice.id } })).toBe(1);
    });

    it('ignores a request without a usable request id', async () => {
      const { person } = await connected();
      const live = await build().connect.liveClient();
      await person.handleEvents(live.client, [{ id: 'e', type: DELETION, data: { job_id: '../x', subject_hashes: [] } }]);
      expect(platform.names()).toEqual([]);
      expect(await dataSource.getRepository(EverConnectPersonRequest).count()).toBe(0);
    });
  });

  describe('export requests', () => {
    const EXPORTS_ON: Partial<EverConnectSettings> = { personExportEnabled: true };

    it('switched off (the default): makes no export and answers export_not_available', async () => {
      const { person } = await connected();
      await linkIdentity(alice, 's1');
      const live = await build().connect.liveClient();
      await person.handleEvents(live.client, [request(EXPORT, 'job-e1', [subjectHash(ISSUER, 's1')])]);
      expect(platform.answers).toEqual([{ jobId: 'job-e1', result: 'failed', reasonCode: 'export_not_available' }]);
      expect(await dataSource.getRepository(EverConnectPersonExport).count()).toBe(0);
    });

    it('an exported answer that can no longer name its address is sent as export_not_available', async () => {
      const { person } = await connected(EXPORTS_ON);
      await reportAddress('https://translate.example.test');
      await linkIdentity(alice, 's1');
      const live = await build().connect.liveClient();
      const event = request(EXPORT, 'job-e3', [subjectHash(ISSUER, 's1')]);
      platform.unreachable = true;
      await expect(person.handleEvents(live.client, [event])).rejects.toThrow();
      platform.unreachable = false;

      // The address is withdrawn meanwhile
      await reportAddress(null, 'disabled');
      const restarted = build(EXPORTS_ON).person;
      await restarted.handleEvents(live.client, [event]);
      expect(platform.answers).toEqual([{ jobId: 'job-e3', result: 'failed', reasonCode: 'export_not_available' }]);
      const receipt = await dataSource.getRepository(EverConnectPersonRequest).findOne({ where: { jobId: 'job-e3' } });
      expect(receipt).toMatchObject({ result: 'failed', reasonCode: 'export_not_available' });
      expect(receipt.answeredAt).not.toBeNull();
    });

    it('switched on without a reported https address of this installation: makes no export', async () => {
      const { person } = await connected(EXPORTS_ON);
      await linkIdentity(alice, 's1');
      const live = await build().connect.liveClient();
      // No address reported (instance_url not enabled), then an http one
      await person.handleEvents(live.client, [request(EXPORT, 'job-e2', [subjectHash(ISSUER, 's1')])]);
      await reportAddress('http://localhost:8080');
      await person.handleEvents(live.client, [request(EXPORT, 'job-e4', [subjectHash(ISSUER, 's1')])]);
      expect(platform.answers).toEqual([
        { jobId: 'job-e2', result: 'failed', reasonCode: 'export_not_available' },
        { jobId: 'job-e4', result: 'failed', reasonCode: 'export_not_available' },
      ]);
      expect(await dataSource.getRepository(EverConnectPersonExport).count()).toBe(0);
    });

    it('makes one encrypted export per account, readable by that account only, for 7 days', async () => {
      const { person } = await connected(EXPORTS_ON);
      await reportAddress('https://translate.example.test/');
      await linkIdentity(alice, 's1');
      await linkIdentity(bob, 's2');
      const project = await dataSource.getRepository(Project).save(dataSource.getRepository(Project).create({ name: 'Website', description: '' }));
      await dataSource
        .getRepository(ProjectUser)
        .save(dataSource.getRepository(ProjectUser).create({ project, user: alice, role: ProjectRole.Editor }));
      const live = await build().connect.liveClient();

      await person.handleEvents(live.client, [request(EXPORT, 'job-5', [subjectHash(ISSUER, 's1')])]);

      expect(platform.answers).toEqual([{ jobId: 'job-5', result: 'exported', exportUrl: 'https://translate.example.test/user-settings' }]);
      const stored = await dataSource.getRepository(EverConnectPersonExport).find();
      expect(stored).toHaveLength(1);
      // Stored encrypted: no e-mail, name or project in clear
      expect(stored[0].bundleEnc).not.toContain('alice');
      expect(stored[0].expiresAt - stored[0].createdAt).toBe(PERSON_EXPORT_TTL_MS);

      const bundle = await person.download('job-5', alice.id);
      expect(bundle).toMatchObject({
        format: 'ever-traduora.person-export.v1',
        account: { id: alice.id, email: 'alice@example.test', name: 'Name of alice@example.test' },
        identities: [{ provider: 'everid', issuer: ISSUER, subject: 's1', link_method: 'explicit' }],
        projects: [{ id: project.id, name: 'Website', role: 'editor' }],
        translation_changes: 0,
      });
      expect(JSON.stringify(bundle)).not.toContain('bob@example.test');
      expect(JSON.stringify(bundle)).not.toContain('hashed-password');
      expect((await person.listExports(alice.id)).map(item => item.jobId)).toEqual(['job-5']);
      await expect(person.download('job-5', bob.id)).rejects.toMatchObject({ status: 404 });
      expect(await person.listExports(bob.id)).toEqual([]);

      // Expired: gone for the account, then deleted
      await dataSource.getRepository(EverConnectPersonExport).update({ jobId: 'job-5' }, { expiresAt: Date.now() - 1 });
      await expect(person.download('job-5', alice.id)).rejects.toMatchObject({ status: 404 });
      await person.sweep(Date.now(), true);
      expect(await dataSource.getRepository(EverConnectPersonExport).count()).toBe(0);
    });

    it('answers no_account when nothing matches', async () => {
      const { person } = await connected(EXPORTS_ON);
      const live = await build().connect.liveClient();
      await person.handleEvents(live.client, [request(EXPORT, 'job-6', [subjectHash(ISSUER, 'nobody')])]);
      expect(platform.answers).toEqual([{ jobId: 'job-6', result: 'no_account' }]);
      expect(await dataSource.getRepository(EverConnectPersonExport).count()).toBe(0);
    });
  });

  describe('person links', () => {
    it('reports nothing while ever_id_login is not enabled', async () => {
      const { person } = await connected();
      await linkIdentity(alice, 's1');
      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 0, removed: 0 });
      expect(platform.names()).toEqual([]);
    });

    it('reports nothing before an operator connects', async () => {
      const { person } = build();
      await linkIdentity(alice, 's1');
      await person.syncLinks(Date.now(), true);
      expect(platform.calls).toEqual([]);
    });

    it('stops a round once the scheduler lost its lease', async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      await linkIdentity(alice, 's1', { method: IdentityLinkMethod.Explicit });
      await linkIdentity(bob, 's2', { method: IdentityLinkMethod.Jit });
      let asked = 0;
      expect(await person.syncLinks(Date.now(), true, async () => ++asked <= 1)).toEqual({ reported: 1, removed: 0 });
      // The next round (with the lease) reports the other one
      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 1, removed: 0 });
    });

    it('reports each Ever ID a user signed in with, once, and never anything else', async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      const carol = await createUser('carol@example.test');
      const dave = await createUser('dave@example.test');
      await linkIdentity(alice, 's1', { method: IdentityLinkMethod.Explicit });
      await linkIdentity(bob, 's2', { method: IdentityLinkMethod.Jit });
      // Another OpenID Connect issuer (no Ever person id), and a link the user never made: not reported
      await linkIdentity(carol, 's3', { personId: null, issuer: 'https://idp.example.test' });
      await linkIdentity(dave, 's4', { method: IdentityLinkMethod.Provisioned });

      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 2, removed: 0 });
      expect(platform.personLinks[alice.id]).toEqual({
        productUserRef: alice.id,
        identityIssuer: ISSUER,
        identitySubject: 's1',
        linkMethod: 'explicit',
        productTenantId: '*',
        tenantLinkId: '01JMQCKLINK000000000000000',
        displayName: 'Our translations',
      });
      expect(platform.personLinks[bob.id]).toMatchObject({ identitySubject: 's2', linkMethod: 'confirmed' });
      // No e-mail and no name in what was sent
      expect(JSON.stringify(platform.calls)).not.toContain('@example.test');

      platform.calls.length = 0;
      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 0, removed: 0 });
      expect(platform.calls).toEqual([]);
    });

    it('removes the link of a deleted Ever ID, and keeps reporting the others', async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      await linkIdentity(alice, 's1');
      await linkIdentity(bob, 's2');
      await person.syncLinks(Date.now(), true);
      const live = await connect.liveClient();

      await person.handleEvents(live.client, [request(DELETION, 'job-7', [subjectHash(ISSUER, 's1')])]);
      expect(await person.syncLinks(Date.now())).toEqual({ reported: 0, removed: 1 });
      expect(Object.keys(platform.personLinks)).toEqual([bob.id]);
      expect(await dataSource.getRepository(EverConnectPersonLink).count()).toBe(1);
    });

    it('keeps a removal Ever Platform could not be told, and tells it later', async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      const identity = await linkIdentity(alice, 's1');
      await person.syncLinks(Date.now(), true);
      await dataSource.getRepository(UserIdentity).delete({ id: identity.id });

      platform.unreachable = true;
      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 0, removed: 0 });
      platform.unreachable = false;
      // Not before its retry time
      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 0, removed: 0 });
      expect(await person.syncLinks(Date.now() + PERSON_LINK_RETRY_MS + 1000, true)).toEqual({ reported: 0, removed: 1 });
      expect(platform.personLinks).toEqual({});
    });

    it('lets a link Ever Platform refuses wait, so the others are reported meanwhile', async () => {
      const { connect } = await connected();
      await enableEverIdLogin(connect);
      await linkIdentity(alice, 's1');
      platform.refuseLinksOf.add(alice.id);
      const { person: retrying } = build();
      expect(await retrying.syncLinks(Date.now(), true)).toEqual({ reported: 0, removed: 0 });
      await linkIdentity(bob, 's2');
      // Alice waits for her retry time; Bob is reported
      expect(await retrying.syncLinks(Date.now(), true)).toEqual({ reported: 1, removed: 0 });
      expect(Object.keys(platform.personLinks)).toEqual([bob.id]);
      platform.refuseLinksOf.clear();
      expect(await retrying.syncLinks(Date.now() + PERSON_LINK_RETRY_MS + 1000, true)).toEqual({ reported: 1, removed: 0 });
      expect(Object.keys(platform.personLinks).sort()).toEqual([alice.id, bob.id].sort());
    });

    it("reports a link again when the installation's tenant link changed", async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      await linkIdentity(alice, 's1');
      await person.syncLinks(Date.now(), true);
      expect(platform.personLinks[alice.id].tenantLinkId).toBe('01JMQCKLINK000000000000000');
      // The link was unlinked at Ever Platform: the report no longer names it
      await dataSource.getRepository(EverConnectConnection).update({ id: 'self' }, { linkState: 'unlinked' });
      platform.calls.length = 0;
      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 1, removed: 0 });
      expect(platform.personLinks[alice.id].tenantLinkId).toBeUndefined();
      expect(await person.syncLinks(Date.now(), true)).toEqual({ reported: 0, removed: 0 });
    });

    it('stops reporting when the integration is denied here, and reports again once it is allowed', async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      await linkIdentity(alice, 's1');
      await person.syncLinks(Date.now(), true);

      const denied = build({ integrationsDeny: ['ever_id_login'] }).person;
      platform.calls.length = 0;
      await denied.syncLinks(Date.now(), true);
      expect(platform.calls).toEqual([]);
      expect((await dataSource.getRepository(EverConnectPersonLink).findOne({ where: { userId: alice.id } })).reportedAt).toBeNull();

      await person.syncLinks(Date.now(), true);
      expect(platform.names()).toEqual(['reportPersonLink']);
    });

    it('sends at most a batch of reports per comparison, and the rest with the next one', async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      for (let index = 0; index < PERSON_LINK_CALLS_PER_SYNC + 2; index += 1) {
        await linkIdentity(await createUser(`user-${index}@example.test`), `bulk-${index}`);
      }
      expect((await person.syncLinks(Date.now(), true)).reported).toBe(PERSON_LINK_CALLS_PER_SYNC);
      // More to tell: the next comparison does not wait 5 minutes
      expect((await person.syncLinks(Date.now())).reported).toBe(2);
    });

    it('forgets every person link when the installation disconnects', async () => {
      const { connect, person } = await connected();
      await enableEverIdLogin(connect);
      await linkIdentity(alice, 's1');
      await person.syncLinks(Date.now(), true);
      await connect.disconnect('user:u1');
      expect(await dataSource.getRepository(EverConnectPersonLink).count()).toBe(0);
    });
  });

  it('answers a request read from the feed, then acknowledges the page', async () => {
    const { scheduler } = await connected();
    await linkIdentity(alice, 's1');
    platform.events = [request(DELETION, 'job-8', [subjectHash(ISSUER, 's1')])];
    await scheduler.readFeed(0);
    expect(platform.names()).toEqual(['events', 'answerPersonRequest', 'ack']);
    expect((await build().connect.read()).feedCursor).toBe('evt-job-8');
  });

  it('keeps the page unacknowledged when an answer cannot be sent', async () => {
    const { scheduler } = await connected();
    platform.events = [request(EXPORT, 'job-9', [])];
    platform.answerProblem = { status: 503, code: 'unavailable' };
    await scheduler.readFeed(0);
    expect(platform.names()).toEqual(['events', 'answerPersonRequest']);
    expect((await build().connect.read()).feedCursor).toBeNull();
  });
});
