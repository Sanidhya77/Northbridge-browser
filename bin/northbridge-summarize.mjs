#!/usr/bin/env node

/**
 * Northbridge Browser Read-Only Page Summary CLI.
 * Supports two strictly separated modes:
 *   1. Approved open Chrome tab: --auto-connect --approved --tab "<pattern>" [--section "<Heading>"]
 *   2. Public URL (via northbridge-research security boundary): --url "<https://...>" [--section "<Heading>"]
 */

import path from 'node:path';
import {
  summarizeApprovedTab,
  summarizePublicUrl,
  formatPageSummaryText
} from '../page-summary.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: null,
    tab: null,
    cdp: null,
    autoConnect: false,
    approved: null,
    pinTab: true,
    profileDir: null,
    section: null,
    sectionIndex: 1,
    maxChars: 2200,
    charOffset: 0,
    maxTableRows: 20,
    includeLinks: true,
    includeTables: true,
    reveal: false,
    includeScreenshot: false,
    screenshotReason: null,
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' && args[i + 1]) opts.url = args[++i];
    else if (arg === '--tab' && args[i + 1]) opts.tab = args[++i];
    else if ((arg === '--cdp' || arg === '--attach-chrome') && args[i + 1]) opts.cdp = args[++i];
    else if (arg === '--auto-connect' || arg === '--use-open-tab') opts.autoConnect = true;
    else if (arg === '--approve' || arg === '--approved') opts.approved = true;
    else if (arg === '--deny' || arg === '--denied') opts.approved = false;
    else if (arg === '--pin-tab') opts.pinTab = true;
    else if (arg === '--no-pin-tab') opts.pinTab = false;
    else if ((arg === '--profile-dir' || arg === '--user-data-dir') && args[i + 1]) opts.profileDir = path.resolve(args[++i]);
    else if (arg === '--section' && args[i + 1]) opts.section = args[++i];
    else if (arg === '--section-index' && args[i + 1]) opts.sectionIndex = parseInt(args[++i], 10);
    else if (arg === '--max-chars' && args[i + 1]) opts.maxChars = parseInt(args[++i], 10);
    else if (arg === '--offset' && args[i + 1]) opts.charOffset = parseInt(args[++i], 10);
    else if (arg === '--max-table-rows' && args[i + 1]) opts.maxTableRows = parseInt(args[++i], 10);
    else if (arg === '--no-links') opts.includeLinks = false;
    else if (arg === '--no-tables') opts.includeTables = false;
    else if (arg === '--reveal') {
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        opts.reveal = args[++i];
      } else {
        opts.reveal = true;
      }
    }
    else if (arg === '--screenshot-reason' && args[i + 1]) {
      opts.includeScreenshot = true;
      opts.screenshotReason = args[++i];
    }
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Northbridge Read-Only Page Summary Pilot

Usage:
  node bin/northbridge-summarize.mjs --auto-connect --approved --tab "IEEE" [--section "Abstract"]
  node bin/northbridge-summarize.mjs --url "https://example.org/docs" [--section "API"]

Options:
  --tab <pattern>              Summarize an already-open Chrome tab (requires --auto-connect/--cdp & --approved)
  --auto-connect               Auto-discover running Chrome debugging endpoint
  --cdp <port|url>             Explicit loopback Chrome debugging endpoint fallback
  --profile-dir <dir>          Chrome User Data directory override
  --approved / --deny          Explicit user consent to attach to open Chrome tab
  --url <url>                  Summarize a public HTTP/HTTPS page via northbridge-research security gates
                               (domain must be listed in NORTHBRIDGE_APPROVED_DOMAINS)
  --section <heading>          Return a specific section heading cleanly instead of page start
  --section-index <n>          1-based section index to start from (default: 1)
  --max-chars <n>              Max prose characters per response (default: 2200)
  --offset <n>                 Character offset within a single long section
  --max-table-rows <n>         Max structured rows per table (default: 20)
  --reveal [labels]            Safely activate safe read-only tabs/accordions/pagination/Load-more & verify
  --no-links / --no-tables     Omit links or structured tables from output
  --screenshot-reason <text>   Explicit visual reason (charts/layout) to allow one screenshot
  --json                       Print raw structured JSON result
`);
      process.exit(0);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  if (opts.url && (opts.tab || opts.autoConnect || opts.cdp)) {
    console.error('PERMISSION BOUNDARY ERROR: Specify EITHER --url <public-url> OR --tab <approved-open-tab>, not both.');
    process.exit(1);
  }

  let res;
  if (opts.url) {
    res = await summarizePublicUrl({
      url: opts.url,
      section: opts.section,
      sectionIndex: opts.sectionIndex,
      maxChars: opts.maxChars,
      charOffset: opts.charOffset,
      maxTableRows: opts.maxTableRows,
      includeLinks: opts.includeLinks,
      includeTables: opts.includeTables,
      reveal: opts.reveal,
      includeScreenshot: opts.includeScreenshot,
      screenshotReason: opts.screenshotReason
    });
  } else {
    res = await summarizeApprovedTab({
      tab: opts.tab,
      cdp: opts.cdp,
      autoConnect: opts.autoConnect,
      approved: opts.approved,
      pinTab: opts.pinTab,
      profileDir: opts.profileDir,
      section: opts.section,
      sectionIndex: opts.sectionIndex,
      maxChars: opts.maxChars,
      charOffset: opts.charOffset,
      maxTableRows: opts.maxTableRows,
      includeLinks: opts.includeLinks,
      includeTables: opts.includeTables,
      reveal: opts.reveal,
      includeScreenshot: opts.includeScreenshot,
      screenshotReason: opts.screenshotReason
    });
  }

  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(formatPageSummaryText(res));
  }

  process.exit(res.ok ? 0 : 1);
}

main().catch(err => {
  console.error('Summary command failed:', err.message);
  process.exit(1);
});
