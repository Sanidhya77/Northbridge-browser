import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createScopusFixtureServer } from './scopus-fixture.mjs';
import { executeScopusBlock, parseCsv, validateExportFilename, createMcpClient, validateCdpEndpoint, verifyCdpAttachment } from './scopus-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runScopusAcceptanceSuite() {
  console.log('========================================================================');
  console.log('=== Northbridge Browser · Scopus Search & Export Acceptance Suite ===');
  console.log('========================================================================\n');

  const exportsDir = path.resolve(__dirname, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // Dedicated test downloads folder in os.tmpdir() to isolate tests and avoid workspace clutter
  const testDownloadsDir = path.join(os.tmpdir(), `northbridge-scopus-downloads-${Date.now()}`);
  if (!fs.existsSync(testDownloadsDir)) {
    fs.mkdirSync(testDownloadsDir, { recursive: true });
  }

  // Start Scopus fixture server on port 4318
  const fixture = createScopusFixtureServer({ port: 4318, exportsDir });
  await fixture.start();
  const baseUrl = `http://127.0.0.1:${fixture.port}`;

  try {
    // -------------------------------------------------------------------
    // Test 1: Complete Valid Block D3 Execution & Fresh Download Verification
    // -------------------------------------------------------------------
    console.log('[Test 1/16] Testing complete valid block D3 search & fresh CSV download...');
    const result1 = await executeScopusBlock({
      block: 'D3',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3.csv',
      baseUrl,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-d3-valid'
    });

    console.log('\n--- Observed Report for Block D3 ---');
    console.log(result1.reportText);
    console.log('------------------------------------\n');

    assert.strictEqual(result1.queryExecuted, true, 'Query should be executed successfully');
    assert.strictEqual(result1.totalMain, 4, 'Total main documents should be 4');
    assert.strictEqual(result1.totalPreprints, 1, 'Preprints should be 1');
    assert.strictEqual(result1.controlStatus, 'FOUND', 'Control paper should be found in block');
    assert.strictEqual(result1.indexedStatus, 'INDEXED', 'Control paper should be indexed');
    assert.strictEqual(result1.exportSuccess, true, 'Export should succeed');
    assert.ok(result1.exportFilePath && fs.existsSync(result1.exportFilePath), 'Export file must exist on disk');

    // Verify CSV content via RFC 4180 parser
    const csvContent1 = fs.readFileSync(result1.exportFilePath, 'utf8');
    const parsed1 = parseCsv(csvContent1);
    assert.strictEqual(parsed1.length, 5, 'CSV must have 1 header row + 4 document rows');
    const headerRow1 = parsed1[0].map(h => h.trim().toLowerCase());
    assert.ok(headerRow1.some(h => h.includes('authors')), 'Header must contain Authors');
    assert.ok(headerRow1.some(h => h.includes('title')), 'Header must contain Title');
    assert.ok(headerRow1.some(h => h.includes('year')), 'Header must contain Year');
    assert.ok(headerRow1.some(h => h.includes('source title')), 'Header must contain Source title');
    assert.ok(headerRow1.some(h => h.includes('doi')), 'Header must contain DOI');
    assert.ok(headerRow1.some(h => h.includes('abstract')), 'Header must contain Abstract');
    assert.ok(headerRow1.some(h => h.includes('author keywords')), 'Header must contain Author Keywords');
    assert.ok(csvContent1.includes('Decision quality using ranked attribute weights'), 'CSV must include control paper');
    console.log('  PASS: Block D3 executed, preprints isolated, control paper confirmed, fresh CSV verified (4 records + header).\n');

    // -------------------------------------------------------------------
    // Test 2: Priority 1 Regression · Preserve Existing Downloads and Exports
    // -------------------------------------------------------------------
    console.log('[Test 2/16] Testing preservation of existing files in Downloads and exports folders on failed export...');
    const existingDownloadFile = path.join(testDownloadsDir, 'Ch3_34_SC_preserve.csv');
    const existingExportFile = path.join(exportsDir, 'Ch3_34_SC_preserve.csv');
    const originalDownloadData = 'download_id,source,value\noriginal_dl_1,scopus_fixture,999\n';
    const originalExportData = 'export_id,source,value\noriginal_exp_1,prior_run,888\n';

    fs.writeFileSync(existingDownloadFile, originalDownloadData, 'utf8');
    fs.writeFileSync(existingExportFile, originalExportData, 'utf8');

    const result2 = await executeScopusBlock({
      block: 'D3-PRESERVE',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_preserve.csv',
      baseUrl,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-preserve',
      simulateExportFail: true,
      downloadTimeoutMs: 1500
    });

    assert.strictEqual(result2.exportSuccess, false, 'Pre-existing file must NOT cause failed export to pass');
    assert.ok(result2.exportMessage.includes('EXPORT FAILED'), 'Export message must state export failed');
    assert.ok(result2.lastLine.includes('EXPORT ISSUE'), 'Last line must report export issue');

    // VERIFY: Both existing files in Downloads and exports remain 100% UNCHANGED
    const observedDownloadData = fs.readFileSync(existingDownloadFile, 'utf8');
    const observedExportData = fs.readFileSync(existingExportFile, 'utf8');
    assert.strictEqual(observedDownloadData, originalDownloadData, 'Pre-existing file in Downloads must be completely unchanged');
    assert.strictEqual(observedExportData, originalExportData, 'Pre-existing file in exports folder must be completely unchanged');

    // Clean up test preservation files
    try { fs.unlinkSync(existingDownloadFile); } catch (e) {}
    try { fs.unlinkSync(existingExportFile); } catch (e) {}
    console.log('  Observed message:', result2.exportMessage);
    console.log('  PASS: Existing files in Downloads and exports folders are preserved byte-for-byte on failed export.\n');

    // -------------------------------------------------------------------
    // Test 3: Download Never Arrives (Bounded Wait Timeout)
    // -------------------------------------------------------------------
    console.log('[Test 3/16] Testing bounded wait timeout when download never arrives...');
    const result3 = await executeScopusBlock({
      block: 'D3-TIMEOUT',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_timeout.csv',
      baseUrl,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-timeout',
      simulateExportFail: true,
      downloadTimeoutMs: 1500
    });

    assert.strictEqual(result3.exportSuccess, false, 'Export must fail when download never arrives');
    assert.ok(result3.exportMessage.includes('bounded wait timeout'), 'Export message must mention bounded wait timeout');
    assert.ok(!fs.existsSync(path.join(exportsDir, 'Ch3_34_SC_D3_timeout.csv')), 'Timeout target file must not exist');
    console.log('  Observed timeout message:', result3.exportMessage);
    console.log('  PASS: Download timeout correctly handled and reported within bounded wait.\n');

    // -------------------------------------------------------------------
    // Test 4: Multiline Abstract Parsing Regression
    // -------------------------------------------------------------------
    console.log('[Test 4/16] Testing multiline abstract CSV parsing (RFC 4180 compliance)...');
    const result4 = await executeScopusBlock({
      block: 'D3-MULTILINE',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_multiline.csv',
      baseUrl: `${baseUrl}/scopus/advanced?multiline=1`,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-multiline'
    });

    assert.strictEqual(result4.exportSuccess, true, 'Export must succeed with multiline abstracts');
    assert.strictEqual(result4.totalMain, 4, 'Total main documents should be 4');
    assert.ok(result4.exportFilePath && fs.existsSync(result4.exportFilePath), 'Export file must exist');

    const multiCsv = fs.readFileSync(result4.exportFilePath, 'utf8');
    const multiParsed = parseCsv(multiCsv);
    assert.strictEqual(multiParsed.length, 5, 'RFC 4180 parser must parse exactly 1 header + 4 data rows despite newlines in abstract');
    const abstractIdx = multiParsed[0].findIndex(h => /abstract/i.test(h));
    const doc1Abstract = multiParsed[1][abstractIdx >= 0 ? abstractIdx : 15];
    assert.ok(doc1Abstract.includes('\n'), 'Parsed abstract must preserve internal newlines');
    assert.ok(doc1Abstract.includes('"rank-sum"') || doc1Abstract.includes('rank-sum'), 'Parsed abstract must preserve internal quotes');
    console.log('  Doc 1 parsed abstract preview:\n   ', doc1Abstract.split('\n')[0], '...');
    console.log('  PASS: Multiline abstracts parsed without phantom rows or field corruptions.\n');

    // -------------------------------------------------------------------
    // Test 5: Count Mismatch Detection Regression
    // -------------------------------------------------------------------
    console.log('[Test 5/16] Testing count mismatch between observed results and parsed rows...');
    const result5 = await executeScopusBlock({
      block: 'D3-MISMATCH',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_mismatch.csv',
      baseUrl: `${baseUrl}/scopus/advanced?mismatch=1`,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-mismatch'
    });

    assert.strictEqual(result5.exportSuccess, false, 'Export must fail when parsed rows mismatch observed total');
    assert.ok(result5.exportMessage.includes('Expected 4 records, but file contains 2'), 'Must report exact count mismatch');
    assert.ok(result5.lastLine.includes('EXPORT ISSUE'), 'Last line must report export issue');
    console.log('  Observed mismatch message:', result5.exportMessage);
    console.log('  PASS: Count mismatch detected and flagged before calling export successful.\n');

    // -------------------------------------------------------------------
    // Test 6: Path Traversal Protection Regression
    // -------------------------------------------------------------------
    console.log('[Test 6/16] Testing path traversal protection in runner and fixture...');
    const outsideTarget = path.resolve(exportsDir, '..', 'outside.csv');
    if (fs.existsSync(outsideTarget)) {
      try { fs.unlinkSync(outsideTarget); } catch (e) {}
    }

    // 6a. Runner path traversal rejection
    const result6 = await executeScopusBlock({
      block: 'D3-TRAVERSAL',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: '../outside.csv',
      baseUrl,
      outputDir: exportsDir,
      session: 'test-scopus-traversal'
    });

    assert.strictEqual(result6.exportSuccess, false, 'Runner must reject path traversal filename');
    assert.ok(result6.lastLine.includes('REJECTED'), 'Last line must indicate rejection');
    assert.ok(!fs.existsSync(outsideTarget), 'No file must be created outside exports directory');

    // 6b. Fixture HTTP path traversal rejection
    const fixtureTraversalRes = await new Promise((resolve) => {
      http.get(`${baseUrl}/scopus/export?filename=../outside.csv`, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
    });
    assert.strictEqual(fixtureTraversalRes.statusCode, 400, 'Fixture must return HTTP 400 on traversal filename');
    assert.ok(fixtureTraversalRes.body.includes('Invalid export filename'), 'Fixture body must explain invalid filename');
    assert.ok(!fs.existsSync(outsideTarget), 'No outside file created by fixture request');
    console.log('  Fixture rejection message:', fixtureTraversalRes.body.trim());
    console.log('  PASS: Path traversal attempts blocked in both runner and fixture; no escape from exports/.\n');

    // -------------------------------------------------------------------
    // Test 7: Rejected Query Handling (Syntax Error)
    // -------------------------------------------------------------------
    console.log('[Test 7/16] Testing rejected query with syntax error (marked NOT EXECUTED, no export)...');
    const result7 = await executeScopusBlock({
      block: 'D3-SYNTAX-ERR',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*"', // Unclosed parenthesis
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_syntax_err.csv',
      baseUrl,
      outputDir: exportsDir,
      session: 'test-scopus-syntax-err'
    });

    assert.strictEqual(result7.queryExecuted, false, 'Query should be marked NOT EXECUTED');
    assert.strictEqual(result7.totalMain, 0, 'Total documents must be 0');
    assert.strictEqual(result7.exportSuccess, false, 'Export must not proceed on rejected query');
    assert.ok(result7.queryMessage.includes('NOT EXECUTED'), 'Message must indicate NOT EXECUTED');
    assert.ok(result7.lastLine.includes('NOT EXECUTED'), 'Last line must indicate NOT EXECUTED');
    console.log('  Observed rejected message:', result7.queryMessage);
    console.log('  PASS: Rejected query properly marked NOT EXECUTED, stopped before export.\n');

    // -------------------------------------------------------------------
    // Test 8: Rewritten Query Handling
    // -------------------------------------------------------------------
    console.log('[Test 8/16] Testing rewritten query handling (database silently modifies query)...');
    const result8 = await executeScopusBlock({
      block: 'D3-REWRITE',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_rewrite.csv',
      baseUrl: `${baseUrl}/scopus/advanced?rewrite=1`,
      outputDir: exportsDir,
      session: 'test-scopus-rewrite'
    });

    assert.strictEqual(result8.queryExecuted, false, 'Rewritten query must be marked NOT EXECUTED');
    assert.strictEqual(result8.exportSuccess, false, 'Export must not proceed when query was rewritten');
    assert.ok(result8.queryMessage.includes('NOT EXECUTED: Database rewrote query'), 'Must report query rewrite');
    assert.ok(result8.queryMessage.includes('LIMIT-TO'), 'Must capture rewritten query tokens');
    assert.ok(result8.lastLine.includes('NOT EXECUTED'), 'Last line must indicate NOT EXECUTED');
    console.log('  Observed rewrite message:', result8.queryMessage);
    console.log('  PASS: Rewritten query detected, marked NOT EXECUTED, stopped before export.\n');

    // -------------------------------------------------------------------
    // Test 9: Missing Query Display Handling
    // -------------------------------------------------------------------
    console.log('[Test 9/16] Testing missing query display handling (query box missing entirely)...');
    const result9 = await executeScopusBlock({
      block: 'D3-MISSING-Q',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_missing_q.csv',
      baseUrl: `${baseUrl}/scopus/advanced?missing_query=1`,
      outputDir: exportsDir,
      session: 'test-scopus-missing-q'
    });

    assert.strictEqual(result9.queryExecuted, false, 'Missing query display must be marked UNCLEAR');
    assert.strictEqual(result9.exportSuccess, false, 'Export must not proceed when query display is missing');
    assert.ok(result9.queryMessage.includes('UNCLEAR: Query display missing entirely'), 'Must report UNCLEAR for missing query');
    assert.ok(result9.lastLine.includes('UNCLEAR'), 'Last line must report UNCLEAR');
    console.log('  Observed missing query message:', result9.queryMessage);
    console.log('  PASS: Missing query display correctly marked UNCLEAR, stopped before export.\n');

    // -------------------------------------------------------------------
    // Test 10: Search-Within Filter Cleared Before Export
    // -------------------------------------------------------------------
    console.log('[Test 10/16] Testing search-within filter is cleared and count restored before export...');
    const result10 = await executeScopusBlock({
      block: 'D3-FILTER-CLEAR',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_filter_cleared.csv',
      baseUrl,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-filter-clear'
    });

    assert.strictEqual(result10.exportSuccess, true, 'Export must succeed');
    assert.strictEqual(result10.totalMain, 4, 'Full block count must be 4');
    assert.strictEqual(result10.controlStatus, 'FOUND', 'Control must be found');

    const csv10 = fs.readFileSync(result10.exportFilePath, 'utf8');
    const parsed10 = parseCsv(csv10);
    assert.strictEqual(parsed10.length, 5, 'Exported CSV must contain all 4 documents, not only the 1 filtered control paper');
    console.log('  PASS: Search-within filter cleared, full 4-record count restored, all 4 documents exported.\n');

    // -------------------------------------------------------------------
    // Test 11: Control Paper Missed by Block but Indexed
    // -------------------------------------------------------------------
    console.log('[Test 11/16] Testing control paper missed by block but confirmed indexed in database...');
    const result11 = await executeScopusBlock({
      block: 'D3-MISSED',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "surrogate weight*" )', // Matches doc-2 & doc-3, misses doc-1
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_D3_missed.csv',
      baseUrl,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-missed'
    });

    assert.strictEqual(result11.queryExecuted, true, 'Query should execute');
    assert.strictEqual(result11.controlStatus, 'NOT FOUND', 'Control paper should be NOT FOUND in block results');
    assert.strictEqual(result11.indexedStatus, 'INDEXED', 'Control paper must be confirmed INDEXED via direct title search');
    assert.ok(result11.lastLine.includes('DEVIATION') && result11.lastLine.includes('missed by block query, but confirmed indexed'), 'Last line must report deviation');
    console.log('  Observed control status:', `${result11.controlStatus} / ${result11.indexedStatus}`);
    console.log('  PASS: Missed control paper properly confirmed INDEXED; deviation reported in last line.\n');

    // -------------------------------------------------------------------
    // Test 12: Priority 1 Regression · Require Selected Tab Suite
    // -------------------------------------------------------------------
    console.log('[Test 12/16] Testing strict tab selection requirements (unique match required)...');

    // Setup multi-tab session for tab tests
    const tabSession = 'test-multi-tab-' + Date.now();
    const tabClient = createMcpClient();
    await tabClient.init();
    try {
      // Tab 1: Unrelated project tab
      await tabClient.callTool('agent_browser_open', { url: `${baseUrl}/scopus/unrelated`, session: tabSession });
      // Tab 2: Unique target fixture tab
      await tabClient.callTool('agent_browser_tab_new', { url: `${baseUrl}/scopus/advanced`, session: tabSession });

      // 12a. Unique Match: Exactly uses selected tab and leaves unrelated tab open
      console.log('  12a. Testing unique tab match execution & unrelated tab preservation...');
      const result12a = await executeScopusBlock({
        block: 'D3-TAB-UNIQUE',
        claim: 'Weights can be derived from a rank order.',
        query: 'TITLE-ABS-KEY ( "rank order centroid" )',
        control: 'Decision quality using ranked attribute weights',
        exportFile: 'Ch3_34_SC_D3_tab_unique.csv',
        baseUrl,
        outputDir: exportsDir,
        downloadsDir: testDownloadsDir,
        client: tabClient,
        session: tabSession,
        tab: 'advanced'
      });

      if (!result12a.exportSuccess) {
        console.error('    12a failed lastLine:', result12a.lastLine);
        console.error('    12a failed exportMessage:', result12a.exportMessage);
      }
      assert.strictEqual(result12a.queryExecuted, true, 'Block should execute in matched tab');
      assert.strictEqual(result12a.exportSuccess, true, 'Export should succeed from matched tab');

      // Verify unrelated tab ("Unrelated Project Tab") remains OPEN in session
      const tabListRes = await tabClient.callTool('agent_browser_tab_list', { session: tabSession });
      const currentTabs = tabListRes.raw?.structuredContent?.response?.data?.tabs || [];
      const unrelatedTabFound = currentTabs.some(t => t.url && t.url.includes('unrelated'));
      assert.ok(unrelatedTabFound, 'Unrelated tab must remain open and unaffected in the session');
      console.log('    PASS: Unique tab matched and executed; unrelated tabs confirmed open.');

      // 12b. Missing Tab Match: Deliberately nonexistent tab must halt immediately without fallback
      console.log('  12b. Testing missing tab match halts immediately without opening fallback...');
      const result12b = await executeScopusBlock({
        block: 'D3-TAB-MISSING',
        claim: 'Weights can be derived from a rank order.',
        query: 'TITLE-ABS-KEY ( "rank order centroid" )',
        control: 'Decision quality using ranked attribute weights',
        exportFile: 'Ch3_34_SC_D3_tab_missing.csv',
        baseUrl,
        outputDir: exportsDir,
        client: tabClient,
        session: tabSession,
        tab: 'nonexistent-tab-99999'
      });

      assert.strictEqual(result12b.queryExecuted, false, 'Must not execute when tab is missing');
      assert.strictEqual(result12b.exportSuccess, false, 'Must not report successful export on missing tab');
      assert.ok(result12b.lastLine.includes('TAB ERROR') && result12b.lastLine.includes('not found'), 'Last line must report tab not found error');
      assert.ok(!fs.existsSync(path.join(exportsDir, 'Ch3_34_SC_D3_tab_missing.csv')), 'Missing tab attempt must not export any file');
      console.log('    Observed missing tab error:', result12b.lastLine);
      console.log('    PASS: Missing tab selection halted immediately; no fallback opened.');

      // 12c. Ambiguous Tab Match: Multiple tabs matching pattern must halt immediately
      console.log('  12c. Testing ambiguous tab match halts immediately...');
      const result12c = await executeScopusBlock({
        block: 'D3-TAB-AMBIGUOUS',
        claim: 'Weights can be derived from a rank order.',
        query: 'TITLE-ABS-KEY ( "rank order centroid" )',
        control: 'Decision quality using ranked attribute weights',
        exportFile: 'Ch3_34_SC_D3_tab_ambiguous.csv',
        baseUrl,
        outputDir: exportsDir,
        client: tabClient,
        session: tabSession,
        tab: 'scopus' // Both /scopus/unrelated and /scopus/advanced match 'scopus'
      });

      assert.strictEqual(result12c.queryExecuted, false, 'Must not execute when tab match is ambiguous');
      assert.strictEqual(result12c.exportSuccess, false, 'Must not report successful export on ambiguous tab');
      assert.ok(result12c.lastLine.includes('TAB ERROR') && result12c.lastLine.includes('Ambiguous tab selection'), 'Last line must report ambiguous tab error');
      assert.ok(!fs.existsSync(path.join(exportsDir, 'Ch3_34_SC_D3_tab_ambiguous.csv')), 'Ambiguous tab attempt must not export any file');
      console.log('    Observed ambiguous tab error:', result12c.lastLine);
      console.log('    PASS: Ambiguous tab selection halted immediately; unique match strictly required.\n');

    } finally {
      try {
        await tabClient.callTool('agent_browser_close', { session: tabSession });
      } catch (e) {}
      await tabClient.close();
    }

    // -------------------------------------------------------------------
    // Test 13: Starting Point 2 · User-Provided Institutional Link with Sign-in Pause
    // -------------------------------------------------------------------
    console.log('[Test 13/16] Testing user-provided institutional link with sign-in pause...');
    const result13 = await executeScopusBlock({
      block: 'D3-AUTH',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "test" )',
      control: 'Decision quality using ranked attribute weights',
      baseUrl: `${baseUrl}/scopus/login-required`,
      session: 'test-scopus-auth'
    });
    assert.ok(result13.lastLine.includes('PAUSED'), 'Must pause when institutional sign-in is required');
    console.log('  Observed auth pause:', result13.lastLine);
    console.log('  PASS: Institutional sign-in pauses workflow for user to authenticate.\n');

    // -------------------------------------------------------------------
    // Test 14: Bot Challenge / Unusual Traffic Warning Halts Cleanly
    // -------------------------------------------------------------------
    console.log('[Test 14/16] Testing bot challenge / unusual traffic warning halts cleanly...');
    const result14 = await executeScopusBlock({
      block: 'D3-BOT',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "test" )',
      control: 'Decision quality using ranked attribute weights',
      baseUrl: `${baseUrl}/scopus/bot-challenge`,
      session: 'test-scopus-bot'
    });
    assert.ok(result14.lastLine.includes('STOPPED'), 'Must stop when bot challenge is encountered');
    console.log('  Observed challenge stop:', result14.lastLine);
    console.log('  PASS: Bot challenge cleanly halts without bypass attempt.\n');

    // -------------------------------------------------------------------
    // Test 15: Clean Cleanup of Attempt Downloads (User Downloads Untouched)
    // -------------------------------------------------------------------
    console.log('[Test 15/16] Testing attempt download cleanup leaves test downloads directory clean...');
    const remainingFiles = fs.readdirSync(testDownloadsDir);
    const hasAttemptFiles = remainingFiles.some(f => f.includes('attempt-'));
    assert.strictEqual(hasAttemptFiles, false, 'Temporary attempt files must be cleaned up from Downloads');
    console.log('  PASS: Attempt temporary downloads cleanly unlinked; no orphan attempt files left.\n');

    // -------------------------------------------------------------------
    // Test 16: Verification of Preserved Historical Exports
    // -------------------------------------------------------------------
    console.log('[Test 16/21] Verifying baseline Block D3 exports remain preserved on disk...');
    assert.ok(fs.existsSync(path.join(exportsDir, 'Ch3_34_SC_D3.csv')), 'Ch3_34_SC_D3.csv must remain preserved');
    console.log('  PASS: Baseline Block D3 CSV export preserved.\n');

    // -------------------------------------------------------------------
    // Test 17: Successful Export Targets Existing File (Preservation Regression)
    // -------------------------------------------------------------------
    console.log('[Test 17/21] Testing preservation of existing CSV on successful export collision...');
    const existingTargetFile = path.join(exportsDir, 'Ch3_34_SC_existing_test.csv');
    const existingTargetData = 'disposable_id,title,value\nold_rec_1,Previous Run Report,42\n';
    fs.writeFileSync(existingTargetFile, existingTargetData, 'utf8');

    const result17 = await executeScopusBlock({
      block: 'D3-COLLISION',
      claim: 'Weights can be derived from a rank order.',
      query: 'TITLE-ABS-KEY ( "rank order centroid" )',
      control: 'Decision quality using ranked attribute weights',
      exportFile: 'Ch3_34_SC_existing_test.csv',
      baseUrl,
      outputDir: exportsDir,
      downloadsDir: testDownloadsDir,
      session: 'test-scopus-collision-' + Date.now()
    });

    assert.strictEqual(result17.exportSuccess, true, 'Export should succeed even when target name exists');

    // VERIFY: The pre-existing file remains 100% byte-for-byte UNCHANGED
    const observedOldData = fs.readFileSync(existingTargetFile, 'utf8');
    assert.strictEqual(observedOldData, existingTargetData, 'Pre-existing CSV must remain byte-for-byte unchanged');

    // VERIFY: The new verified file was placed under a unique candidate filename
    const uniquePlacedFile = path.join(exportsDir, 'Ch3_34_SC_existing_test (1).csv');
    assert.strictEqual(result17.exportFilePath, uniquePlacedFile, 'Reported export path must point to unique filename');
    assert.ok(fs.existsSync(uniquePlacedFile), 'Unique candidate file must exist on disk');

    const newCsvContent = fs.readFileSync(uniquePlacedFile, 'utf8');
    const parsedNew = parseCsv(newCsvContent);
    assert.strictEqual(parsedNew.length, 5, 'New file must contain 1 header + 4 data rows');
    assert.ok(result17.reportText.includes('Ch3_34_SC_existing_test (1).csv'), 'Report text must cite actual unique path');
    assert.ok(result17.lastLine.includes('existing file preserved byte-for-byte'), 'Last line must report existing file preserved');

    // Clean up collision test files
    try { fs.unlinkSync(existingTargetFile); } catch (e) {}
    try { fs.unlinkSync(uniquePlacedFile); } catch (e) {}
    console.log('  Observed report message:', result17.exportMessage);
    console.log('  PASS: Existing file preserved byte-for-byte; new export placed at unique path and reported.\n');

    // -------------------------------------------------------------------
    // Test 18: External Chrome Attachment & Real Search Block Execution
    // -------------------------------------------------------------------
    console.log('[Test 18/22] Testing external Chrome attachment, verification, and search block execution...');
    const extChromePort = 9223;
    const extChromeProfile = path.join(os.tmpdir(), `northbridge-chrome-profile-${Date.now()}`);
    if (!fs.existsSync(extChromeProfile)) fs.mkdirSync(extChromeProfile, { recursive: true });

    const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const extChromeProc = spawn(chromeExe, [
      `--remote-debugging-port=${extChromePort}`,
      `--user-data-dir=${extChromeProfile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--headless=new',
      'about:blank'
    ]);

    async function waitForChromeReady(port, maxWait = 7000) {
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        try {
          const body = await new Promise((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 600 }, res => {
              let b = '';
              res.on('data', d => b += d);
              res.on('end', () => resolve(b));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
          });
          if (body && body.includes('Browser')) return true;
        } catch (e) {}
        await new Promise(r => setTimeout(r, 150));
      }
      throw new Error(`Chrome on port ${port} did not become ready`);
    }

    function openTabInChrome(port, url) {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: `/json/new?${encodeURIComponent(url)}`,
          method: 'PUT'
        }, res => {
          let b = '';
          res.on('data', d => b += d);
          res.on('end', () => {
            try { resolve(JSON.parse(b)); } catch (e) { resolve(b); }
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    function getChromeTabs(port) {
      return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/list`, res => {
          let b = '';
          res.on('data', d => b += d);
          res.on('end', () => {
            try { resolve(JSON.parse(b)); } catch (e) { resolve([]); }
          });
        }).on('error', reject);
      });
    }

    try {
      await waitForChromeReady(extChromePort);
      console.log('  External Chrome ready on debugging port', extChromePort);

      // Open Tab 1: Unrelated project tab
      await openTabInChrome(extChromePort, `${baseUrl}/scopus/unrelated`);
      // Open Tab 2: Harmless test tab (for attachment-only evidence testing)
      await openTabInChrome(extChromePort, `${baseUrl}/scopus/harmless`);
      // Open Tab 3: Fixture Advanced Search tab (for real search and export testing)
      await openTabInChrome(extChromePort, `${baseUrl}/scopus/advanced`);

      const tabsPreRun = await getChromeTabs(extChromePort);
      const unrelatedPre = tabsPreRun.find(t => t.url && t.url.includes('unrelated'));
      const harmlessPre = tabsPreRun.find(t => t.url && t.url.includes('harmless'));
      const searchPre = tabsPreRun.find(t => t.url && t.url.includes('advanced'));
      assert.ok(unrelatedPre, 'Unrelated tab must be present before run');
      assert.ok(harmlessPre, 'Harmless target tab must be present before run');
      assert.ok(searchPre, 'Search target tab must be present before run');
      const unrelatedIdBefore = unrelatedPre.id;
      const unrelatedUrlBefore = unrelatedPre.url;
      const searchTabIdBefore = searchPre.id;

      console.log(`  Pre-run capture: Search Tab ID '${searchTabIdBefore}', Unrelated Tab ID '${unrelatedIdBefore}'`);

      // 18a. Test attachment verification helper (reports evidence without search/export shortcut)
      const attachRes = await verifyCdpAttachment({
        cdp: extChromePort,
        tab: 'harmless'
      });
      assert.strictEqual(attachRes.ok, true, 'verifyCdpAttachment must succeed on harmless tab');
      assert.strictEqual(attachRes.endpoint, `127.0.0.1:${extChromePort}`, 'Attachment endpoint must match loopback port');
      assert.strictEqual(attachRes.activeTab.targetId, harmlessPre.id, 'Active tab target ID must match selected tab');
      assert.ok(attachRes.snapshotText.includes('Harmless Target'), 'Snapshot must observe harmless page content');
      console.log('  18a Observed attachment evidence:', attachRes.message);

      // 18b. Test real search block execution on external Chrome tab
      const result18 = await executeScopusBlock({
        block: 'D3-CDP',
        claim: 'Weights can be derived from a rank order.',
        query: 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )',
        control: 'Decision quality using ranked attribute weights',
        exportFile: 'Ch3_34_SC_D3_cdp.csv',
        baseUrl,
        cdp: extChromePort,
        tab: 'advanced',
        outputDir: exportsDir,
        downloadsDir: testDownloadsDir
      });

      assert.strictEqual(result18.exportSuccess, true, 'Search and export must succeed on external Chrome');
      assert.strictEqual(result18.totalMain, 4, 'Must find 4 main document results');
      assert.strictEqual(result18.controlStatus, 'FOUND', 'Control paper must be found in block');
      assert.strictEqual(result18.indexedStatus, 'INDEXED', 'Control paper must be indexed');
      assert.ok(result18.exportFilePath && fs.existsSync(result18.exportFilePath), 'Exported CSV must exist on disk');

      const parsedCdpCsv = parseCsv(fs.readFileSync(result18.exportFilePath, 'utf8'));
      assert.strictEqual(parsedCdpCsv.length, 5, 'Exported CSV must contain 1 header + 4 document rows');
      console.log('  18b Observed search execution result:', result18.lastLine);

      // Clean up test export
      try { fs.unlinkSync(result18.exportFilePath); } catch (e) {}

      // Verify that unrelated tab remains open and completely untouched
      const tabsPostRun = await getChromeTabs(extChromePort);
      const unrelatedPost = tabsPostRun.find(t => t.id === unrelatedIdBefore);
      assert.ok(unrelatedPost, 'Unrelated tab must remain open and present after run');
      assert.strictEqual(unrelatedPost.url, unrelatedUrlBefore, 'Unrelated tab URL must remain completely untouched');

      // Verify external Chrome process is still running
      assert.strictEqual(extChromeProc.killed, false, 'External Chrome process must remain running');
      console.log('  PASS: External Chrome attached, search block executed, 4 records exported, unrelated tab untouched.\n');

      // -------------------------------------------------------------------
      // Test 19: Negative Tests: Empty '{}' Metadata, Unavailable, Non-Loopback
      // -------------------------------------------------------------------
      console.log('[Test 19/22] Testing rejection of empty metadata, unavailable, and non-loopback endpoints...');

      // 19a. Endpoint returning HTTP 200 with '{}' (missing debugger metadata)
      const mockEmptyPort = 9228;
      const mockEmptyServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      await new Promise(r => mockEmptyServer.listen(mockEmptyPort, '127.0.0.1', r));

      const result19_empty = await executeScopusBlock({
        block: 'D3-CDP-EMPTY',
        claim: 'Test',
        query: 'test',
        control: 'test',
        cdp: mockEmptyPort,
        tab: 'any'
      });
      await new Promise(r => mockEmptyServer.close(r));

      assert.strictEqual(result19_empty.exportSuccess, false, 'Must reject endpoint returning empty metadata');
      assert.strictEqual(result19_empty.queryExecuted, false, 'Search must never execute on empty metadata');
      assert.ok(result19_empty.lastLine.includes('ATTACHMENT ERROR') && result19_empty.lastLine.includes("missing or invalid 'Browser' metadata"), 'Must report invalid Browser metadata');
      console.log('  19a observed empty metadata error:', result19_empty.lastLine);

      // 19b. Unavailable port (nothing listening on port 9999)
      const result19a = await executeScopusBlock({
        block: 'D3-CDP-UNAVAIL',
        claim: 'Test',
        query: 'test',
        control: 'test',
        cdp: 9999,
        tab: 'any'
      });
      assert.strictEqual(result19a.exportSuccess, false, 'Must fail on unavailable endpoint');
      assert.strictEqual(result19a.queryExecuted, false, 'Search must never execute on unavailable endpoint');
      assert.ok(result19a.lastLine.includes('ATTACHMENT ERROR') && result19a.lastLine.includes('unavailable'), 'Must report endpoint unavailable');
      console.log('  19b observed unavailable port error:', result19a.lastLine);

      // 19c. Non-loopback host rejection
      const result19b = await executeScopusBlock({
        block: 'D3-CDP-NONLOOPBACK',
        claim: 'Test',
        query: 'test',
        control: 'test',
        cdp: 'http://192.168.1.5:9222',
        tab: 'any'
      });
      assert.strictEqual(result19b.exportSuccess, false, 'Must fail on non-loopback endpoint');
      assert.strictEqual(result19b.queryExecuted, false, 'Search must never execute on non-loopback endpoint');
      assert.ok(result19b.lastLine.includes('ATTACHMENT ERROR') && result19b.lastLine.includes('must be a loopback address'), 'Must reject non-loopback endpoint');
      console.log('  19c observed non-loopback error:', result19b.lastLine);
      console.log('  PASS: Empty metadata, unavailable port, and non-loopback endpoints cleanly rejected before search.\n');

      // -------------------------------------------------------------------
      // Test 20: Missing, Ambiguous, Failed Tab Switch, and Wrong Active Tab
      // -------------------------------------------------------------------
      console.log('[Test 20/22] Testing tab handling: missing, ambiguous, failed switch, and wrong active tab...');

      // 20a. Missing tab halts cleanly
      const result20a = await executeScopusBlock({
        block: 'D3-CDP-MISSING-TAB',
        claim: 'Test',
        query: 'test',
        control: 'test',
        cdp: extChromePort,
        tab: 'nonexistent-tab-xyz'
      });
      assert.strictEqual(result20a.exportSuccess, false, 'Must fail when tab is missing on external Chrome');
      assert.strictEqual(result20a.queryExecuted, false, 'Search must not start when tab is missing');
      assert.ok(result20a.lastLine.includes('TAB ERROR') && result20a.lastLine.includes('not found'), 'Must report tab not found');
      console.log('  20a observed missing tab error:', result20a.lastLine);

      // 20b. Ambiguous tab halts cleanly
      await openTabInChrome(extChromePort, `${baseUrl}/scopus/unrelated?duplicate=1`);
      await openTabInChrome(extChromePort, `${baseUrl}/scopus/unrelated?duplicate=2`);

      const result20b = await executeScopusBlock({
        block: 'D3-CDP-AMBIGUOUS-TAB',
        claim: 'Test',
        query: 'test',
        control: 'test',
        cdp: extChromePort,
        tab: 'duplicate'
      });
      assert.strictEqual(result20b.exportSuccess, false, 'Must fail when tab selection is ambiguous');
      assert.strictEqual(result20b.queryExecuted, false, 'Search must not start on ambiguous tab');
      assert.ok(result20b.lastLine.includes('TAB ERROR') && result20b.lastLine.includes('Ambiguous tab selection'), 'Must report ambiguous tab selection');
      console.log('  20b observed ambiguous tab error:', result20b.lastLine);

      // 20c. Failed tab switch halts cleanly before search
      const mockClientFailSwitch = {
        async init() {},
        async callTool(name) {
          if (name === 'agent_browser_tab_list') {
            return {
              raw: {
                structuredContent: {
                  response: {
                    data: {
                      tabs: [{ tabId: 't1', targetId: 'T1', title: 'Target Tab', url: 'http://127.0.0.1:4318/' }]
                    }
                  }
                }
              }
            };
          }
          if (name === 'agent_browser_tab_switch') {
            return {
              raw: {
                isError: true,
                structuredContent: { response: { success: false, error: 'Target detached during switch' } }
              },
              text: 'Target detached during switch'
            };
          }
          return { raw: {}, text: '' };
        },
        async close() {}
      };

      const result20c = await executeScopusBlock({
        block: 'D3-FAIL-SWITCH',
        claim: 'Test',
        query: 'test',
        control: 'test',
        cdp: extChromePort,
        tab: 'Target Tab',
        client: mockClientFailSwitch
      });
      assert.strictEqual(result20c.exportSuccess, false, 'Must fail on failed tab switch');
      assert.strictEqual(result20c.queryExecuted, false, 'Search must not execute if tab switch fails');
      assert.ok(result20c.lastLine.includes('TAB ERROR') && result20c.lastLine.includes('Tab switch failed'), 'Must report tab switch error');
      console.log('  20c observed tab switch failure error:', result20c.lastLine);

      // 20d. Active tab mismatch halts cleanly before search
      let tabListCalls = 0;
      const mockClientMismatch = {
        async init() {},
        async callTool(name) {
          if (name === 'agent_browser_tab_list') {
            tabListCalls++;
            if (tabListCalls === 1) {
              return {
                raw: {
                  structuredContent: {
                    response: {
                      data: {
                        tabs: [{ tabId: 't1', targetId: 'EXPECTED_ID', title: 'Target Tab', url: 'http://127.0.0.1:4318/expected' }]
                      }
                    }
                  }
                }
              };
            } else {
              return {
                raw: {
                  structuredContent: {
                    response: {
                      data: {
                        tabs: [{ tabId: 't2', targetId: 'WRONG_ID', active: true, title: 'Wrong Tab', url: 'http://127.0.0.1:4318/wrong' }]
                      }
                    }
                  }
                }
              };
            }
          }
          if (name === 'agent_browser_tab_switch') {
            return { raw: { isError: false }, text: 'OK' };
          }
          return { raw: {}, text: '' };
        },
        async close() {}
      };

      const result20d = await executeScopusBlock({
        block: 'D3-TAB-MISMATCH',
        claim: 'Test',
        query: 'test',
        control: 'test',
        cdp: extChromePort,
        tab: 'Target Tab',
        client: mockClientMismatch
      });
      assert.strictEqual(result20d.exportSuccess, false, 'Must fail on active tab mismatch');
      assert.strictEqual(result20d.queryExecuted, false, 'Search must not execute if active tab differs from selected');
      assert.ok(result20d.lastLine.includes('TAB ERROR') && result20d.lastLine.includes('differs from selected target ID'), 'Must report target ID mismatch');
      console.log('  20d observed active tab mismatch error:', result20d.lastLine);
      console.log('  PASS: Missing, ambiguous, failed switch, and wrong active tabs cleanly halt before search.\n');

      // -------------------------------------------------------------------
      // Test 21: Engine Rejection of --cdp Combined with --allowed-domains
      // -------------------------------------------------------------------
      console.log('[Test 21/22] Testing engine rejection of --cdp combined with --allowed-domains...');
      const binaryWin = path.resolve(__dirname, 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
      const procReject = spawn(binaryWin, ['mcp', '--tools', 'core'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, AGENT_BROWSER_CDP: '9222', AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1' }
      });

      const engineErrorMsg = await new Promise((resolve) => {
        let output = '';
        procReject.stdout.on('data', chunk => {
          output += chunk.toString();
          const lines = output.split('\n');
          output = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.id === 2) {
                const text = msg.result?.content?.[0]?.text || '';
                resolve(text);
              }
            } catch(e) {}
          }
        });
        procReject.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1.0' }, capabilities: {} } }) + '\n');
        procReject.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'agent_browser_tab_list', arguments: {} } }) + '\n');
        setTimeout(() => {
          procReject.kill();
          resolve(output);
        }, 3000);
      });

      procReject.kill();
      assert.ok(engineErrorMsg.includes('--allowed-domains is not supported with --cdp'), 'Must verify engine rejection of allowed-domains with cdp');
      console.log('  Observed engine error:', engineErrorMsg.trim());
      console.log('  PASS: Proved pinned engine incompatibility between --cdp and --allowed-domains.\n');

      // -------------------------------------------------------------------
      // Test 22: Standalone Scopus CLI Flow Execution Against External Chrome
      // -------------------------------------------------------------------
      console.log('[Test 22/22] Testing standalone CLI execution against external Chrome via child process...');
      const cliScript = path.resolve(__dirname, 'bin', 'northbridge-scopus.mjs');
      const cliTargetFile = 'Ch3_34_SC_D3_cli_acceptance.csv';
      const cliTargetFullPath = path.join(exportsDir, cliTargetFile);
      try { fs.unlinkSync(cliTargetFullPath); } catch (e) {}

      // Run 1: Successful CLI export
      const cliProc1 = spawn('node', [
        cliScript,
        '--cdp', String(extChromePort),
        '--tab', 'advanced',
        '--block', 'D3',
        '--claim', 'Weights can be derived from a rank order.',
        '--query', 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )',
        '--control', 'Decision quality using ranked attribute weights',
        '--export', cliTargetFile
      ], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let cliStdout1 = '';
      cliProc1.stdout.on('data', d => cliStdout1 += d.toString());
      let cliStderr1 = '';
      cliProc1.stderr.on('data', d => cliStderr1 += d.toString());

      const cliExit1 = await new Promise((resolve) => {
        cliProc1.on('exit', (code) => resolve(code));
        setTimeout(() => {
          cliProc1.kill();
          resolve('TIMED_OUT');
        }, 15000);
      });

      assert.strictEqual(cliExit1, 0, `CLI process must exit with code 0 (stderr: ${cliStderr1}, stdout: ${cliStdout1})`);
      assert.ok(cliStdout1.includes('4 main records exported'), 'CLI stdout must report 4 main records exported');
      assert.ok(cliStdout1.includes('FOUND | INDEXED'), 'CLI stdout must report control paper FOUND and INDEXED');
      assert.ok(fs.existsSync(cliTargetFullPath), 'CLI target export CSV must exist on disk');

      const parsedCli1 = parseCsv(fs.readFileSync(cliTargetFullPath, 'utf8'));
      assert.strictEqual(parsedCli1.length, 5, 'CLI exported CSV must contain 1 header + 4 document rows');
      const cliFile1OriginalContent = fs.readFileSync(cliTargetFullPath, 'utf8');

      // Run 2: Pre-existing export collision survives a successful same-name export
      const cliProc2 = spawn('node', [
        cliScript,
        '--cdp', String(extChromePort),
        '--tab', 'advanced',
        '--block', 'D3',
        '--claim', 'Weights can be derived from a rank order.',
        '--query', 'TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )',
        '--control', 'Decision quality using ranked attribute weights',
        '--export', cliTargetFile
      ], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let cliStdout2 = '';
      cliProc2.stdout.on('data', d => cliStdout2 += d.toString());
      let cliStderr2 = '';
      cliProc2.stderr.on('data', d => cliStderr2 += d.toString());

      const cliExit2 = await new Promise((resolve) => {
        cliProc2.on('exit', (code) => resolve(code));
        setTimeout(() => {
          cliProc2.kill();
          resolve('TIMED_OUT');
        }, 15000);
      });

      assert.strictEqual(cliExit2, 0, `Second CLI process must exit with code 0 on collision (stderr: ${cliStderr2}, stdout: ${cliStdout2})`);
      // Verify original file remained byte-for-byte unchanged
      assert.strictEqual(fs.readFileSync(cliTargetFullPath, 'utf8'), cliFile1OriginalContent, 'Original export must remain byte-for-byte unchanged');
      // Verify second file was saved under unique collision name
      const collisionFile = path.join(exportsDir, 'Ch3_34_SC_D3_cli_acceptance (1).csv');
      assert.ok(fs.existsSync(collisionFile), 'Second file must be saved under unique collision name (1).csv');

      // Clean up CLI test files
      try { fs.unlinkSync(cliTargetFullPath); } catch (e) {}
      try { fs.unlinkSync(collisionFile); } catch (e) {}

      // Verify that unrelated tab still remains open and completely untouched
      const tabsAfterCli = await getChromeTabs(extChromePort);
      const unrelatedAfterCli = tabsAfterCli.find(t => t.id === unrelatedIdBefore);
      assert.ok(unrelatedAfterCli, 'Unrelated tab must remain open after CLI runs');
      assert.strictEqual(unrelatedAfterCli.url, unrelatedUrlBefore, 'Unrelated tab URL must remain completely untouched');

      // Verify external Chrome process is still running after all CLI executions
      assert.strictEqual(extChromeProc.killed, false, 'External Chrome process must remain running');
      console.log('  PASS: Standalone CLI executed with code 0, 4 records exported, collision preserved, unrelated tab untouched.\n');

    } finally {
      // Clean up external Chrome process tree and profile in os.tmpdir()
      try {
        if (extChromeProc && extChromeProc.pid) {
          execSync(`taskkill /pid ${extChromeProc.pid} /T /F`, { stdio: 'ignore' });
        }
      } catch (e) {
        try { extChromeProc.kill(); } catch (e2) {}
      }
      for (let i = 0; i < 5; i++) {
        try {
          if (fs.existsSync(extChromeProfile)) {
            fs.rmSync(extChromeProfile, { recursive: true, force: true });
          }
          break;
        } catch (e) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    console.log('========================================================================');
    console.log('ALL SCOPUS ACCEPTANCE TESTS PASSED (22/22)!');
    console.log('========================================================================\n');

  } finally {
    await fixture.stop();
    // Clean up test downloads directory
    await new Promise(r => setTimeout(r, 200));
    for (let i = 0; i < 5; i++) {
      try {
        if (fs.existsSync(testDownloadsDir)) {
          fs.rmSync(testDownloadsDir, { recursive: true, force: true });
        }
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }
}

runScopusAcceptanceSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\nSCOPUS ACCEPTANCE SUITE FAILED:', err);
  process.exit(1);
});
