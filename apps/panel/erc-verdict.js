// Single ERC verdict for the panel and the daemon. Passed only when a numeric
// errorCount is 0, the same count is not contradicted, and violations are absent
// or empty. Counts and violations are read on this object and on nested erc only.

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function ercLayers(source) {
  const layers = [source];
  const nested = isRecord(source.erc) ? source.erc : null;
  if (nested) layers.push(nested);
  const deep = isRecord(nested?.erc) ? nested.erc : null;
  if (deep) layers.push(deep);
  return layers;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function violationsBad(layer) {
  if (!Object.hasOwn(layer, 'violations')) return false;
  const list = layer.violations;
  return !Array.isArray(list) || list.length > 0;
}

function reportedErrorCount(numbers) {
  const positive = numbers.filter((value) => value > 0);
  if (positive.length === 0) return 0;
  return Math.max(...positive);
}

function missingVerdict() {
  return { passed: false, skipped: false, failed: false, missing: true, errorCount: 0 };
}

export function classifyRecordedErc(source) {
  if (!isRecord(source)) return missingVerdict();

  const layers = ercLayers(source);
  const presentCounts = [];
  for (const layer of layers) {
    if (Object.hasOwn(layer, 'errorCount')) presentCounts.push(layer.errorCount);
  }
  const countsDisagree = presentCounts.length >= 2
    && presentCounts.some((value) => value !== presentCounts[0]);
  const numericCounts = presentCounts.map(finiteNumber).filter((value) => value !== undefined);
  const errorCount = reportedErrorCount(numericCounts);
  const skippedFlag = layers.some((layer) => layer.skipped === true);
  const didNotRun = layers.some((layer) => layer.executed === false);
  const okFalse = layers.some((layer) => layer.ok === false);
  const okTrue = layers.some((layer) => layer.ok === true);
  const statusFailed = layers.some((layer) => layer.status === 'failed');
  const positiveCount = numericCounts.some((value) => value > 0);
  const badViolations = layers.some(violationsBad);

  if (countsDisagree || badViolations || statusFailed || okFalse || positiveCount) {
    return { passed: false, skipped: false, failed: true, missing: false, errorCount };
  }
  if (skippedFlag) {
    return { passed: false, skipped: true, failed: false, missing: false, errorCount: 0 };
  }
  // executed:false without skipped is missing evidence, not an overridable skip.
  if (didNotRun) return missingVerdict();
  const numericZero = numericCounts.length > 0 && numericCounts.every((value) => value === 0);
  if (okTrue && numericZero) {
    return { passed: true, skipped: false, failed: false, missing: false, errorCount: 0 };
  }
  return missingVerdict();
}

globalThis.chatpcbErcVerdict = classifyRecordedErc;
