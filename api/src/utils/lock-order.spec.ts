import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * The global lock order (see `lockOrganization`): account → project(s) → organization(s). This scan reads each source
 * file and fails on a lock taken against it after another lock in the same transaction:
 * - a project or an account after an organization;
 * - an account after a project.
 * A lock lasts until its transaction ends, so the window after a lock runs to the end of the transaction callback that
 * holds it (`transaction(…)`, `readCommittedTransaction(…)`, `inTransaction(…)`), or of the enclosing function when the
 * scan finds no such callback. It does not follow calls into other functions: a helper that takes one of these locks
 * belongs in the lists below. Nor does it see the implicit lock of a foreign key; the code takes those rows' locks
 * first, explicitly (`lockAccounts`, `lockAccountForShare`, `lockProjectForShare`).
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
const PROJECT_LOCKS = ['lockProject', 'lockProjects', 'lockProjectForShare', 'lockProjectsForShare', 'lockProjectsOf'];
const ACCOUNT_LOCKS = ['lockAccount', 'lockAccounts', 'lockAccountForShare'];

/** What may not follow a lock of each kind */
const NOT_AFTER: Array<{ locks: string[]; forbidden: string[] }> = [
  { locks: ORGANIZATION_LOCKS, forbidden: [...PROJECT_LOCKS, ...ACCOUNT_LOCKS] },
  { locks: PROJECT_LOCKS, forbidden: ACCOUNT_LOCKS },
];

/** A transaction callback: the body of an arrow function passed to a call that opens (or joins) a transaction */
const TRANSACTION_CALLBACK = /(?:transaction|Transaction)\s*\([^;{}]*=>\s*$/;
const CLASS_BODY = /\bclass\s+\w+[^{};]*$/;

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

interface Block {
  start: number;
  end: number;
}

function blocksOf(code: string): Block[] {
  const blocks: Block[] = [];
  const open: number[] = [];
  for (let at = 0; at < code.length; at++) {
    if (code[at] === '{') {
      open.push(at);
    } else if (code[at] === '}' && open.length) {
      blocks.push({ start: open.pop(), end: at });
    }
  }
  return blocks;
}

/** Where the locks taken at `index` are released: the end of the transaction callback, else of the enclosing function */
function windowEnd(code: string, blocks: Block[], index: number): number {
  const around = blocks.filter(block => block.start < index && index < block.end).sort((a, b) => b.start - a.start);
  const callback = around.find(block => TRANSACTION_CALLBACK.test(code.slice(Math.max(0, block.start - 300), block.start)));
  if (callback) {
    return callback.end;
  }
  // The function: the outermost block that is not a class body
  const functions = around.filter(block => !CLASS_BODY.test(code.slice(Math.max(0, block.start - 300), block.start)));
  return functions.length ? functions[functions.length - 1].end : code.length;
}

/** The locks taken against the global order, as `first → then`. */
export function lockOrderViolations(source: string): string[] {
  const code = withoutComments(source);
  const blocks = blocksOf(code);
  const violations: string[] = [];
  for (const { locks, forbidden } of NOT_AFTER) {
    const calls = new RegExp(`(function\\s+|async\\s+|\\.)?\\b(${locks.join('|')})\\(`, 'g');
    const later = new RegExp(`\\b(${forbidden.join('|')})\\(`);
    for (const match of code.matchAll(calls)) {
      // A definition (`function lockOrganization(`, a method `async assertStillOpen(`) is no call of the lock
      if (match[1] && match[1] !== '.') {
        continue;
      }
      const from = match.index + match[0].length;
      const found = later.exec(code.slice(from, windowEnd(code, blocks, match.index)));
      if (found) {
        violations.push(`${match[2]} → ${found[1]}`);
      }
    }
  }
  return violations;
}

describe('the lock order: account → projects → organization', () => {
  const files = sourceFiles(SRC).map(path => ({ rel: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));

  it('finds a lock taken against the order, until the end of the transaction', () => {
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
    // The organization lock taken inside a loop still holds after the loop, to the end of the transaction
    expect(
      lockOrderViolations(`async accept(invites) {
        return readCommittedTransaction(this.manager, async tx => {
          for (const invite of invites) {
            await lockOrganization(tx, invite.organizationId);
          }
          await lockProjectsForShare(tx, ids);
        });
      }`),
    ).toEqual(['lockOrganization → lockProjectsForShare']);
    expect(
      lockOrderViolations(`async function importing(tx) {
        await lockProject(tx, projectId);
        await lockAccountForShare(tx, userId);
      }`),
    ).toEqual(['lockProject → lockAccountForShare']);
  });

  it('passes the right order, and stops at the end of the transaction or the function', () => {
    expect(
      lockOrderViolations(`async function add(tx) {
        await lockAccounts(tx, [userId]);
        await lockProject(tx, projectId);
        // lockProject() named in a comment after the organization does not count
        const organization = await lockOrganizationForStrings(tx, project);
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
        async twoTransactions() {
          await readCommittedTransaction(this.manager, async tx => {
            await lockOrganization(tx, id);
          });
          await readCommittedTransaction(this.manager, async tx => {
            await lockProject(tx, projectId);
          });
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
