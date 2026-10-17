import assert from 'node:assert/strict';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  clearOidcDiscoveryCache,
  createChatGPTAuthManager,
  deleteCredentials,
  getOrCreateHostId,
  loadCredentials,
  migrateLegacyChatGPTConfig,
  refreshAccessToken,
  useFallbackAuthEndpoints
} from '../src/runtime/auth/chatgpt-auth.js';

const HOST_ID = 'urn:uuid:12345678-1234-4234-8234-123456789abc';
const TOKEN = 'ACCESS-TOKEN-SHOULD-NOT-LOG';
const MIGRATION_MARKER = '.migrated-from-legacy';
const ENV_KEYS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA'];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotEnv() {
  return new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function captureErrors() {
  const lines = [];
  const original = console.error;
  console.error = (...args) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  return {
    lines,
    restore() {
      console.error = original;
    }
  };
}

async function modeOf(filePath) {
  return (await stat(filePath)).mode & 0o777;
}

function assertMode(actual, expected) {
  if (process.platform === 'win32') return;
  assert.equal(actual, expected);
}

async function withTemp(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'chatpcb-migrate-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeOwned(filePath, body, mode = 0o644) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body, { mode });
  if (process.platform !== 'win32') await chmod(filePath, mode);
}

function skipUnlessXdgMigration(t) {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    t.skip('XDG_CONFIG_HOME applies only off macOS and Windows');
    return true;
  }
  return false;
}

function useDistinctConfig(home, xdg) {
  const saved = snapshotEnv();
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XDG_CONFIG_HOME = xdg;
  delete process.env.APPDATA;
  delete process.env.LOCALAPPDATA;
  return saved;
}

