/**
 * The mutation check of DESIGN §10. Two runs of the isolation suite (test/organization-isolation.e2e-spec.ts):
 * 1. as it is: every test must pass, or the check stops (a failure there is a broken suite, not a measure);
 * 2. with the organization scope mapped to a no-op double (test/organization-isolation.mutation.json): it prints the
 *    share of the tests that fail, and fails below TARGET.
 * Each run must also report that its fixtures were made (the suite writes ISOLATION_SETUP_MARKER at the end of its
 * setup): a setup that fails marks every test failed in Jest, which would otherwise read as a perfect score.
 * Run it with `yarn test:isolation:mutation`.
 */
const { spawnSync } = require('child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const TARGET = 0.6;
const API = join(__dirname, '..', '..');
const jest = require.resolve('jest/bin/jest');
const work = mkdtempSync(join(tmpdir(), 'isolation-mutation-'));

/** Runs the isolation suite with this jest config; answers its JSON report and whether its setup completed. */
function runSuite(name, configArgs) {
  const report = join(work, `${name}.json`);
  const marker = join(work, `${name}.ready`);
  const run = spawnSync(process.execPath, [jest, ...configArgs, '--runInBand', '--forceExit', '--silent', '--json', '--outputFile', report], {
    cwd: API,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ISOLATION_SETUP_MARKER: marker },
  });
  if (!existsSync(report)) {
    throw new Error(`the ${name} run did not report (exit ${run.status})`);
  }
  return { result: JSON.parse(readFileSync(report, 'utf8')), setUp: existsSync(marker) };
}

function stop(message) {
  console.error(message);
  rmSync(work, { recursive: true, force: true });
  process.exit(2);
}

try {
  const normal = runSuite('normal', ['--config', join('test', 'jest-e2e.json'), '--testPathPattern', 'organization-isolation\\.e2e-spec\\.ts$']);
  if (!normal.setUp || normal.result.numTotalTests === 0 || normal.result.numFailedTests > 0 || normal.result.numRuntimeErrorTestSuites > 0) {
    stop(
      `The isolation suite must pass as it is before it measures anything: ${normal.result.numFailedTests} of ` +
        `${normal.result.numTotalTests} tests fail${normal.setUp ? '' : ', and its setup did not complete'}.`,
    );
  }

  const mutated = runSuite('mutated', ['--config', join('test', 'organization-isolation.mutation.json')]);
  if (!mutated.setUp || mutated.result.numRuntimeErrorTestSuites > 0) {
    stop('The isolation suite could not set up against the double: the check measures nothing.');
  }
  const { numFailedTests: failed, numTotalTests: total } = mutated.result;
  const share = total ? failed / total : 0;
  console.log(
    `Isolation suite: all ${normal.result.numTotalTests} tests pass as it is; with the organization scope removed ` +
      `${failed} of ${total} fail (${(share * 100).toFixed(1)} %, target at least ${TARGET * 100} %).`,
  );
  rmSync(work, { recursive: true, force: true });
  process.exit(share >= TARGET ? 0 : 1);
} catch (error) {
  stop(`The mutation check could not run: ${error.message}`);
}
