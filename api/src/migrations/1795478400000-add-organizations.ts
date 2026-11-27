import { randomUUID } from 'crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { config } from '../config';
import { normalizeEmail } from '../domain/validators';
import { DbType } from '../utils/database-type-helper';
import { createTables, dropTables, engineColumnName, quoteName, TableSpec } from '../utils/ever-platform-tables';

/** Organizations (DESIGN §4.1–§4.3), written once and rendered for postgres, mysql and better-sqlite3. */
const TABLES: TableSpec[] = [
  {
    name: 'organization',
    engineNaming: true,
    columns: [
      { name: 'id', type: 'uuid', generated: true },
      { name: 'name', type: 'varchar', length: 255 },
      { name: 'slug', type: 'varchar', length: 40 },
      { name: 'status', type: 'varchar', length: 16, defaultText: 'active' },
      { name: 'plan_code', type: 'varchar', length: 32, defaultText: 'starter' },
      { name: 'is_default', type: 'boolean', default: 0 },
      // Whether owners and admins are implicit admins of every project (organizations made in SaaS mode); never for the
      // default organization, whose people get exactly the access they had
      { name: 'admins_see_all_projects', type: 'boolean', default: 0 },
      { name: 'seats_used', type: 'int', default: 0 },
      { name: 'strings_used', type: 'int', default: 0 },
      { name: 'date_created', type: 'timestamp', defaultNow: true },
      { name: 'date_modified', type: 'timestamp', defaultNow: true },
    ],
    primary: ['id'],
    uniques: [{ name: 'UQ_organization_slug', columns: ['slug'] }],
  },
  {
    name: 'organization_user',
    engineNaming: true,
    columns: [
      { name: 'id', type: 'uuid', generated: true },
      { name: 'organization_id', type: 'uuid' },
      { name: 'user_id', type: 'uuid' },
      { name: 'role', type: 'varchar', length: 16, defaultText: 'member' },
      { name: 'date_created', type: 'timestamp', defaultNow: true },
      { name: 'date_modified', type: 'timestamp', defaultNow: true },
    ],
    primary: ['id'],
    uniques: [{ name: 'UQ_organization_user_organization_user', columns: ['organization_id', 'user_id'] }],
    foreignKeys: [
      { name: 'FK_organization_user_organization', column: 'organization_id', table: 'organization', onDelete: 'CASCADE' },
      { name: 'FK_organization_user_user', column: 'user_id', table: 'user', onDelete: 'CASCADE' },
    ],
  },
  {
    name: 'organization_invite',
    engineNaming: true,
    columns: [
      { name: 'id', type: 'uuid', generated: true },
      { name: 'organization_id', type: 'uuid' },
      { name: 'email', type: 'varchar', length: 255 },
      { name: 'role', type: 'varchar', length: 16, defaultText: 'member' },
      { name: 'status', type: 'varchar', length: 16, defaultText: 'sent' },
      { name: 'token_hash', type: 'varchar', length: 64, nullable: true },
      { name: 'invited_by_user_id', type: 'varchar', length: 64, nullable: true },
      { name: 'date_created', type: 'timestamp', defaultNow: true },
      { name: 'date_modified', type: 'timestamp', defaultNow: true },
    ],
    primary: ['id'],
    uniques: [{ name: 'UQ_organization_invite_organization_email', columns: ['organization_id', 'email'] }],
    foreignKeys: [{ name: 'FK_organization_invite_organization', column: 'organization_id', table: 'organization', onDelete: 'CASCADE' }],
  },
];

interface IndexSpec {
  name: string;
  table: string;
  column: string;
  /** MySQL creates an index for a foreign key itself: a second one there would only be a duplicate. */
  skipOnMysql?: boolean;
}

