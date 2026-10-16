export function assertSupportedNodeVersion(version = process.versions.node) {
  const normalized = String(version ?? '').trim();
  const match = /^v?(\d+)/iu.exec(normalized);
  const major = match ? Number(match[1]) : Number.NaN;
  if (Number.isInteger(major) && major >= 22) return;

  const shown = normalized || 'unknown';
  const error = new Error(`Node.js 22 or newer is required. This process is running Node.js ${shown}.`);
  error.code = 'UNSUPPORTED_NODE_VERSION';
  throw error;
}
