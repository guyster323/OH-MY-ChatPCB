import fs from 'node:fs';
import path from 'node:path';

export const KICAD_FLATPAK_APP_ID = 'org.kicad.KiCad';

const MAX_FLATPAK_WRAPPER_BYTES = 64 * 1024;
const KICAD_DIRECTORY_ENV = /^KICAD\d*(?:_[A-Z0-9]+)+_DIR$/;
const wrapperScriptCache = new Map();

let flatpakLibraryRootOverride = null;

const FLATPAK_LAYOUT_DIR = new Set(['exports', 'app', 'runtime']);
const FLATPAK_FORCE_ON = new Set(['1', 'true', 'yes']);
const FLATPAK_FORCE_OFF = new Set(['0', 'false', 'no']);

function pathSegments(value) {
  return String(value).split(/[/\\]+/).filter((segment) => segment.length > 0);
}

// Only a real Flatpak install layout counts. A directory that is merely named
// "flatpak", or "flatpak-tools", is a different tree.
export function isFlatpakPath(value) {
  const segments = pathSegments(value);
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== 'flatpak' || !FLATPAK_LAYOUT_DIR.has(segments[index + 1])) continue;
    const previous = segments[index - 1];
    const beforePrevious = segments[index - 2];
    if (beforePrevious === 'var' && previous === 'lib') return true;
    if (beforePrevious === '.local' && previous === 'share') return true;
  }
  return false;
}