const INDEXES: IndexSpec[] = [
  { name: 'IDX_organization_user_user_id', table: 'organization_user', column: 'user_id', skipOnMysql: true },
  { name: 'IDX_organization_invite_email', table: 'organization_invite', column: 'email' },
  { name: 'IDX_organization_invite_token_hash', table: 'organization_invite', column: 'token_hash' },
  { name: 'IDX_project_organization_id', table: 'project', column: 'organization_id' },
];

const PROJECT_FK = 'FK_project_organization';

/** SQLite keeps `project.organization_id` without a REFERENCES clause (see below); these triggers stand in for it. */
const SQLITE_TRIGGERS = ['fk_project_organization_insert', 'fk_project_organization_update', 'fk_project_organization_delete'];

/**
 * Adds organizations (DESIGN §4.6) and puts every existing project and user into the **default organization**. Only adds
 * tables, a column and rows: no existing value changes, and nobody gets access they did not have. Safe to run again
 * after an interruption (MySQL commits each DDL statement on its own): every step looks before it writes.
 *
 * 1. Creates `organization`, `organization_user`, `organization_invite`, and `project.organization_id` with its index.
 * 2. Creates the default organization when none exists, also on an empty database (single-tenant sign-ups and the seed
 *    join it): `slug` default, the name of `TR_DEFAULT_ORGANIZATION_NAME`, plan `enterprise`, and
 *    `admins_see_all_projects` false, so its owner sees exactly the projects they had.
 * 3. Moves every project without an organization into it.
 * 4. Makes every user a `member`, except exactly one `owner`: the user with `TR_ADMIN_EMAIL`, else the earliest-created
 *    project admin, else the earliest user. Nobody becomes `admin` for being a project admin.
 * 5. PostgreSQL and MySQL: `project.organization_id` becomes NOT NULL with its foreign key (CASCADE). SQLite keeps the
 *    column nullable without a REFERENCES clause: a NOT NULL or a REFERENCES there would mean rebuilding `project` with
 *    every foreign key that points at it (the rebuild that lost the translation foreign keys before, #551), and a
 *    REFERENCES column could not be dropped again by `down`. Triggers check the organization instead, and the app's boot
 *    check refuses to start while a project has none.
 * 6. Computes the cached counters `seats_used` and `strings_used`.
 */
