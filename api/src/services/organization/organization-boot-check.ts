import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { Project } from '../../entity/project.entity';

/**
 * The number of projects without an organization, or null while the schema has no organizations yet (a fresh database
 * before its migrations run).
 */
export async function countProjectsWithoutOrganization(dataSource: DataSource): Promise<number | null> {
  try {
    return await dataSource.getRepository(Project).count({ where: { organizationId: IsNull() } });
  } catch {
    return null;
  }
}

/**
 * Refuses to start while a project has no organization. PostgreSQL and MySQL enforce it with NOT NULL; SQLite keeps the
 * column nullable (see the migration `1795478400000-add-organizations`), so this is where a gap would show. A project
 * outside every organization would be reachable by nobody, or by the wrong people once code assumes the column is set.
 */
@Injectable()
export class OrganizationBootCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrganizationBootCheck.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const missing = await countProjectsWithoutOrganization(this.dataSource);
    if (missing === null) {
      this.logger.warn('organizations: the schema has no organizations yet, run the migrations');
      return;
    }
    if (missing > 0) {
      throw new Error(
        `${missing} project(s) have no organization. Run the database migrations (TR_DB_AUTOMIGRATE), which put every ` +
          'project into the default organization, then start again.',
      );
    }
  }
}
