import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * DESIGN §3.4, layer 3: nothing outside `services/organization/` reaches the projects or the organizations through
 * their repository; controllers go through `OrganizationScopedProjects` and `AuthorizationService`. A few system paths
 * are allowed, each for a reason; an allowance that is no longer needed fails too, so the list stays honest.
 */
const SRC = join(__dirname, '..', '..');
const SCOPE_DIR = 'services/organization/';

const ALLOWED: Record<string, string> = {
  // Installation-wide counts for the anonymous usage statistics: a count of all projects, never one organization's data
  'ever-stats/ever-stats-collector.service.ts': 'installation counts',
};

const PATTERNS = [
  /InjectRepository\(\s*(Project|Organization)\s*\)/,
  /Repository<\s*(Project|Organization)\s*>/,
  /getRepository\(\s*(Project|Organization)\s*\)/,
];

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
const reaching = files.filter(file => PATTERNS.some(pattern => pattern.test(file.text))).map(file => file.rel);
const systemPath = (rel: string) => rel.startsWith(SCOPE_DIR) || rel.startsWith('migrations/') || rel.startsWith('seeds/');

describe('the project and organization repositories', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(reaching).toContain(`${SCOPE_DIR}organization-scoped-projects.service.ts`);
  });

  it('are injected or read only in services/organization/, the migrations, the seeds and the allowed system paths', () => {
    expect(reaching.filter(rel => !systemPath(rel) && !ALLOWED[rel])).toEqual([]);
  });

  it('allows only what still needs it', () => {
    expect(Object.keys(ALLOWED).filter(rel => !reaching.includes(rel))).toEqual([]);
  });

  it('are never injected by a controller', () => {
    expect(reaching.filter(rel => rel.startsWith('controllers/') || rel.includes('.controller.'))).toEqual([]);
  });
});