export class addOrganizations1795478400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const sql = new Sql(queryRunner);

    // 1. The tables, the column and the indexes
    await createTables(queryRunner, TABLES);
    if (!(await sql.columnExists('project', 'organization_id'))) {
      const type =
        sql.db === DbType.POSTGRES ? 'uuid' : sql.db === DbType.MYSQL ? 'varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : 'varchar(255)';
      await sql.run(`ALTER TABLE ${sql.t('project')} ADD ${sql.db === DbType.MYSQL ? '' : 'COLUMN '}${sql.c('organization_id')} ${type} NULL`);
    }
    for (const index of INDEXES) {
      await sql.createIndex(index);
    }
    if (sql.db === DbType.BETTER_SQLITE3) {
      await this.createSqliteTriggers(sql);
    }

    // 2. The default organization, also on an empty database (a fresh install)
    let defaultId = await sql.value(
      `SELECT ${sql.c('id')} AS ${sql.q('id')} FROM ${sql.t('organization')} WHERE ${sql.c('is_default')} = ${sql.true}`,
    );
    if (!defaultId) {
      defaultId = randomUUID();
      const name = (config.defaultOrganizationName || 'My organization').slice(0, 255);
      const columns = ['id', 'name', 'slug', 'status', 'plan_code', 'is_default', 'admins_see_all_projects'];
      await sql.run(
        `INSERT INTO ${sql.t('organization')} (${columns.map(c => sql.c(c)).join(', ')}) ` +
          `VALUES (?, ?, 'default', 'active', 'enterprise', ${sql.true}, ${sql.false})`,
        [defaultId, name],
      );
    }

    // 3. Every project without an organization
    await sql.run(`UPDATE ${sql.t('project')} SET ${sql.c('organization_id')} = ? WHERE ${sql.c('organization_id')} IS NULL`, [defaultId]);

    // 4. Every user, with the owner first
    await this.addMembers(sql, String(defaultId));

    // 5. NOT NULL and the foreign key (PostgreSQL, MySQL)
    if (sql.db === DbType.POSTGRES) {
      await sql.run(`ALTER TABLE "project" ALTER COLUMN "organization_id" SET NOT NULL`);
      if (!(await sql.value(`SELECT COUNT(*) AS "n" FROM pg_constraint WHERE conname = ?`, [PROJECT_FK]).then(Number))) {
        await sql.run(
          `ALTER TABLE "project" ADD CONSTRAINT "${PROJECT_FK}" FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE`,
        );
      }
    } else if (sql.db === DbType.MYSQL) {
      await sql.run('ALTER TABLE `project` MODIFY `organizationId` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL');
      if (!(await sql.mysqlForeignKeyExists('project', PROJECT_FK))) {
        await sql.run(
          'ALTER TABLE `project` ADD CONSTRAINT `' +
            PROJECT_FK +
            '` FOREIGN KEY (`organizationId`) REFERENCES `organization` (`id`) ON DELETE CASCADE',
        );
      }
    }

    // 6. The cached counters
    await this.recount(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const sql = new Sql(queryRunner);
    if (sql.db === DbType.BETTER_SQLITE3) {
      for (const trigger of SQLITE_TRIGGERS) {
        await sql.run(`DROP TRIGGER IF EXISTS "${trigger}"`);
      }
    }
    if (sql.db === DbType.MYSQL && (await sql.mysqlForeignKeyExists('project', PROJECT_FK))) {
      await sql.run('ALTER TABLE `project` DROP FOREIGN KEY `' + PROJECT_FK + '`');
    }
    for (const index of [...INDEXES].reverse()) {
      await sql.dropIndex(index);
    }
    if (await sql.columnExists('project', 'organization_id')) {
      // PostgreSQL drops the column's foreign key with it
      await sql.run(`ALTER TABLE ${sql.t('project')} DROP COLUMN ${sql.c('organization_id')}`);
    }
    await dropTables(queryRunner, TABLES);
  }

  private async createSqliteTriggers(sql: Sql): Promise<void> {
    const missing = `NEW."organization_id" IS NULL OR NOT EXISTS (SELECT 1 FROM "organization" WHERE "id" = NEW."organization_id")`;
    const abort = `SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: project.organization_id must reference an organization')`;
    await sql.run(
      `CREATE TRIGGER IF NOT EXISTS "fk_project_organization_insert" BEFORE INSERT ON "project" FOR EACH ROW WHEN ${missing} BEGIN ${abort}; END`,
    );
    await sql.run(
      `CREATE TRIGGER IF NOT EXISTS "fk_project_organization_update" BEFORE UPDATE OF "organization_id" ON "project" FOR EACH ROW WHEN ${missing} BEGIN ${abort}; END`,
    );
    await sql.run(
      `CREATE TRIGGER IF NOT EXISTS "fk_project_organization_delete" AFTER DELETE ON "organization" FOR EACH ROW BEGIN DELETE FROM "project" WHERE "organization_id" = OLD."id"; END`,
    );
  }

  private async addMembers(sql: Sql, organizationId: string): Promise<void> {
    const ou = sql.t('organization_user');
    const hasOwner = Number(
      await sql.value(`SELECT COUNT(*) AS ${sql.q('n')} FROM ${ou} WHERE ${sql.c('organization_id')} = ? AND ${sql.c('role')} = 'owner'`, [
        organizationId,
      ]),
    );
    if (!hasOwner) {
      const ownerId = await this.chooseOwner(sql);
      if (ownerId) {
        const existing = await sql.value(
          `SELECT ${sql.c('id')} AS ${sql.q('id')} FROM ${ou} WHERE ${sql.c('organization_id')} = ? AND ${sql.c('user_id')} = ?`,
          [organizationId, ownerId],
        );
        if (existing) {
          await sql.run(`UPDATE ${ou} SET ${sql.c('role')} = 'owner' WHERE ${sql.c('id')} = ?`, [existing]);
        } else {
          await sql.run(
            `INSERT INTO ${ou} (${sql.c('id')}, ${sql.c('organization_id')}, ${sql.c('user_id')}, ${sql.c('role')}) VALUES (?, ?, ?, 'owner')`,
            [randomUUID(), organizationId, ownerId],
          );
        }
      }
    }

    // Everyone else who is not a member yet, in pages: `member` (a project admin stays the admin of their projects only)
    const notMember = `NOT EXISTS (SELECT 1 FROM ${ou} m WHERE m.${sql.c('organization_id')} = ? AND m.${sql.c('user_id')} = u.${sql.c('id')})`;
    for (;;) {
      const rows: Array<{ id: string }> = await sql.rows(
        `SELECT u.${sql.c('id')} AS ${sql.q('id')} FROM ${sql.t('user')} u WHERE ${notMember} ORDER BY u.${sql.c('id')} LIMIT 500`,
        [organizationId],
      );
      if (rows.length === 0) {
        break;
      }
      const values = rows.map(() => `(?, ?, ?, 'member')`).join(', ');
      const params = rows.flatMap(row => [randomUUID(), organizationId, row.id]);
      await sql.run(
        `INSERT INTO ${ou} (${sql.c('id')}, ${sql.c('organization_id')}, ${sql.c('user_id')}, ${sql.c('role')}) VALUES ${values}`,
        params,
      );
    }
  }

  /** The user with `TR_ADMIN_EMAIL`, else the earliest-created project admin, else the earliest user. */
  private async chooseOwner(sql: Sql): Promise<string | null> {
    const user = sql.t('user');
    const adminEmail = config.defaultAdminCredentialConfig.adminEmail;
    if (adminEmail && adminEmail.includes('@')) {
      const admin = await sql.value(`SELECT ${sql.c('id')} AS ${sql.q('id')} FROM ${user} WHERE ${sql.c('email')} = ?`, [normalizeEmail(adminEmail)]);
      if (admin) {
        return String(admin);
      }
    }
    const order = `ORDER BY u.${sql.c('date_created')} ASC, u.${sql.c('id')} ASC LIMIT 1`;
    const projectAdmin = await sql.value(
      `SELECT u.${sql.c('id')} AS ${sql.q('id')} FROM ${user} u WHERE EXISTS (SELECT 1 FROM ${sql.t('project_user')} pu ` +
        `WHERE pu.${sql.c('user_id')} = u.${sql.c('id')} AND pu.${sql.c('role')} = 'admin') ${order}`,
    );
    if (projectAdmin) {
      return String(projectAdmin);
    }
    const earliest = await sql.value(`SELECT u.${sql.c('id')} AS ${sql.q('id')} FROM ${user} u ${order}`);
    return earliest ? String(earliest) : null;
  }

  private async recount(sql: Sql): Promise<void> {
    const org = sql.t('organization');
    const id = `${org}.${sql.c('id')}`;
    const members = `SELECT COUNT(*) FROM ${sql.t('organization_user')} m WHERE m.${sql.c('organization_id')} = ${id}`;
    const invites = `SELECT COUNT(*) FROM ${sql.t('organization_invite')} i WHERE i.${sql.c('organization_id')} = ${id} AND i.${sql.c('status')} = 'sent'`;
    const strings =
      `SELECT COALESCE(SUM(p.${sql.c('locales_count')} * p.${sql.c('terms_count')}), 0) FROM ${sql.t('project')} p ` +
      `WHERE p.${sql.c('organization_id')} = ${id}`;
    await sql.run(`UPDATE ${org} SET ${sql.c('seats_used')} = (${members}) + (${invites}), ${sql.c('strings_used')} = (${strings})`);
  }
}

