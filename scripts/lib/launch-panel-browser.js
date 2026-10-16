import { chromium } from 'playwright';

import { chromeLaunchOptions, findChrome as findInstalledChrome } from './find-chrome.js';

// Same launch path as verify:ui. A headless shell is enough when its path is passed as executablePath.
// A missing browser fails in CI and skips on a local machine.
export async function launchPanelBrowser(t, {
  findChrome = findInstalledChrome,
  launch = (options) => chromium.launch(options),
  env = process.env,
  headless = true,
  args
} = {}) {
  try {
    const found = await findChrome();
    if (!found?.path) throw new Error(found?.reason || 'Chromium unavailable');
    return await launch({
      ...chromeLaunchOptions(found, { headless }),
      ...(args ? { args } : {})
    });
  } catch (error) {
    if (env.CI) throw error;
    t.skip(`Chromium unavailable: ${error.message}`);
    return null;
  }
}
