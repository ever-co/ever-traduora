/**
 * The mutation check of DESIGN §10: runs the isolation suite with the organization scope mapped to a no-op double
 * (test/organization-isolation.mutation.json) and prints the share of its tests that fail. With the scope gone, the suite
 * must fail broadly; below TARGET the check fails. Run it with `yarn test:isolation:mutation`.
 */
const { spawnSync } = require('child_process');
const { mkdtempSync, readFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const TARGET = 0.6;
const out = mkdtempSync(join(tmpdir(), 'isolation-mutation-'));
const report = join(out, 'report.json');
const jest = require.resolve('jest/bin/jest');
const run = spawnSync(
  process.execPath,
  [
    jest,
    '--config',
    join(__dirname, '..', 'organization-isolation.mutation.json'),
    '--runInBand',
    '--forceExit',
    '--silent',
    '--json',
    '--outputFile',
    report,
  ],
  { cwd: join(__dirname, '..', '..'), stdio: ['ignore', 'ignore', 'inherit'] },
);
let result;
try {
  result = JSON.parse(readFileSync(report, 'utf8'));
} catch (error) {
  console.error(`The isolation suite did not report (exit ${run.status}).`);
  process.exit(2);
} finally {
  rmSync(out, { recursive: true, force: true });
}
const total = result.numTotalTests;
const failed = result.numFailedTests;
const share = total ? failed / total : 0;
const percent = (share * 100).toFixed(1);
console.log(
  `Isolation suite with the organization scope removed: ${failed} of ${total} tests fail (${percent} %, target at least ${TARGET * 100} %).`,
);
if (result.numRuntimeErrorTestSuites > 0) {
  console.error('The suite could not run under the double: the check measures nothing.');
  process.exit(2);
}
process.exit(share >= TARGET ? 0 : 1);