/** Small helpers over the query runner: names and placeholders as the configured engine writes them. */
class Sql {
  readonly db = config.db.default.type as DbType;
  readonly true = this.db === DbType.POSTGRES ? 'TRUE' : '1';
  readonly false = this.db === DbType.POSTGRES ? 'FALSE' : '0';

  constructor(private readonly queryRunner: QueryRunner) {
    if (this.db !== DbType.POSTGRES && this.db !== DbType.MYSQL && this.db !== DbType.BETTER_SQLITE3) {
      throw new Error(`Unknown DB type: ${this.db}`);
    }
  }

  /** A quoted name as given. */
  q(name: string): string {
    return quoteName(this.db, name);
  }

  /** A table name. */
  t(name: string): string {
    return this.q(name);
  }

  /** A snake_case column name, as the engine names it (camelCase on MySQL). */
  c(name: string): string {
    return this.q(engineColumnName(this.db, name));
  }

  /** Runs `query`, written with `?` placeholders (numbered for PostgreSQL). */
  run(query: string, params: unknown[] = []): Promise<any> {
    let index = 0;
    const text = this.db === DbType.POSTGRES ? query.replace(/\?/g, () => `$${++index}`) : query;
    return this.queryRunner.query(text, params);
  }

  async rows(query: string, params: unknown[] = []): Promise<any[]> {
    const result = await this.run(query, params);
    return Array.isArray(result) ? result : [];
  }

