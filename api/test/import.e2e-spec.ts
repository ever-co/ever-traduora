import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { jsonFlatExporter } from '../src/formatters/jsonflat';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('ImportController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;
  let testProject: TestingProject;

  let termOneId: string;
  let termTwoId: string;
  let jsonFlat100: string;
  let jsonFlatWithNewTerms: string;
  let norwayTranslations: string;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    anotherUser = await signupTestUser(app, 'another-user@test.com');
    testProject = await createTestProject(app, testingUser);

    jsonFlat100 = (await jsonFlatExporter({
      translations: new Array(100).fill(0).map((_, index) => ({ term: `term.${index}`, translation: `some ${index}` })),
    })) as string;

    jsonFlatWithNewTerms = (await jsonFlatExporter({
      translations: [
        {
          term: 'term.one',
          translation: 'eins?',
        },
        {
          term: 'term.three',
          translation: 'drei ⛄ 😀👍 🍉你好',
        },
      ],
    })) as string;

    norwayTranslations = (await jsonFlatExporter({
      translations: [
        {
          term: 'term.one',
          translation: 'some one',
        },
        {
          term: 'term.two',
          translation: 'some two',
        },
      ],
    })) as string;

    // Pre-existing Terms
    {
      let res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          value: 'term.one',
        });

      termOneId = res.body.data.id;

      res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          value: 'term.two',
        });

      termTwoId = res.body.data.id;
    }

    // Locales

    {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          code: 'de_DE',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termOneId,
          value: 'eins',
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termTwoId,
          value: 'zwei',
        })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          code: 'fr',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termOneId,
          value: 'un',
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termTwoId,
          value: 'deux',
        })
        .expect(200);
    }
  });

  it('/api/v1/projects/:projectId/imports (POST) should automatically create locale for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=nb_NO&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(norwayTranslations), 'file')
      .expect(200)
      .expect({
        data: {
          terms: {
            added: 0,
            skipped: 2,
          },
          translations: {
            upserted: 2,
          },
        },
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/nb_NO`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'some one',
          labels: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'some two',
          labels: [],
        });
      });

    // Ensure did not affect other locales

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'eins',
          labels: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'zwei',
          labels: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'un',
          labels: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'deux',
          labels: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('term.one');
        expect(termValues).toContainEqual('term.two');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        const localeCodes = res.body.data.map(t => t.locale.code);
        expect(localeCodes).toContainEqual('de_DE');
        expect(localeCodes).toContainEqual('fr');
        expect(localeCodes).toContainEqual('nb_NO');
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should replace/add translations if locale already exists', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(jsonFlatWithNewTerms), 'file')
      .expect(200)
      .expect({
        data: {
          terms: {
            added: 1,
            skipped: 1,
          },
          translations: {
            upserted: 2,
          },
        },
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'eins?',
          labels: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'zwei',
          labels: [],
        });
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('drei ⛄ 😀👍 🍉你好');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'un',
          labels: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'deux',
          labels: [],
        });
      });
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('term.one');
        expect(termValues).toContainEqual('term.two');
        expect(termValues).toContainEqual('term.three');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const localeCodes = res.body.data.map(t => t.locale.code);
        expect(localeCodes).toContainEqual('de_DE');
        expect(localeCodes).toContainEqual('fr');
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should fail import if would exceed plan limits', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=es_MX&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(jsonFlat100), 'file')
      .expect(402);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'eins',
          labels: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'zwei',
          labels: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'un',
          labels: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'deux',
          labels: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('term.one');
        expect(termValues).toContainEqual('term.two');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const localeCodes = res.body.data.map(t => t.locale.code);
        expect(localeCodes).toContainEqual('de_DE');
        expect(localeCodes).toContainEqual('fr');
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should import CSV files with trailing empty columns', async () => {
    const csvWithTrailingColumns = 'term.csv.one,first translation,,,\nterm.csv.two,second translation,,,\n';

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=en&format=csv`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(csvWithTrailingColumns), 'file')
      .expect(200)
      .expect(res => {
        expect(res.body.data.terms.added).toEqual(2);
        expect(res.body.data.translations.upserted).toEqual(2);
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should reject malformed CSV files with a bad request error', async () => {
    const csvWithUnquotedDelimiter = 'term.csv.one,an unquoted, comma\n';

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=en&format=csv`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(csvWithUnquotedDelimiter), 'file')
      .expect(400)
      .expect(res => {
        expect(res.body.error.code).toEqual('BadRequest');
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should not count an existing locale again when importing new terms into it', async () => {
    const project = await createTestProject(app, testingUser);
    const sixtyTerms = (await jsonFlatExporter({
      translations: new Array(60).fill(0).map((_, index) => ({ term: `sixty.${index}`, translation: `value ${index}` })),
    })) as string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ code: 'de_DE' })
      .expect(201);

    // One locale and 60 strings in total, within the limit of 100
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(sixtyTerms), 'file')
      .expect(200)
      .expect({
        data: {
          terms: { added: 60, skipped: 0 },
          translations: { upserted: 60 },
        },
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should count a locale created by the import once', async () => {
    const project = await createTestProject(app, testingUser);
    const fortyTerms = (await jsonFlatExporter({
      translations: new Array(40).fill(0).map((_, index) => ({ term: `forty.${index}`, translation: `value ${index}` })),
    })) as string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(fortyTerms), 'file')
      .expect(200);

    // The same 40 terms into a new locale: two locales and 40 terms are 80 strings, within the limit of 100
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/imports?locale=fr&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(fortyTerms), 'file')
      .expect(200)
      .expect({
        data: {
          terms: { added: 0, skipped: 40 },
          translations: { upserted: 40 },
        },
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should refuse an import that goes one string over the plan limit', async () => {
    const project = await createTestProject(app, testingUser);
    const hundredTerms = (await jsonFlatExporter({
      translations: new Array(100).fill(0).map((_, index) => ({ term: `hundred.${index}`, translation: `value ${index}` })),
    })) as string;
    const oneMoreTerm = (await jsonFlatExporter({ translations: [{ term: 'one.more', translation: 'value' }] })) as string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ code: 'de_DE' })
      .expect(201);

    // One locale and 100 terms are exactly the limit of 100
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(hundredTerms), 'file')
      .expect(200);

    // One more term would make 101 strings
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(oneMoreTerm), 'file')
      .expect(402);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${project.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(100);
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should count the locale an import creates against the plan limit', async () => {
    const project = await createTestProject(app, testingUser);
    const fortyTerms = (await jsonFlatExporter({
      translations: new Array(40).fill(0).map((_, index) => ({ term: `forty.${index}`, translation: `value ${index}` })),
    })) as string;
    const elevenNewTerms = (await jsonFlatExporter({
      translations: new Array(11).fill(0).map((_, index) => ({ term: `eleven.${index}`, translation: `value ${index}` })),
    })) as string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(fortyTerms), 'file')
      .expect(200);

    // A new locale and 11 new terms: two locales and 51 terms are 102 strings, over the limit of 100
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/imports?locale=fr&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(elevenNewTerms), 'file')
      .expect(402);

    // The refused import kept nothing: no fr locale and still 40 terms
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${project.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.map(t => t.locale.code)).toEqual(['de_DE']);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${project.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(40);
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should import the units of every XLIFF group without an id', async () => {
    const xliff = `<?xml version="1.0" encoding="UTF-8" ?>
      <xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
        <file source-language="en" target-language="de" datatype="plaintext" original="ng2.template">
          <body>
            <group resname="g1">
              <trans-unit id="group.a">
                <source>Open</source>
                <target>Öffnen</target>
              </trans-unit>
            </group>
            <group resname="g2">
              <trans-unit id="group.b">
                <source>Close</source>
                <target>Schließen</target>
              </trans-unit>
            </group>
          </body>
        </file>
      </xliff>`;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=xliff12`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(xliff), 'file')
      .expect(200)
      .expect({
        data: {
          terms: { added: 2, skipped: 0 },
          translations: { upserted: 2 },
        },
      });

    const terms = await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200);
    const termIds = new Map<string, string>(terms.body.data.map(term => [term.value, term.id]));
    expect(termIds.has('group.a')).toBe(true);
    expect(termIds.has('group.b')).toBe(true);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const values = res.body.data.map(translation => ({ termId: translation.termId, value: translation.value }));
        expect(values).toContainEqual({ termId: termIds.get('group.a'), value: 'Öffnen' });
        expect(values).toContainEqual({ termId: termIds.get('group.b'), value: 'Schließen' });
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should not import if params are missing or invalid', async () => {
    // Missing payload
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=xliff12`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);

    // Missing locale
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?format=xliff12`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from('<xml />'), 'file')
      .expect(400);

    // Unknown locale
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_MX&format=xliff12`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from('<xml />'), 'file')
      .expect(404);
  });

  it('/api/v1/projects/:projectId/imports should not access imports resource if not authenticated', async () => {
    await request(app.getHttpServer()).post(`/api/v1/projects/${testProject.id}/imports`).attach('file', Buffer.from('<xml />'), 'file').expect(401);
  });

  it('/api/v1/projects/:projectId/imports should not access imports resource if not authorized', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=xliff12`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .attach('file', Buffer.from('<xml />'), 'file')
      .expect(404);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