function flatpakUserHome(env = {}) {
  for (const key of ['HOME', 'USERPROFILE']) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function flatpakCliOverride(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (FLATPAK_FORCE_ON.has(normalized)) return true;
  if (FLATPAK_FORCE_OFF.has(normalized)) return false;
  return null;
}

export function isKicadDirectoryEnv(key) {
  return KICAD_DIRECTORY_ENV.test(key);
}

// Tests point runtime discovery at a fake tree with the Flatpak layout.
// Null restores /var/lib/flatpak and ~/.local/share/flatpak.
export function setFlatpakLibraryRootsForTests(roots) {
  const previous = flatpakLibraryRootOverride;
  flatpakLibraryRootOverride = Array.isArray(roots) ? [...roots] : null;
  return previous;
}

// Override roots are returned as given. Default roots go through mapPath so a
// library-search root can relocate /var/lib/flatpak and the user Flatpak dir.
export function flatpakLibraryRoots({
  mapPath = (candidate) => candidate,
  platform = process.platform,
  env = process.env
} = {}) {
  if (Array.isArray(flatpakLibraryRootOverride)) {
    return [...flatpakLibraryRootOverride];
  }
  if (platform !== 'linux') {
    return [];
  }

  const roots = ['/var/lib/flatpak'];
  const home = flatpakUserHome(env);
  if (home) roots.push(path.join(home, '.local', 'share', 'flatpak'));
  return roots.map((candidate) => mapPath(candidate));
}

export function flatpakAppLibraryPaths(libraryType, {
  platform = process.platform,
  env = process.env,
  mapPath = (candidate) => candidate
} = {}) {
  if (platform !== 'linux') {
    return [];
  }
  const paths = [
    `/var/lib/flatpak/app/${KICAD_FLATPAK_APP_ID}/current/active/files/share/kicad/${libraryType}`
  ];
  const home = flatpakUserHome(env);
  if (home) {
    paths.push(path.join(
      home,
      '.local',
      'share',
      'flatpak',
      'app',
      KICAD_FLATPAK_APP_ID,
      'current',
      'active',
      'files',
      'share',
      'kicad',
      libraryType
    ));
  }
  return paths.map((candidate) => mapPath(candidate));
}

function flatpakRuntimeName(libraryType) {
  if (libraryType === 'symbols') return 'org.kicad.KiCad.Library.Symbols';
  if (libraryType === 'footprints') return 'org.kicad.KiCad.Library.Footprints';
  return null;
}

function readFlatpakPathEntries(dir, readdir) {
  try {
    return readdir(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

// <root>/runtime/org.kicad.KiCad.Library.<Kind>/<arch>/<branch>/active/files/<symbols|footprints>
export function flatpakRuntimeLibraryCandidatePaths(libraryType, {
  roots = flatpakLibraryRoots(),
  exists = fs.existsSync,
  readdir = fs.readdirSync
} = {}) {
  const runtimeName = flatpakRuntimeName(libraryType);
  if (!runtimeName) return [];

  const candidates = [];
  for (const root of roots) {
    const runtimeRoot = path.join(root, 'runtime', runtimeName);
    for (const arch of readFlatpakPathEntries(runtimeRoot, readdir)) {
      const archDir = path.join(runtimeRoot, arch);
      for (const branch of readFlatpakPathEntries(archDir, readdir)) {
        const libraryDir = path.join(archDir, branch, 'active', 'files', libraryType);
        if (exists(libraryDir)) candidates.push(libraryDir);
      }
    }
  }
  return candidates;
}

function isKicadFlatpakWrapperName(cliPath) {
  const base = String(cliPath).split(/[/\\]/).pop();
  return base === KICAD_FLATPAK_APP_ID || base === `${KICAD_FLATPAK_APP_ID}.exe`;
}

function flatpakCliBasename(cliPath) {
  return isKicadFlatpakWrapperName(cliPath) || isFlatpakPath(cliPath);
}

// Decide once, at CLI resolution. Off Windows, KICAD_CLI_FLATPAK forces the
// result: 1/true/yes on, 0/false/no off. Any other value is ignored. Windows
// ignores that variable. Flatpak layouts and the KiCad app id do not read the file.
export function cliIsFlatpakKicad(cliPath, {
  env = {},
  platform = process.platform,
  io = {}
} = {}) {
  if (!cliPath) return false;
  const platformId = io.platform ?? platform;
  if (platformId === 'win32') return false;
  const override = flatpakCliOverride(env.KICAD_CLI_FLATPAK);
  if (override != null) return override;
  if (flatpakCliBasename(cliPath)) return true;

  const realpathSync = io.realpathSync ?? fs.realpathSync;
  try {
    const resolved = realpathSync(cliPath);
    if (resolved && resolved !== cliPath && flatpakCliBasename(resolved)) return true;
  } catch {
    // A missing path is not a Flatpak wrapper.
  }

  try {
    return cachedScriptUsesFlatpak(cliPath, io);
  } catch {
    return false;
  }
}

function cachedScriptUsesFlatpak(cliPath, io) {
  const statSync = io.statSync ?? fs.statSync;
  const stat = statSync(cliPath);
  if (!stat?.isFile?.() || stat.size > MAX_FLATPAK_WRAPPER_BYTES || stat.size < 2) return false;
  const key = `${cliPath}\0${stat.mtimeMs}\0${stat.size}`;
  if (wrapperScriptCache.has(key)) return wrapperScriptCache.get(key);
  const text = readWrapperScript(cliPath, io);
  const uses = text != null && scriptUsesFlatpakKicad(text);
  wrapperScriptCache.set(key, uses);
  return uses;
}

function stripShellComment(line) {
  if (/^\s*#!/.test(line)) return line;
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

function scriptUsesFlatpakKicad(text) {
  const code = String(text).split(/\r?\n/).map((line) => stripShellComment(line)).join('\n');
  return code.includes('flatpak run') && code.includes('kicad-cli');
}

function closeQuietly(closeSync, fd) {
  try {
    closeSync(fd);
  } catch (error) {
    return error;
  }
  return undefined;
}

// Shell wrappers are small and start with a shebang. Do not slurp a kicad-cli binary.
function readWrapperScript(cliPath, io = {}) {
  const statSync = io.statSync ?? fs.statSync;
  const openSync = io.openSync ?? fs.openSync;
  const readSync = io.readSync ?? fs.readSync;
  const closeSync = io.closeSync ?? fs.closeSync;
  const stat = statSync(cliPath);
  if (!stat?.isFile?.() || stat.size > MAX_FLATPAK_WRAPPER_BYTES || stat.size < 2) return null;
  const fd = openSync(cliPath, 'r');
  try {
    const header = Buffer.alloc(2);
    const headerBytes = readSync(fd, header, 0, 2, 0);
    if (headerBytes < 2 || header.toString('utf8', 0, headerBytes) !== '#!') return null;
    const body = Buffer.alloc(stat.size);
    const bodyBytes = readSync(fd, body, 0, stat.size, 0);
    return body.toString('utf8', 0, bodyBytes);
  } finally {
    closeQuietly(closeSync, fd);
  }
}