  /** The first column of the first row, or null. */
  async value(query: string, params: unknown[] = []): Promise<any> {
    const [row] = await this.rows(query, params);
    return row ? (Object.values(row)[0] ?? null) : null;
  }

  async columnExists(table: string, column: string): Promise<boolean> {
    switch (this.db) {
      case DbType.POSTGRES:
        return (
          Number(
            await this.value(
              `SELECT COUNT(*) AS "n" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
              [table, column],
            ),
          ) > 0
        );
      case DbType.MYSQL:
        return (
          Number(
            await this.value(
              'SELECT COUNT(*) AS `n` FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
              [table, engineColumnName(this.db, column)],
            ),
          ) > 0
        );
      default: {
        const columns: Array<{ name: string }> = await this.rows(`PRAGMA table_info("${table}")`);
        return columns.some(info => info.name === column);
      }
    }
  }

  async createIndex(index: IndexSpec): Promise<void> {
    const on = `${this.t(index.table)} (${this.c(index.column)})`;
    if (this.db !== DbType.MYSQL) {
      await this.run(`CREATE INDEX IF NOT EXISTS ${this.q(index.name)} ON ${on}`);
    } else if (!index.skipOnMysql && !(await this.mysqlIndexExists(index.table, index.name))) {
      await this.run(`CREATE INDEX ${this.q(index.name)} ON ${on}`);
    }
  }

  async dropIndex(index: IndexSpec): Promise<void> {
    if (this.db !== DbType.MYSQL) {
      await this.run(`DROP INDEX IF EXISTS ${this.q(index.name)}`);
    } else if (await this.mysqlIndexExists(index.table, index.name)) {
      await this.run(`DROP INDEX ${this.q(index.name)} ON ${this.t(index.table)}`);
    }
  }

  private async mysqlIndexExists(table: string, indexName: string): Promise<boolean> {
    const n = await this.value(
      'SELECT COUNT(*) AS `n` FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      [table, indexName],
    );
    return Number(n) > 0;
  }

  async mysqlForeignKeyExists(table: string, name: string): Promise<boolean> {
    const n = await this.value(
      'SELECT COUNT(*) AS `n` FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? ' +
        `AND constraint_type = 'FOREIGN KEY'`,
      [table, name],
    );
    return Number(n) > 0;
  }
}
