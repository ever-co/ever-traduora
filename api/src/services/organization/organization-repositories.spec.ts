import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * DESIGN §3.4, layer 3: nothing outside `services/organization/` reaches the projects or the organizations directly;
 * controllers go through `OrganizationScopedProjects` and `AuthorizationService`. Two ways in are watched:
 * - the repository (`@InjectRepository`, `Repository<…>`, `getRepository(…)`);
 * - an entity manager or repository call naming the entity (`findOne(Project, …)`, `increment(Project, …)`, …).
 * A few system paths are allowed, each for a reason. An allowance that is no longer needed fails too, so the lists stay
 * honest, and a new direct use has to be added here on purpose.
 */
const SRC = join(__dirname, '..', '..');

/** The repository itself: only the statistics count the whole installation. */
const REPOSITORY_ALLOWED: Record<string, string> = {
  'ever-stats/ever-stats-collector.service.ts': 'installation-wide counts for the anonymous statistics, never one organization',
};

/** Calls naming the entity. */
const CALLS_ALLOWED: Record<string, string> = {
  'controllers/import.controller.ts': 'the counters and plan of the project the route authorized, by its id, in the import transaction',
  'controllers/term.controller.ts': 'the terms counter of the project the route authorized, by its id',
  'controllers/translation.controller.ts': 'the locales counter of the project the route authorized, by its id',
  'utils/database-locks.ts': 'the row lock of a project the caller already resolved',
  'ever-connect/ever-connect-provision.service.ts':
    'provisioning creates the project in the home organization it resolved, after checking that organization is active',
};

const REPOSITORY = [
  /InjectRepository\(\s*(Project|Organization)\s*\)/,
  /Repository<\s*(Project|Organization)\s*>/,
  /getRepository\(\s*(Project|Organization)\s*\)/,
];
const CALLS =
  /\.(findOne|find|findBy|findOneBy|findOneOrFail|findOneByOrFail|findAndCount|count|countBy|exists|existsBy|create|save|insert|update|upsert|delete|remove|softDelete|increment|decrement|createQueryBuilder)\(\s*(Project|Organization)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map(path => ({ rel: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const systemPath = (rel: string) => rel.startsWith('services/organization/') || rel.startsWith('migrations/') || rel.startsWith('seeds/');
const injecting = files.filter(file => REPOSITORY.some(pattern => pattern.test(file.text))).map(file => file.rel);
const calling = files.filter(file => CALLS.test(file.text)).map(file => file.rel);

describe('the project and organization repositories', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(injecting).toContain('services/organization/organization-scoped-projects.service.ts');
    expect(calling).toContain('services/organization/organization-scope.ts');
  });

  it('are injected only in services/organization/, the migrations, the seeds and the allowed system paths', () => {
    expect(injecting.filter(rel => !systemPath(rel) && !REPOSITORY_ALLOWED[rel])).toEqual([]);
  });

  it('are never injected by a controller', () => {
    expect(injecting.filter(rel => rel.startsWith('controllers/') || rel.includes('.controller.'))).toEqual([]);
  });

  it('are named in entity manager calls only there and in the reviewed paths', () => {
    expect(calling.filter(rel => !systemPath(rel) && !CALLS_ALLOWED[rel])).toEqual([]);
  });

  it('allows only what still needs it', () => {
    expect(Object.keys(REPOSITORY_ALLOWED).filter(rel => !injecting.includes(rel))).toEqual([]);
    expect(Object.keys(CALLS_ALLOWED).filter(rel => !calling.includes(rel))).toEqual([]);
  });
});
