#!/usr/bin/env node

/**
 * Interactive CLI launcher for Northbridge's visible, dedicated Chrome research profile
 * and Control Console UI.
 */

import path from 'node:path';
import readline from 'node:readline';
import { createControlManager } from '../chrome-control.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { profileDir: undefined, url: null, cdp: null, headless: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--profile-dir' || a === '--user-data-dir') && args[i + 1]) opts.profileDir = path.resolve(args[++i]);
    else if (a === '--url' && args[i + 1]) opts.url = args[++i];
    else if (a === '--cdp' && args[i + 1]) opts.cdp = args[++i];
    else if (a === '--headless') opts.headless = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Northbridge Dedicated Research Chrome Launcher

Usage:
  node bin/northbridge-control.mjs [--url <https://...>] [--profile-dir <dir>]

Options:
  --url <url>           Optional starting research tab URL
  --profile-dir <dir>   Dedicated Chrome profile directory (default: %LOCALAPPDATA%/Northbridge/ResearchProfile)
  --cdp <port>          Attach to existing dedicated Chrome debugging port
  --headless            Run headless (default is visible browser window)
`);
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs();
const mgr = createControlManager({
  profileDir: opts.profileDir,
  headless: opts.headless
});

const startRes = await mgr.start({ initialUrl: opts.url, cdp: opts.cdp });
if (!startRes.ok) {
  console.error(`Failed to start dedicated research Chrome: ${startRes.error}`);
  process.exit(1);
}

console.log('========================================================================');
console.log('Northbridge Dedicated Chrome Research Profile Running');
console.log(`Profile Directory: ${startRes.profileDir}`);
console.log(`Control Console:   ${mgr.hostHandle.getControlUrlWithToken()}`);
console.log('Commands: tabs | pause | resume | revoke | quit');
console.log('========================================================================');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', async (line) => {
  const cmd = line.trim().toLowerCase();
  if (cmd === 'tabs') {
    const st = await mgr.status();
    console.log('Controlled:', st.controlledTab);
    console.log('Tabs:', st.availableTabs);
  } else if (cmd === 'pause') {
    console.log(await mgr.hostHandle.pause('Paused via CLI host'));
  } else if (cmd === 'resume') {
    console.log(await mgr.hostHandle.resume());
  } else if (cmd === 'revoke') {
    console.log(await mgr.hostHandle.revoke('Revoked via CLI host'));
  } else if (cmd === 'quit' || cmd === 'exit') {
    await mgr.close({ closeBrowser: false });
    process.exit(0);
  }
});
