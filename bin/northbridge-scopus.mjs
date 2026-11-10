#!/usr/bin/env node

/**
 * Northbridge Browser Scopus Search & Export Tool.
 * Executes exact Scopus block searches, checks control papers,
 * exports verified CSVs, and produces reproducible search logs.
 *
 * Supports both starting points:
 *   1. An already-open Scopus tab (--tab <pattern>)
 *   2. User-provided library or Scopus link (--url <url>) with sign-in pause
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeScopusBlock, exportScopusResultsTab } from '../scopus-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  let exportMode = false;
  if (args[0] === 'export') {
    exportMode = true;
    args.shift();
  }

  const opts = {
    exportMode,
    block: 'D3',
    claim: 'Weights can be derived from a rank order.',
    query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )',
    control: 'Decision quality using ranked attribute weights',
    exportFile: null,
    from: 1,
    to: 20,
    count: null,
    expectedQuery: null,
    baseUrl: process.env.SCOPUS_BASE_URL || 'http://127.0.0.1:4318',
    outputDir: null,
    session: 'scopus-cli-' + Math.random().toString(36).slice(2, 8),
    tab: null,
    cdp: null,
    autoConnect: false,
    profileDir: null,
    approved: null,
    pinTab: true,
    verifyAttachment: false,
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--export-results') opts.exportMode = true;
    else if (arg === '--block' && args[i + 1]) opts.block = args[++i];
    else if (arg === '--claim' && args[i + 1]) opts.claim = args[++i];
    else if (arg === '--query' && args[i + 1]) opts.query = args[++i];
    else if (arg === '--expected-query' && args[i + 1]) opts.expectedQuery = args[++i];
    else if (arg === '--control' && args[i + 1]) opts.control = args[++i];
    else if (arg === '--export' && args[i + 1]) opts.exportFile = args[++i];
    else if (arg === '--from' && args[i + 1]) opts.from = parseInt(args[++i], 10);
    else if (arg === '--to' && args[i + 1]) opts.to = parseInt(args[++i], 10);
    else if (arg === '--count' && args[i + 1]) opts.count = parseInt(args[++i], 10);
    else if (arg === '--range' && args[i + 1]) {
      const m = String(args[++i]).match(/^(\d+)\s*[-–:]\s*(\d+)$/);
      if (m) {
        opts.from = parseInt(m[1], 10);
        opts.to = parseInt(m[2], 10);
      }
    }
    else if (arg === '--url' && args[i + 1]) opts.baseUrl = args[++i];
    else if (arg === '--tab' && args[i + 1]) opts.tab = args[++i];
    else if ((arg === '--cdp' || arg === '--attach-chrome') && args[i + 1]) opts.cdp = args[++i];
    else if (arg === '--auto-connect' || arg === '--use-open-tab' || arg === '--open-tab') opts.autoConnect = true;
    else if ((arg === '--profile-dir' || arg === '--user-data-dir') && args[i + 1]) opts.profileDir = path.resolve(args[++i]);
    else if (arg === '--approve' || arg === '--approved') opts.approved = true;
    else if (arg === '--deny' || arg === '--denied') opts.approved = false;
    else if (arg === '--pin-tab') opts.pinTab = true;
    else if (arg === '--no-pin-tab') opts.pinTab = false;
    else if (arg === '--verify-attachment') opts.verifyAttachment = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--output' && args[i + 1]) opts.outputDir = path.resolve(args[++i]);
    else if (arg === '--session' && args[i + 1]) opts.session = args[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`Northbridge Scopus Search & Export Tool

Usage:
  node bin/northbridge-scopus.mjs export --auto-connect --approved --tab "Scopus" --from 1 --to 20
  node bin/northbridge-scopus.mjs [options]

Commands / Modes:
  export                Repeatable results-tab -> CSV export only (starts from approved Scopus results tab)
  (default)             Mock/fixture end-to-end search + export workflow

Options:
  --export-results      Alias for 'export' subcommand
  --from <n>            First record to export (default: 1)
  --to <n>              Last record to export (default: 20)
  --count <n>           Number of records starting from --from (default: 20)
  --range <from-to>     Document range shorthand, e.g. 1-20
  --expected-query <s>  Verify exact displayed query on results page before exporting
  --block <id>          Search block identifier (default: D3)
  --claim <text>        Thesis claim being supported/evaluated
  --query <string>      Exact Scopus query string (enclosed in quotes)
  --control <title>     Known control paper title
  --export <filename>   Target CSV export filename
  --tab <pattern>       Select already-open browser tab matching pattern (e.g. "Scopus")
  --cdp <port|url>      Attach to external Chrome via loopback remote debugging (e.g. 9222 or 127.0.0.1:9222)
  --attach-chrome <p|u> Alias for --cdp
  --auto-connect        Attach to an already-open Chrome window (auto-discovers dynamic CDP endpoint)
  --profile-dir <dir>   Chrome profile / user data directory to inspect for auto-connect discovery
  --approve, --approved Explicit user approval to attach to open browser session
  --deny, --denied      Explicit denial of browser attachment
  --pin-tab             Pin session to the bound tab (default: enabled; prevents fallback to other tabs)
  --no-pin-tab          Disable tab pinning
  --verify-attachment   Verify attachment and target tab without executing search/export
  --url <url>           Scopus or library link (default: http://127.0.0.1:4318)
  --output <dir>        Directory to store verified exports (default: ./pilot-exports for export mode, ./exports for fixture mode)
  --session <name>      Browser session identifier
  --json                Output structured JSON result
`);
      process.exit(0);
    }
  }

  if (!opts.outputDir) {
    opts.outputDir = opts.exportMode
      ? path.resolve(__dirname, '..', 'pilot-exports')
      : path.resolve(__dirname, '..', 'exports');
  }
  if (!opts.exportFile) {
    const effTo = opts.count != null ? (opts.from + opts.count - 1) : opts.to;
    opts.exportFile = opts.exportMode
      ? `Ch3_34_SC_${opts.block}_${opts.from}-${effTo}.csv`
      : `Ch3_34_SC_${opts.block}.csv`;
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  if (opts.approved === false) {
    console.error('APPROVAL ERROR: Browser connection denied by user. Halting automation before accessing open browser.');
    process.exit(1);
  }

  if (opts.autoConnect && opts.approved !== true) {
    console.error('APPROVAL ERROR: User approval required to attach to open browser session. Pass --approved to proceed.');
    process.exit(1);
  }

  if (opts.verifyAttachment) {
    const targetDesc = opts.autoConnect ? 'open Chrome window (--auto-connect)' : (opts.cdp || 9222);
    console.log(`Verifying Chrome Attachment to ${targetDesc}...`);
    const { verifyCdpAttachment } = await import('../scopus-workflow.mjs');
    const attachRes = await verifyCdpAttachment({
      cdp: opts.cdp,
      autoConnect: opts.autoConnect,
      profileDir: opts.profileDir,
      approved: opts.approved !== false,
      pinTab: opts.pinTab,
      tab: opts.tab,
      session: opts.session
    });
    if (!attachRes.ok) {
      console.error(attachRes.error);
      process.exit(1);
    }
    console.log('========================================================================');
    console.log('ATTACHMENT VERIFICATION EVIDENCE:');
    console.log('========================================================================');
    console.log(`Endpoint: ${attachRes.endpoint}`);
    console.log(`Browser: ${attachRes.versionData?.Browser || 'Chrome'}`);
    console.log(`Target Tab ID: ${attachRes.targetTab?.targetId || attachRes.targetTab?.tabId}`);
    console.log(`Active Target ID: ${attachRes.activeTab?.targetId || attachRes.activeTab?.tabId}`);
    console.log(`Target Title: ${attachRes.targetTab?.title}`);
    console.log(`Target URL: ${attachRes.targetTab?.url}`);
    console.log(`Status: OK`);
    console.log('========================================================================\n');
    process.exit(0);
  }

  if (opts.exportMode) {
    const targetTab = opts.tab || 'Scopus';
    if (!opts.cdp && !opts.autoConnect) {
      console.error('ATTACHMENT ERROR: Scopus export mode requires --auto-connect --approved (or --cdp <port>) targeting an already-open approved Scopus results tab.');
      process.exit(1);
    }
    const expRes = await exportScopusResultsTab({
      from: opts.from,
      to: opts.to,
      count: opts.count,
      expectedQuery: opts.expectedQuery,
      outputDir: opts.outputDir,
      exportFile: opts.exportFile,
      tab: targetTab,
      cdp: opts.cdp,
      autoConnect: opts.autoConnect,
      approved: opts.approved,
      pinTab: opts.pinTab,
      profileDir: opts.profileDir,
      session: opts.session
    });

    if (opts.json) {
      console.log(JSON.stringify(expRes, null, 2));
    } else if (!expRes.ok) {
      console.error('========================================================================');
      console.error(`SCOPUS EXPORT FAILED [${expRes.status || 'ERROR'}]:`);
      console.error(expRes.error);
      console.error('========================================================================');
    } else {
      console.log('========================================================================');
      console.log('SCOPUS RESULTS EXPORT SUMMARY:');
      console.log('========================================================================');
      console.log(`Status: OK (${expRes.status})`);
      console.log(`Displayed Query: ${expRes.displayedQuery}`);
      console.log(`Total Results Observed: ${expRes.totalMain}`);
      console.log(`Requested Range: ${expRes.effectiveRange.from}-${expRes.effectiveRange.to} (${expRes.parsedRowCount} rows verified)`);
      console.log(`Saved CSV Path: ${expRes.exportFilePath}`);
      console.log(`Existing File Preserved: ${expRes.preservedExistingFile ? 'Yes (collision saved to unique filename)' : 'N/A (new filename)'}`);
      console.log(`Required Columns Present: ${JSON.stringify(expRes.presentColumns)}`);
      console.log(`Blank Cell Counts (valid rows w/ blank field): ${JSON.stringify(expRes.blankCells)}`);
      console.log(`Download Attribution: ${JSON.stringify(expRes.downloadAttribution)}`);
      console.log(`Metrics: browserActionMs=${expRes.metrics.browserActionMs}, totalWallMs=${expRes.metrics.totalWallMs}, toolCalls=${expRes.metrics.toolCalls}, obsBytes=${expRes.metrics.observationUtf8Bytes}`);
      console.log('========================================================================\n');
    }

    process.exit(expRes.ok ? 0 : 1);
  }

  console.log(`Running Scopus Search Block [${opts.block}]...`);
  if (opts.cdp || opts.autoConnect) {
    const attachType = opts.autoConnect ? 'Open Chrome window via --auto-connect' : `External Chrome instance at ${opts.cdp}`;
    console.log(`Attachment: ${attachType}`);
    if (!opts.tab) {
      console.error('ATTACHMENT ERROR: A target tab pattern (--tab <pattern>) is required when attaching to external Chrome via --cdp / --auto-connect.');
      process.exit(1);
    }
  }
  if (opts.tab) console.log(`Starting Point: Existing tab matching "${opts.tab}"`);
  else console.log(`Starting Point: URL ${opts.baseUrl}`);
  console.log(`Query: ${opts.query}`);
  console.log(`Control: ${opts.control}`);
  console.log(`Export File: ${opts.exportFile}\n`);

  let fixture = null;
  if (!opts.cdp && !opts.autoConnect && !opts.tab && (opts.baseUrl.includes('127.0.0.1:4318') || opts.baseUrl.includes('localhost:4318'))) {
    try {
      await fetch(opts.baseUrl, { signal: AbortSignal.timeout(500) });
    } catch (e) {
      const { createScopusFixtureServer } = await import('../scopus-fixture.mjs');
      fixture = createScopusFixtureServer({ port: 4318, exportsDir: opts.outputDir });
      await fixture.start();
    }
  }

  let result;
  try {
    result = await executeScopusBlock(opts);
  } finally {
    if (fixture) {
      await fixture.stop();
    }
  }

  console.log('========================================================================');
  console.log('SEARCH EXECUTION LOG:');
  console.log('========================================================================');
  console.log(result.reportText);
  console.log('========================================================================\n');

  if (!result.queryExecuted || !result.exportSuccess) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('Scopus execution failed:', err);
  process.exit(1);
});
