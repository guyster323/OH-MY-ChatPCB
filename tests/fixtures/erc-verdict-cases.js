// One ERC record table for the shared verdict, the daemon socket, and the panel.
// `passed` is the only state that may enable Apply. `skipped` may apply only
// with ercOverride "skipped". Everything else stays blocked.

export const ercVerdictCases = [
  {
    id: 'ok-only',
    erc: { ok: true },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'errorcount-string',
    erc: { ok: true, errorCount: '0' },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'count-mismatch',
    erc: { ok: true, erc: { errorCount: 0 }, errorCount: 5 },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 5
  },
  {
    id: 'nested-violations',
    erc: { ok: true, erc: { errorCount: 0, violations: [{ message: 'pin' }] } },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'null',
    erc: null,
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'empty',
    erc: {},
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'errorcount-abc',
    erc: { ok: true, errorCount: 'abc' },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'errorcount-nan',
    erc: { ok: true, errorCount: Number.NaN },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'errorcount-negative',
    erc: { ok: true, errorCount: -1 },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'ec0',
    erc: { ok: true, errorCount: 0 },
    passed: true,
    skipped: false,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'ec0-empty-violations',
    erc: { ok: true, errorCount: 0, violations: [] },
    passed: true,
    skipped: false,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'ec0-violations',
    erc: { ok: true, errorCount: 0, violations: [{ message: 'clearance' }] },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'ec0-violations-string',
    erc: { ok: true, errorCount: 0, violations: 'bad' },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'ec0-violations-null',
    erc: { ok: true, errorCount: 0, violations: null },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'ec2',
    erc: { ok: true, errorCount: 2 },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 2
  },
  {
    id: 'ok-false',
    erc: { ok: false, errorCount: 0 },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'skipped',
    erc: { ok: true, skipped: true, executed: false },
    passed: false,
    skipped: true,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'skipped-ec0',
    erc: { ok: true, skipped: true, errorCount: 0 },
    passed: false,
    skipped: true,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'skipped-ec3',
    erc: { ok: true, skipped: true, errorCount: 3 },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 3
  },
  {
    id: 'skipped-violations',
    erc: { ok: true, skipped: true, violations: [{ message: 'pin' }] },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'nested-ec0',
    erc: { ok: true, skipped: false, erc: { errorCount: 0, warningCount: 0 } },
    passed: true,
    skipped: false,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'nested-ec1',
    erc: { ok: true, erc: { errorCount: 1 } },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 1
  },
  {
    id: 'nested-empty',
    erc: { ok: true, erc: {} },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'empty-violations-no-count',
    erc: { ok: true, violations: [] },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'equal-counts',
    erc: { ok: true, errorCount: 0, erc: { errorCount: 0 } },
    passed: true,
    skipped: false,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'string-vs-number',
    erc: { ok: true, errorCount: '0', erc: { errorCount: 0 } },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'top-violations-nested-clean',
    erc: { ok: true, violations: [{ message: 'top' }], erc: { errorCount: 0 } },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'nested-empty-violations',
    erc: { ok: true, erc: { errorCount: 0, violations: [] } },
    passed: true,
    skipped: false,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'passed-flag-only',
    erc: { passed: true },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'executed-false-ec0',
    erc: { ok: true, executed: false, errorCount: 0 },
    passed: false,
    skipped: false,
    failed: false,
    missing: true,
    errorCount: 0
  },
  {
    id: 'status-passed-violations',
    erc: { ok: true, status: 'passed', errorCount: 0, violations: [{ message: 'x' }] },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  },
  {
    id: 'drc-violations-ignored',
    erc: { ok: true, errorCount: 0, drc: { violations: [{ message: 'clearance' }] } },
    passed: true,
    skipped: false,
    failed: false,
    missing: false,
    errorCount: 0
  },
  {
    id: 'deep-count-mismatch',
    erc: { ok: true, errorCount: 0, erc: { errorCount: 0, erc: { errorCount: 4 } } },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 4
  },
  {
    id: 'status-failed-ec0',
    erc: { ok: true, status: 'failed', errorCount: 0 },
    passed: false,
    skipped: false,
    failed: true,
    missing: false,
    errorCount: 0
  }
];
