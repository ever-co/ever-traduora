import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * The global lock order (see `lockOrganization`): account → project(s) → organization(s). A transaction never locks a
 * project once it holds an organization. This scan reads each source file and fails on a project lock that comes after
 * an organization lock in the same block: after the call that takes the organization lock (or a function that does),
 * up to the end of the block that holds it. It does not follow calls into other functions, so a helper that locks an
 * organization belongs in ORGANIZATION_LOCKS.
 */
const SRC = join(__dirname, '..');

const ORGANIZATION_LOCKS = [
  'lockOrganization',
  'lockOrganizationForStrings',
  'ensureMember',
  'joinDefaultOrganization',
  'createOrganizationWithOwner',
  'deleteAccountsWithOrganizations',
  'assertStillOpen',
];
const PROJECT_LOCKS = /\b(lockProject|lockProjects|lockProjectForShare|lockProjectsForShare|lockProjectsOf)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** The code without its comments, which may name locks in any order. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The text from `index` to the end of the block that holds it. */
function restOfBlock(code: string, index: number): string {
  let depth = 0;
  for (let at = index; at < code.length; at++) {
    if (code[at] === '{') {
      depth++;
    } else if (code[at] === '}' && --depth < 0) {
      return code.slice(index, at);
    }
  }
  return code.slice(index);
}

/** The project locks taken after an organization lock, as `organization lock → project lock`. */
export function lockOrderViolations(source: string): string[] {
  const code = withoutComments(source);
  const calls = new RegExp(`(function\\s+|async\\s+|\\.)?\\b(${ORGANIZATION_LOCKS.join('|')})\\(`, 'g');
  const violations: string[] = [];
  for (const match of code.matchAll(calls)) {
    // A definition (`function lockOrganization(`, a method `async assertStillOpen(`) is no call of the lock
    if (match[1] && match[1] !== '.') {
      continue;
    }
    const after = restOfBlock(code, match.index + match[0].length);
    const projectLock = PROJECT_LOCKS.exec(after);
    if (projectLock) {
      violations.push(`${match[2]} → ${projectLock[1]}`);
    }
  }
  return violations;
}

describe('the lock order: account → projects → organization', () => {
  const files = sourceFiles(SRC).map(path => ({ rel: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));

  it('finds a project locked after an organization, and passes the right order', () => {
    expect(
      lockOrderViolations(`async function add(tx) {
        await lockOrganization(tx, organizationId);
        await lockProject(tx, projectId); // wrong
      }`),
    ).toEqual(['lockOrganization → lockProject']);
    expect(
      lockOrderViolations(`async function remove(tx) {
        await deleteAccountsWithOrganizations(tx, ids, async inner => {
          await lockProjects(inner, projectIds);
        });
      }`),
    ).toEqual(['deleteAccountsWithOrganizations → lockProjects']);
    expect(
      lockOrderViolations(`async function add(tx) {
        await lockProject(tx, projectId);
        // lockProject() named in a comment after the organization does not count
        const organization = await lockOrganizationForStrings(tx, organizationId);
      }
      async function other(tx) {
        await lockProjectForShare(tx, projectId);
      }
      class Service {
        private async assertStillOpen(tx) {
          return lockOrganization(tx, id);
        }
        async later(tx) {
          await lockProject(tx, projectId);
        }
      }`),
    ).toEqual([]);
  });

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter(file => /\blockOrganization\(/.test(file.text)).length).toBeGreaterThan(3);
  });

  it('holds in every source file', () => {
    expect(files.flatMap(file => lockOrderViolations(file.text).map(violation => `${file.rel}: ${violation}`))).toEqual([]);
  });
});
