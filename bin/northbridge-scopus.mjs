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
import { executeScopusBlock } from '../scopus-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    block: 'D3',
    claim: 'Weights can be derived from a rank order.',
    query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )',
    control: 'Decision quality using ranked attribute weights',
    exportFile: 'Ch3_34_SC_D3.csv',
    baseUrl: process.env.SCOPUS_BASE_URL || 'http://127.0.0.1:4318',
    outputDir: path.resolve(__dirname, '..', 'exports'),
    session: 'scopus-cli-' + Math.random().toString(36).slice(2, 8),
    tab: null,
    cdp: null,
    verifyAttachment: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--block' && args[i + 1]) opts.block = args[++i];
    else if (arg === '--claim' && args[i + 1]) opts.claim = args[++i];
    else if (arg === '--query' && args[i + 1]) opts.query = args[++i];
    else if (arg === '--control' && args[i + 1]) opts.control = args[++i];
    else if (arg === '--export' && args[i + 1]) opts.exportFile = args[++i];
    else if (arg === '--url' && args[i + 1]) opts.baseUrl = args[++i];
    else if (arg === '--tab' && args[i + 1]) opts.tab = args[++i];
    else if ((arg === '--cdp' || arg === '--attach-chrome') && args[i + 1]) opts.cdp = args[++i];
    else if (arg === '--verify-attachment') opts.verifyAttachment = true;
    else if (arg === '--output' && args[i + 1]) opts.outputDir = path.resolve(args[++i]);
    else if (arg === '--session' && args[i + 1]) opts.session = args[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`Northbridge Scopus Search & Export Tool

Usage:
  npx northbridge-scopus [options]
  node bin/northbridge-scopus.mjs [options]

Options:
  --block <id>          Search block identifier (default: D3)
  --claim <text>        Thesis claim being supported/evaluated
  --query <string>      Exact Scopus query string (enclosed in quotes)
  --control <title>     Known control paper title
  --export <filename>   Target CSV export file (default: Ch3_34_SC_<block>.csv)
  --tab <pattern>       Select already-open browser tab matching pattern (e.g. "Scopus")
  --cdp <port|url>      Attach to external Chrome via loopback remote debugging (e.g. 9222 or 127.0.0.1:9222)
  --attach-chrome <p|u> Alias for --cdp
  --verify-attachment   Verify CDP attachment and target tab without executing search/export
  --url <url>           Scopus or library link (default: http://127.0.0.1:4318)
  --output <dir>        Directory to store verified exports (default: ./exports)
  --session <name>      Browser session identifier
`);
      process.exit(0);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  if (opts.verifyAttachment) {
    console.log(`Verifying Chrome Attachment to ${opts.cdp || 9222}...`);
    const { verifyCdpAttachment } = await import('../scopus-workflow.mjs');
    const attachRes = await verifyCdpAttachment({
      cdp: opts.cdp || 9222,
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

  console.log(`Running Scopus Search Block [${opts.block}]...`);
  if (opts.cdp) {
    console.log(`Attachment: External Chrome instance at ${opts.cdp}`);
    if (!opts.tab) {
      console.error('ATTACHMENT ERROR: A target tab pattern (--tab <pattern>) is required when attaching to external Chrome via --cdp / --attach-chrome.');
      process.exit(1);
    }
  }
  if (opts.tab) console.log(`Starting Point: Existing tab matching "${opts.tab}"`);
  else console.log(`Starting Point: URL ${opts.baseUrl}`);
  console.log(`Query: ${opts.query}`);
  console.log(`Control: ${opts.control}`);
  console.log(`Export File: ${opts.exportFile}\n`);

  let fixture = null;
  if (!opts.cdp && !opts.tab && (opts.baseUrl.includes('127.0.0.1:4318') || opts.baseUrl.includes('localhost:4318'))) {
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