describe('legacy ChatGPT config migration', { concurrency: 1 }, () => {
  test('copies missing credential and host-id files from an injected home', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const sentinel = path.join(root, 'sentinel');
      const issued = JSON.stringify({ client_id: 'oaiapp_TEST', access_token: TOKEN });
      const plain = JSON.stringify({ client_id: 'plain', access_token: 'PLAIN' });
      await writeOwned(path.join(legacy, 'chatgpt-host-id.txt'), HOST_ID);
      await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_TEST.json'), issued);
      await writeOwned(path.join(legacy, 'chatgpt-credentials.json'), plain);
      await writeOwned(path.join(legacy, 'chatgpt.json'), '{"model":"gpt-y"}');
      await writeOwned(path.join(legacy, 'notes.txt'), 'leave me');
      await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_TEST.json.1.ab.tmp'), 'partial');
      const saved = snapshotEnv();
      const logs = captureErrors();
      try {
        process.env.HOME = sentinel;
        process.env.USERPROFILE = sentinel;
        process.env.XDG_CONFIG_HOME = path.join(sentinel, 'xdg');
        const copied = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg }
        });
        assert.deepEqual(copied, [
          'chatgpt-credentials-oaiapp_TEST.json',
          'chatgpt-credentials.json',
          'chatgpt-host-id.txt'
        ]);
        assert.equal(await readFile(path.join(dest, 'chatgpt-host-id.txt'), 'utf8'), HOST_ID);
        assert.equal(await readFile(path.join(dest, 'chatgpt-credentials-oaiapp_TEST.json'), 'utf8'), issued);
        assert.equal(await readFile(path.join(dest, 'chatgpt-credentials.json'), 'utf8'), plain);
        assert.equal(existsSync(path.join(dest, 'chatgpt.json')), false);
        assert.equal(existsSync(path.join(dest, 'notes.txt')), false);
        assert.equal(existsSync(path.join(dest, 'chatgpt-credentials-oaiapp_TEST.json.1.ab.tmp')), false);
        assert.equal(await readFile(path.join(legacy, 'chatgpt-host-id.txt'), 'utf8'), HOST_ID);
        assert.equal(existsSync(path.join(sentinel, '.config')), false);
        assert.equal(existsSync(path.join(sentinel, 'xdg')), false);
        const names = await readdir(dest);
        assert.equal(names.some((name) => name.endsWith('.tmp')), false);
        assertMode(await modeOf(path.join(dest, 'chatgpt-host-id.txt')), 0o600);
        assertMode(await modeOf(path.join(dest, 'chatgpt-credentials-oaiapp_TEST.json')), 0o600);
        assertMode(await modeOf(path.join(dest, 'chatgpt-credentials.json')), 0o600);
        assertMode(await modeOf(dest), 0o700);
        assertMode(await modeOf(path.join(legacy, 'chatgpt-host-id.txt')), 0o644);
        assert.equal(logs.lines.filter((line) => line.includes('Copied ChatGPT config')).length, 1);
        assert.equal(logs.lines.some((line) => line.includes(TOKEN)), false);
        const hostBefore = await stat(path.join(dest, 'chatgpt-host-id.txt'));
        await delay(20);
        const again = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg }
        });
        assert.deepEqual(again, []);
        const hostAfter = await stat(path.join(dest, 'chatgpt-host-id.txt'));
        assert.equal(hostAfter.mtimeMs, hostBefore.mtimeMs);
        assert.equal(logs.lines.filter((line) => line.includes('Copied ChatGPT config')).length, 1);
      } finally {
        logs.restore();
        restoreEnv(saved);
      }
    });
  });

  test('does not overwrite credential or host-id files that already exist', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const kept = '{"keep":true}\n';
      await writeOwned(path.join(legacy, 'chatgpt-credentials.json'), '{"keep":false}\n');
      await writeOwned(path.join(legacy, 'chatgpt-host-id.txt'), HOST_ID);
      await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_NEW.json'), '{"client_id":"oaiapp_NEW","access_token":"NEW"}');
      await mkdir(dest, { recursive: true, mode: 0o755 });
      await writeOwned(path.join(dest, 'chatgpt-credentials.json'), kept);
      if (process.platform !== 'win32') await chmod(dest, 0o755);
      const before = await stat(path.join(dest, 'chatgpt-credentials.json'));
      await delay(20);
      const logs = captureErrors();
      let copied;
      try {
        copied = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg }
        });
        assert.equal(logs.lines.filter((line) => line.includes('Copied ChatGPT config')).length, 1);
        assert.equal(logs.lines.some((line) => line.includes('keep":false')), false);
      } finally {
        logs.restore();
      }
      assert.deepEqual(copied, ['chatgpt-credentials-oaiapp_NEW.json', 'chatgpt-host-id.txt']);
      assert.equal(await readFile(path.join(dest, 'chatgpt-credentials.json'), 'utf8'), kept);
      const after = await stat(path.join(dest, 'chatgpt-credentials.json'));
      assert.equal(after.mtimeMs, before.mtimeMs);
      assertMode(after.mode & 0o777, 0o644);
      assert.equal(await readFile(path.join(dest, 'chatgpt-host-id.txt'), 'utf8'), HOST_ID);
      assertMode(await modeOf(path.join(dest, 'chatgpt-host-id.txt')), 0o600);
      assertMode(await modeOf(dest), 0o700);
      assert.equal((await readdir(dest)).some((name) => name.endsWith('.tmp')), false);
    });
  });

  test('does nothing for the same directory, a relative XDG path, or macOS and Windows', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const configRoot = path.join(home, '.config');
      await writeOwned(path.join(legacy, 'chatgpt-host-id.txt'), HOST_ID);
      const logs = captureErrors();
      const saved = snapshotEnv();
      const relativeName = `chatpcb-rel-xdg-${process.pid}`;
      try {
        process.env.HOME = path.join(root, 'sentinel');
        process.env.XDG_CONFIG_HOME = path.join(root, 'sentinel-xdg');
        for (const xdgValue of [configRoot, `${configRoot}${path.sep}`]) {
          const copied = await migrateLegacyChatGPTConfig({
            platform: 'linux',
            home,
            env: { XDG_CONFIG_HOME: xdgValue }
          });
          assert.deepEqual(copied, [], xdgValue);
        }
        assertMode(await modeOf(path.join(legacy, 'chatgpt-host-id.txt')), 0o644);
        const missingHome = path.join(root, 'empty-home');
        assert.deepEqual(await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home: missingHome,
          env: { XDG_CONFIG_HOME: xdg }
        }), []);
        assert.equal(existsSync(path.join(xdg, 'chatpcb')), false);
        await writeOwned(path.join(missingHome, '.config', 'chatpcb', 'chatgpt.json'), '{}');
        await writeOwned(path.join(missingHome, '.config', 'chatpcb', 'notes.txt'), 'no');
        assert.deepEqual(await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home: missingHome,
          env: { XDG_CONFIG_HOME: xdg }
        }), []);
        assert.equal(existsSync(path.join(xdg, 'chatpcb')), false);
        for (const value of ['', '   ', relativeName, 'rel/cfg', './cfg']) {
          assert.deepEqual(await migrateLegacyChatGPTConfig({
            platform: 'linux',
            home,
            env: { XDG_CONFIG_HOME: value }
          }), [], JSON.stringify(value));
        }
        assert.equal(existsSync(path.resolve(relativeName)), false);
        for (const platform of ['darwin', 'win32']) {
          assert.deepEqual(await migrateLegacyChatGPTConfig({
            platform,
            home,
            env: { XDG_CONFIG_HOME: xdg, APPDATA: path.join(home, 'AppData', 'Roaming') }
          }), [], platform);
        }
        assert.equal(existsSync(path.join(xdg, 'chatpcb')), false);
        assert.equal(existsSync(path.join(root, 'sentinel', '.config')), false);
        assert.equal(await readFile(path.join(legacy, 'chatgpt-host-id.txt'), 'utf8'), HOST_ID);
        assert.equal(logs.lines.some((line) => line.includes('Copied ChatGPT config')), false);
      } finally {
        logs.restore();
        restoreEnv(saved);
        await rm(path.resolve(relativeName), { recursive: true, force: true });
      }
    });
  });

  test('treats an XDG_CONFIG_HOME symlink to ~/.config as the same directory', async (t) => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const legacy = path.join(home, '.config', 'chatpcb');
      await writeOwned(path.join(legacy, 'chatgpt-host-id.txt'), HOST_ID);
      const linkPath = path.join(root, 'xdg-link');
      try {
        await symlink(path.join(home, '.config'), linkPath, 'dir');
      } catch (error) {
        if (error.code === 'EPERM') {
          t.skip('directory symlink is not permitted');
          return;
        }
        throw error;
      }
      const logs = captureErrors();
      try {
        const copied = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: linkPath }
        });
        assert.deepEqual(copied, []);
        assert.equal(await readFile(path.join(legacy, 'chatgpt-host-id.txt'), 'utf8'), HOST_ID);
        assert.equal(existsSync(path.join(legacy, 'chatpcb')), false);
        assertMode(await modeOf(path.join(legacy, 'chatgpt-host-id.txt')), 0o644);
        assert.equal(logs.lines.some((line) => line.includes('Copied ChatGPT config')), false);
      } finally {
        logs.restore();
      }
    });
  });

  test('concurrent copies publish one complete file and leave no temporary names', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const body = JSON.stringify({ client_id: 'oaiapp_TEST', access_token: TOKEN });
      await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_TEST.json'), body);
      await writeOwned(path.join(legacy, 'chatgpt-host-id.txt'), HOST_ID);
      const opts = { platform: 'linux', home, env: { XDG_CONFIG_HOME: xdg } };
      const logs = captureErrors();
      try {
        const [first, second] = await Promise.all([
          migrateLegacyChatGPTConfig(opts),
          migrateLegacyChatGPTConfig(opts)
        ]);
        const migrated = ['chatgpt-credentials-oaiapp_TEST.json', 'chatgpt-host-id.txt'];
        const names = (await readdir(dest)).sort();
        assert.deepEqual(names, [MIGRATION_MARKER, ...migrated].sort());
        assert.equal(await readFile(path.join(dest, 'chatgpt-host-id.txt'), 'utf8'), HOST_ID);
        assert.equal(await readFile(path.join(dest, 'chatgpt-credentials-oaiapp_TEST.json'), 'utf8'), body);
        assert.equal(await readFile(path.join(dest, MIGRATION_MARKER), 'utf8').then((text) => text.includes(TOKEN)), false);
        assert.deepEqual([...new Set([...first, ...second])].sort(), migrated);
        assertMode(await modeOf(dest), 0o700);
        assertMode(await modeOf(path.join(dest, 'chatgpt-host-id.txt')), 0o600);
        assert.equal(logs.lines.some((line) => line.includes(TOKEN)), false);
      } finally {
        logs.restore();
      }
    });
  });

  test('loadCredentials and getOrCreateHostId read files copied from the injected home', async (t) => {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      t.skip('XDG_CONFIG_HOME applies only off macOS and Windows');
      return;
    }
    await withTemp(async (root) => {
      const saved = snapshotEnv();
      const logs = captureErrors();
      try {
        const viaLoad = path.join(root, 'via-load');
        const loadHome = path.join(viaLoad, 'home');
        const loadXdg = path.join(viaLoad, 'xdg');
        const issued = { client_id: 'oaiapp_TEST', access_token: TOKEN };
        await writeOwned(
          path.join(loadHome, '.config', 'chatpcb', 'chatgpt-credentials-oaiapp_TEST.json'),
          JSON.stringify(issued)
        );
        await writeOwned(path.join(loadHome, '.config', 'chatpcb', 'chatgpt-host-id.txt'), HOST_ID);
        process.env.HOME = loadHome;
        process.env.USERPROFILE = loadHome;
        process.env.XDG_CONFIG_HOME = loadXdg;
        delete process.env.APPDATA;
        delete process.env.LOCALAPPDATA;
        const loaded = await loadCredentials();
        assert.equal(loaded.client_id, 'oaiapp_TEST');
        assert.equal(loaded.access_token, TOKEN);
        assert.equal(
          await readFile(path.join(loadXdg, 'chatpcb', 'chatgpt-host-id.txt'), 'utf8'),
          HOST_ID
        );
        assert.equal(await getOrCreateHostId(), HOST_ID);
        assert.equal(
          await readFile(path.join(loadXdg, 'chatpcb', 'chatgpt-host-id.txt'), 'utf8'),
          HOST_ID
        );

        const viaHost = path.join(root, 'via-host');
        const hostHome = path.join(viaHost, 'home');
        const hostXdg = path.join(viaHost, 'xdg');
        await writeOwned(
          path.join(hostHome, '.config', 'chatpcb', 'chatgpt-credentials-oaiapp_TEST.json'),
          JSON.stringify(issued)
        );
        await writeOwned(path.join(hostHome, '.config', 'chatpcb', 'chatgpt-host-id.txt'), HOST_ID);
        process.env.HOME = hostHome;
        process.env.USERPROFILE = hostHome;
        process.env.XDG_CONFIG_HOME = hostXdg;
        assert.equal(await getOrCreateHostId(), HOST_ID);
        const fromHost = await loadCredentials();
        assert.equal(fromHost.access_token, TOKEN);
        assert.equal(
          await readFile(path.join(hostHome, '.config', 'chatpcb', 'chatgpt-host-id.txt'), 'utf8'),
          HOST_ID
        );
        assert.equal(logs.lines.some((line) => line.includes(TOKEN)), false);
        assert.equal(logs.lines.filter((line) => line.includes('Copied ChatGPT config')).length, 2);
      } finally {
        logs.restore();
        restoreEnv(saved);
      }
    });
  });

  test('the first migration still copies, then a removed copy is not migrated again', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const body = JSON.stringify({ client_id: 'oaiapp_old', access_token: 'OLD_AT' });
      await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_old.json'), body);
      const logs = captureErrors();
      try {
        const copied = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg }
        });
        assert.deepEqual(copied, ['chatgpt-credentials-oaiapp_old.json']);
        assert.equal(await readFile(path.join(dest, 'chatgpt-credentials-oaiapp_old.json'), 'utf8'), body);
        const marker = path.join(dest, MIGRATION_MARKER);
        const markerStat = await lstat(marker);
        assert.equal(markerStat.isSymbolicLink(), false);
        assert.equal(markerStat.isFile(), true);
        assertMode(markerStat.mode & 0o777, 0o600);
        assert.equal((await readdir(dest)).some((name) => name.endsWith('.tmp')), false);
        await unlink(path.join(dest, 'chatgpt-credentials-oaiapp_old.json'));
        const again = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg }
        });
        assert.deepEqual(again, []);
        assert.equal(existsSync(path.join(dest, 'chatgpt-credentials-oaiapp_old.json')), false);
        assert.equal(await readFile(path.join(legacy, 'chatgpt-credentials-oaiapp_old.json'), 'utf8'), body);
        assert.equal(logs.lines.some((line) => line.includes('OLD_AT')), false);
      } finally {
        logs.restore();
      }
    });
  });

  test('deleteCredentials then loadCredentials does not restore legacy credentials', async (t) => {
    if (skipUnlessXdgMigration(t)) return;
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const fileName = 'chatgpt-credentials-oaiapp_old.json';
      const body = JSON.stringify({ client_id: 'oaiapp_old', access_token: 'OLD_AT' });
      await writeOwned(path.join(legacy, fileName), body);
      await writeOwned(path.join(dest, fileName), body);
      const saved = useDistinctConfig(home, xdg);
      const logs = captureErrors();
      try {
        await deleteCredentials();
        assert.equal(existsSync(path.join(dest, fileName)), false);
        const marker = await lstat(path.join(dest, MIGRATION_MARKER));
        assert.equal(marker.isSymbolicLink(), false);
        assert.equal(marker.isFile(), true);
        assertMode(marker.mode & 0o777, 0o600);
        assert.equal(await loadCredentials(), null);
        assert.equal(existsSync(path.join(dest, fileName)), false);
        assert.equal(await readFile(path.join(legacy, fileName), 'utf8'), body);
        assert.equal(logs.lines.some((line) => line.includes('OLD_AT')), false);
        assert.equal((await readdir(dest)).some((name) => name.endsWith('.tmp')), false);
      } finally {
        logs.restore();
        restoreEnv(saved);
      }
    });
  });

  test('invalid_client cleanup then loadCredentials does not restore legacy credentials', async (t) => {
    if (skipUnlessXdgMigration(t)) return;
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const fileName = 'chatgpt-credentials-oaiapp_old.json';
      const body = JSON.stringify({ client_id: 'oaiapp_old', access_token: 'OLD_AT', refresh_token: 'OLD_RT' });
      await writeOwned(path.join(legacy, fileName), body);
      await writeOwned(path.join(dest, fileName), body);
      const saved = useDistinctConfig(home, xdg);
      const originalFetch = globalThis.fetch;
      const logs = captureErrors();
      try {
        useFallbackAuthEndpoints();
        globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_client' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
        await assert.rejects(refreshAccessToken('OLD_RT', 'oaiapp_old'), (err) => {
          assert.equal(err.code, 'invalid_client');
          assert.equal(String(err.message).includes('OLD_AT'), false);
          assert.equal(String(err.message).includes('OLD_RT'), false);
          return true;
        });
        assert.equal(existsSync(path.join(dest, fileName)), false);
        const marker = await lstat(path.join(dest, MIGRATION_MARKER));
        assert.equal(marker.isSymbolicLink(), false);
        assert.equal(marker.isFile(), true);
        assertMode(marker.mode & 0o777, 0o600);
        assert.equal(await loadCredentials(), null);
        assert.equal(existsSync(path.join(dest, fileName)), false);
        assert.equal(await readFile(path.join(legacy, fileName), 'utf8'), body);
        assert.equal(logs.lines.some((line) => line.includes('OLD_AT') || line.includes('OLD_RT')), false);
      } finally {
        globalThis.fetch = originalFetch;
        clearOidcDiscoveryCache();
        logs.restore();
        restoreEnv(saved);
      }
    });
  });

  test('sign-out writes the migration marker so a later load cannot import legacy credentials', async (t) => {
    if (skipUnlessXdgMigration(t)) return;
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const fileName = 'chatgpt-credentials-oaiapp_old.json';
      const body = JSON.stringify({ client_id: 'oaiapp_old', access_token: 'OLD_AT' });
      await writeOwned(path.join(legacy, fileName), body);
      const saved = useDistinctConfig(home, xdg);
      const logs = captureErrors();
      try {
        const manager = createChatGPTAuthManager();
        assert.equal((await manager.signOut()).state, 'signed_out');
        const marker = await lstat(path.join(dest, MIGRATION_MARKER));
        assert.equal(marker.isSymbolicLink(), false);
        assert.equal(marker.isFile(), true);
        assertMode(marker.mode & 0o777, 0o600);
        assertMode(await modeOf(dest), 0o700);
        assert.equal(await loadCredentials(), null);
        assert.equal(existsSync(path.join(dest, fileName)), false);
        assert.equal(await readFile(path.join(legacy, fileName), 'utf8'), body);
        assert.equal(logs.lines.some((line) => line.includes('OLD_AT')), false);
      } finally {
        logs.restore();
        restoreEnv(saved);
      }
    });
  });

  test('copies with an exclusive file copy when hard links are unsupported', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const body = JSON.stringify({ client_id: 'oaiapp_old', access_token: 'OLD_AT' });
      await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_old.json'), body);
      for (const code of ['EPERM', 'EXDEV', 'ENOTSUP']) {
        await rm(dest, { recursive: true, force: true });
        const copyCalls = [];
        let links = 0;
        const logs = captureErrors();
        try {
          const copied = await migrateLegacyChatGPTConfig({
            platform: 'linux',
            home,
            env: { XDG_CONFIG_HOME: xdg },
            fsImpl: {
              async link() {
                links += 1;
                const error = new Error(`injected ${code}`);
                error.code = code;
                throw error;
              },
              async copyFile(src, target, flag) {
                copyCalls.push({ target, flag: flag ?? null });
                if (flag === undefined) await copyFile(src, target);
                else await copyFile(src, target, flag);
              }
            }
          });
          assert.equal(links > 0, true, code);
          assert.deepEqual(copied, ['chatgpt-credentials-oaiapp_old.json']);
          assert.equal(await readFile(path.join(dest, 'chatgpt-credentials-oaiapp_old.json'), 'utf8'), body);
          assertMode(await modeOf(path.join(dest, 'chatgpt-credentials-oaiapp_old.json')), 0o600);
          assertMode(await modeOf(path.join(dest, MIGRATION_MARKER)), 0o600);
          const exclusive = copyCalls.filter((call) => call.flag === fsConstants.COPYFILE_EXCL);
          assert.deepEqual(exclusive.map((call) => path.basename(call.target)).sort(), [
            MIGRATION_MARKER,
            'chatgpt-credentials-oaiapp_old.json'
          ]);
          assert.equal((await readdir(dest)).some((name) => name.endsWith('.tmp')), false);
          assert.equal(logs.lines.some((line) => line.includes('OLD_AT')), false);
          assertMode(await modeOf(path.join(legacy, 'chatgpt-credentials-oaiapp_old.json')), 0o644);
        } finally {
          logs.restore();
        }
      }
    });
  });

  test('an unsupported hard link still refuses to replace an existing credential', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      const kept = '{"client_id":"oaiapp_old","access_token":"KEEP"}\n';
      await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_old.json'), '{"client_id":"oaiapp_old","access_token":"OLD_AT"}\n');
      await writeOwned(path.join(dest, 'chatgpt-credentials-oaiapp_old.json'), kept);
      const logs = captureErrors();
      try {
        const copied = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg },
          fsImpl: {
            async link() {
              const error = new Error('injected EPERM');
              error.code = 'EPERM';
              throw error;
            }
          }
        });
        assert.deepEqual(copied, []);
        assert.equal(await readFile(path.join(dest, 'chatgpt-credentials-oaiapp_old.json'), 'utf8'), kept);
        assert.equal(logs.lines.some((line) => line.includes('OLD_AT')), false);
      } finally {
        logs.restore();
      }
    });
  });

  test('hard link errors other than an existing file or an unsupported link still fail', async () => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const legacy = path.join(home, '.config', 'chatpcb');
      const dest = path.join(xdg, 'chatpcb');
      await writeOwned(
        path.join(legacy, 'chatgpt-credentials-oaiapp_old.json'),
        JSON.stringify({ client_id: 'oaiapp_old', access_token: 'OLD_AT' })
      );
      const logs = captureErrors();
      try {
        await assert.rejects(
          migrateLegacyChatGPTConfig({
            platform: 'linux',
            home,
            env: { XDG_CONFIG_HOME: xdg },
            fsImpl: {
              link() {
                const error = new Error('injected EIO');
                error.code = 'EIO';
                throw error;
              }
            }
          }),
          (err) => err?.code === 'EIO'
        );
        assert.equal(existsSync(path.join(dest, 'chatgpt-credentials-oaiapp_old.json')), false);
        assert.equal(existsSync(path.join(dest, MIGRATION_MARKER)), false);
        assert.equal(logs.lines.some((line) => line.includes('OLD_AT')), false);
      } finally {
        logs.restore();
      }
    });
  });

  test('does not follow a symlinked legacy directory or symlinked credential files', async (t) => {
    await withTemp(async (root) => {
      const home = path.join(root, 'home');
      const xdg = path.join(root, 'xdg');
      const outside = path.join(root, 'outside');
      const realLegacy = path.join(root, 'real-legacy');
      const secret = JSON.stringify({ client_id: 'oaiapp_link', access_token: 'SYMLINK_SECRET' });
      const real = JSON.stringify({ client_id: 'oaiapp_real', access_token: 'REAL_TOKEN' });
      await writeOwned(path.join(outside, 'secret.json'), secret);
      await writeOwned(path.join(realLegacy, 'chatgpt-credentials-oaiapp_link.json'), secret);
      const legacy = path.join(home, '.config', 'chatpcb');
      await mkdir(path.join(home, '.config'), { recursive: true });
      try {
        await symlink(realLegacy, legacy, 'dir');
      } catch (error) {
        if (error.code === 'EPERM') {
          t.skip('directory symlink is not permitted');
          return;
        }
        throw error;
      }
      const logs = captureErrors();
      try {
        const copiedDir = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg }
        });
        assert.deepEqual(copiedDir, []);
        assert.equal(existsSync(path.join(xdg, 'chatpcb', 'chatgpt-credentials-oaiapp_link.json')), false);
        await rm(legacy, { force: true });
        await mkdir(legacy, { recursive: true });
        await symlink(path.join(outside, 'secret.json'), path.join(legacy, 'chatgpt-credentials-oaiapp_link.json'), 'file');
        await writeOwned(path.join(legacy, 'chatgpt-credentials-oaiapp_real.json'), real);
        const copiedFiles = await migrateLegacyChatGPTConfig({
          platform: 'linux',
          home,
          env: { XDG_CONFIG_HOME: xdg }
        });
        assert.deepEqual(copiedFiles, ['chatgpt-credentials-oaiapp_real.json']);
        const dest = path.join(xdg, 'chatpcb');
        assert.equal(existsSync(path.join(dest, 'chatgpt-credentials-oaiapp_link.json')), false);
        assert.equal(await readFile(path.join(dest, 'chatgpt-credentials-oaiapp_real.json'), 'utf8'), real);
        for (const name of await readdir(dest)) {
          const text = await readFile(path.join(dest, name), 'utf8').catch(() => '');
          assert.equal(text.includes('SYMLINK_SECRET'), false, name);
        }
        assert.equal(logs.lines.some((line) => line.includes('SYMLINK_SECRET')), false);
      } finally {
        logs.restore();
      }
    });
  });
});
