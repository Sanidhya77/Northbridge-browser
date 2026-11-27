import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  createControlManager,
  detectAuthCaptchaOrGoogleBlock,
  validateControlledNavigationUrl,
  getDefaultResearchProfileDir
} from './chrome-control.mjs';
import { getDefaultSharedChromeProfileDirs } from './scopus-workflow.mjs';

function stopProcessTree(proc) {
  if (!proc || !proc.pid || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
    if (proc.exitCode === null) proc.kill();
  } catch {}
}

class StdioMcpClient {
  constructor(scriptPath, extraEnv = {}) {
    this.scriptPath = path.resolve(scriptPath);
    this.extraEnv = extraEnv;
    this.proc = null;
    this.msgId = 0;
    this.pending = new Map();
    this.buffer = '';
  }

  async init() {
    this.proc = spawn(process.execPath, [this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.extraEnv }
    });
    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            resolve(msg);
          }
        } catch {}
      }
    });
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-chrome-control', version: '1.0.0' },
      capabilities: {}
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  }

  send(method, params = {}, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: val => { clearTimeout(timer); resolve(val); },
        reject: err => { clearTimeout(timer); reject(err); }
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async close() {
    if (this.proc) {
      try { this.proc.stdin.end(); } catch {}
      stopProcessTree(this.proc);
      this.proc = null;
    }
  }
}

async function runTests() {
  console.log('========================================================================');
  console.log('=== Northbridge Opt-In Chrome Control & Handback Test Suite ===');
  console.log('========================================================================\n');

  // -----------------------------------------------------------------------
  // Test 1: Dedicated Research Profile Enforcement & Default Profile Reject
  // -----------------------------------------------------------------------
  console.log('[Test 1/6] Verifying dedicated profile guard and default profile rejection...');
  const defaultResearchDir = getDefaultResearchProfileDir();
  assert.ok(!defaultResearchDir.includes(path.join('Google', 'Chrome', 'User Data')), 'Default research profile must stay separate from shared User Data');
  const sharedDir = getDefaultSharedChromeProfileDirs()[0];
  const badMgr = createControlManager({ profileDir: sharedDir, headless: true });
  const badStart = await badMgr.start();
  assert.strictEqual(badStart.ok, false);
  assert.strictEqual(badStart.status, 'DEDICATED_PROFILE_REQUIRED');
  console.log('  PASS: Shared Chrome default User Data rejected cleanly.\n');

  // -----------------------------------------------------------------------
  // Test 2: Self-Approval Defense, Host Grant Gate, Pause, Resume, Revoke
  // -----------------------------------------------------------------------
  console.log('[Test 2/6] Verifying model approved:true alone fails and real Control Console grant governs pause/resume/revoke...');
  const hudHistory = [];
  const fakeTabs = [
    { targetId: 'TAB_1', title: 'Research Home', url: 'https://research.example.org/' },
    { targetId: 'TAB_2', title: 'Secondary Paper Tab', url: 'https://arxiv.org/abs/2510.10666' }
  ];
  let currentFakeTab = 'TAB_1';

  const mockMgr = createControlManager({
    profileDir: path.join(os.tmpdir(), 'nb-ctrl-unit-' + Date.now()),
    headless: false,
    allowLoopbackForTests: true,
    tabLister: async () => fakeTabs,
    hudUpdater: async (tid, st) => { hudHistory.push({ tid, st }); },
    clientFactory: async () => ({
      async init() {},
      async close() {},
      async callTool(name, args) {
        if (name === 'agent_browser_tab_switch') {
          currentFakeTab = args.tab;
          return { raw: { isError: false }, text: 'OK' };
        }
        if (name === 'agent_browser_get_title') {
          const t = fakeTabs.find(x => x.targetId === currentFakeTab);
          return { raw: { isError: false }, text: t.title };
        }
        if (name === 'agent_browser_get_url') {
          const t = fakeTabs.find(x => x.targetId === currentFakeTab);
          return { raw: { isError: false }, text: t.url };
        }
        if (name === 'agent_browser_read') {
          return { raw: { isError: false }, text: '# Research Page' };
        }
        if (name === 'agent_browser_snapshot') {
          return {
            raw: { isError: false },
            text: '- main\n  - heading "Research Page" [level=1]\n  - searchbox "Query" [ref=e4]\n  - link "Paper PDF" [ref=e7, url=https://arxiv.org/pdf/2510.10666]'
          };
        }
        return { raw: { isError: false }, text: 'OK' };
      }
    })
  });

  try {
    const sRes = await mockMgr.start();
    assert.strictEqual(sRes.ok, true);
    assert.strictEqual(sRes.headless, false, 'Default launch must request visible window');
    assert.strictEqual(sRes.status, 'AWAITING_USER_GRANT');
    assert.strictEqual(sRes.availableTabs.length, 2);

    // Attempt action BEFORE user grant (even passing approved: true!)
    const ungranted = await mockMgr.act({ action: 'snapshot', approved: true });
    assert.strictEqual(ungranted.ok, false);
    assert.strictEqual(ungranted.status, 'HOST_GRANT_REQUIRED');

    // Verify Control Console rejects unauthenticated requests & rejects MCP self-navigation
    const ctrlPort = mockMgr.getControlPort();
    const unauthApi = await fetch(`http://127.0.0.1:${ctrlPort}/api/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: 'TAB_1' })
    });
    assert.strictEqual(unauthApi.status, 403, 'UI API must reject calls without host uiToken');

    const urlSelfCheck = await validateControlledNavigationUrl(`http://127.0.0.1:${ctrlPort}/control`, { controlPort: ctrlPort, allowLoopbackForTests: true });
    assert.strictEqual(urlSelfCheck.ok, false);
    assert.strictEqual(urlSelfCheck.status, 'CONTROL_PANEL_SELF_APPROVAL_BLOCKED');

    // User clicks "Select & Grant Control" on TAB_1 in the Control Console UI
    const uiToken = mockMgr.hostHandle.getUiTokenForHost();
    const grantRes = await fetch(`http://127.0.0.1:${ctrlPort}/api/grant`, {
      method: 'POST',
      headers: { 'x-northbridge-ui-token': uiToken, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: 'TAB_1' })
    }).then(r => r.json());
    assert.strictEqual(grantRes.ok, true);
    assert.strictEqual(grantRes.controlledTab.targetId, 'TAB_1');

    // Snapshot now succeeds on TAB_1!
    const snap1 = await mockMgr.act({ action: 'snapshot' });
    assert.strictEqual(snap1.ok, true);
    assert.strictEqual(snap1.controlledTab.targetId, 'TAB_1');

    // Password selector refusal -> hands back to user
    const pwdBlock = await mockMgr.act({ action: 'search_input', selector: 'input[type="password"]', text: 'secret123' });
    assert.strictEqual(pwdBlock.ok, false);
    assert.strictEqual(pwdBlock.status, 'HANDED_BACK_SIGNIN');
    await mockMgr.hostHandle.resume();

    // Attempt switching to ungranted TAB_2 must halt cleanly
    const ungrantedSwitch = await mockMgr.act({ action: 'tab_switch', tab: 'TAB_2' });
    assert.strictEqual(ungrantedSwitch.ok, false);
    assert.strictEqual(ungrantedSwitch.status, 'HOST_GRANT_REQUIRED');

    // User explicitly grants TAB_2 too -> tab_switch now succeeds!
    await fetch(`http://127.0.0.1:${ctrlPort}/api/grant`, {
      method: 'POST',
      headers: { 'x-northbridge-ui-token': uiToken, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: 'TAB_2' })
    });
    const switchBack = await mockMgr.act({ action: 'tab_switch', tab: 'TAB_1' });
    assert.strictEqual(switchBack.ok, true);
    assert.strictEqual(switchBack.controlledTab.targetId, 'TAB_1');

    // Pause control in UI -> action halted cleanly
    await fetch(`http://127.0.0.1:${ctrlPort}/api/pause`, { method: 'POST', headers: { 'x-northbridge-ui-token': uiToken } });
    const pausedAct = await mockMgr.act({ action: 'scroll' });
    assert.strictEqual(pausedAct.ok, false);
    assert.strictEqual(pausedAct.status, 'CONTROL_PAUSED');

    // Resume control in UI -> action works again
    await fetch(`http://127.0.0.1:${ctrlPort}/api/resume`, { method: 'POST', headers: { 'x-northbridge-ui-token': uiToken } });
    const resumedAct = await mockMgr.act({ action: 'scroll', direction: 'down', amount: 400 });
    assert.strictEqual(resumedAct.ok, true);

    // Revoke control in UI -> HUD removed, permanent revoke, resume blocked
    await fetch(`http://127.0.0.1:${ctrlPort}/api/revoke`, { method: 'POST', headers: { 'x-northbridge-ui-token': uiToken } });
    const revokedAct = await mockMgr.act({ action: 'snapshot' });
    assert.strictEqual(revokedAct.ok, false);
    assert.strictEqual(revokedAct.status, 'CONTROL_REVOKED');
    const cannotResume = await mockMgr.hostHandle.resume();
    assert.strictEqual(cannotResume.ok, false);
    assert.strictEqual(cannotResume.status, 'CONTROL_REVOKED');
    assert.ok(hudHistory.some(h => h.st === 'revoked'));
  } finally {
    await mockMgr.close();
  }
  console.log('  PASS: Host grant gate, self-approval block, pause/resume/revoke, and ungranted tab guard verified.\n');

  // -----------------------------------------------------------------------
  // Test 3: Sign-In & CAPTCHA Handback + Google Automation Block Fallback
  // -----------------------------------------------------------------------
  console.log('[Test 3/6] Testing sign-in handback, CAPTCHA handback, and Google block fallback...');
  const googleDetect = detectAuthCaptchaOrGoogleBlock({
    url: 'https://www.google.com/sorry/index?continue=https://scholar.google.com/scholar?q=test',
    title: 'Sorry... Google',
    snapshotText: 'Our systems have detected unusual traffic from your computer network. Verify that you are not a robot.'
  });
  assert.strictEqual(googleDetect.detected, true);
  assert.strictEqual(googleDetect.isGoogleBlock, true);
  assert.strictEqual(googleDetect.kind, 'GOOGLE_BLOCK');
  assert.ok(googleDetect.fallbackRoutes.some(r => r.provider === 'openalex'));
  assert.ok(googleDetect.fallbackRoutes.some(r => r.provider === 'crossref'));
  assert.ok(googleDetect.fallbackRoutes.some(r => r.provider === 'datacite'));

  const signInDetect = detectAuthCaptchaOrGoogleBlock({
    url: 'https://accounts.google.com/v3/signin/identifier',
    title: 'Sign in - Google Accounts',
    snapshotText: '- textbox "Email or phone"\n- textbox "Password"'
  });
  assert.strictEqual(signInDetect.detected, true);
  assert.strictEqual(signInDetect.kind, 'SIGNIN');
  console.log('  PASS: Sign-in, CAPTCHA, and Google /sorry/ block detection with keyless fallbacks verified.\n');

  // -----------------------------------------------------------------------
  // Test 4-6: Real Headless Chrome Fixture E2E (Approve, Search, Click, Scroll, Tab Switch, Blocked Google Fallback, MCP Stdio)
  // -----------------------------------------------------------------------
  console.log('[Test 4-6/6] Testing real Chrome CDP control & northbridge-control-mcp end-to-end against fixture...');
  const fixtureSrv = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (reqUrl.pathname === '/search') {
      const q = reqUrl.searchParams.get('q') || '';
      res.end(`<!DOCTYPE html><html><head><title>Research Portal</title></head><body>
        <h1>Northbridge Search Portal</h1>
        <form action="/results" method="GET">
          <input type="search" name="q" aria-label="Search scholarly articles" value="${q.replace(/"/g, '&quot;')}" />
          <button type="submit">Search</button>
        </form>
        <p><a href="/article?id=1">Open Verified Study</a></p>
        <p><a href="/sorry/index">Simulate Google Unusual Traffic</a></p>
        <p><a href="/login">Simulate Sign In</a></p>
        <div style="height:1800px">Spacer</div>
      </body></html>`);
    } else if (reqUrl.pathname === '/results') {
      const q = reqUrl.searchParams.get('q') || '';
      res.end(`<!DOCTYPE html><html><head><title>Results for ${q}</title></head><body>
        <h1>Search Results: ${q}</h1>
        <p><a href="/article?id=42">Result 1: Deep Study on ${q}</a></p>
      </body></html>`);
    } else if (reqUrl.pathname === '/article') {
      res.end(`<!DOCTYPE html><html><head><title>Verified Study Full Text</title></head><body>
        <h1>Verified Study Full Text</h1>
        <p>Main finding: Scoped snapshots cut observation tokens significantly.</p>
      </body></html>`);
    } else if (reqUrl.pathname === '/sorry/index') {
      res.end(`<!DOCTYPE html><html><head><title>Google Scholar - Sorry</title></head><body>
        <h1>About this page</h1>
        <p>Our systems have detected unusual traffic from your computer network. Please show you're not a robot.</p>
      </body></html>`);
    } else if (reqUrl.pathname === '/login') {
      res.end(`<!DOCTYPE html><html><head><title>Institutional Sign-In Required</title></head><body>
        <h1>Institutional Sign-In Required</h1>
        <form><input type="password" aria-label="Password" /></form>
      </body></html>`);
    } else {
      res.end(`<!DOCTYPE html><html><head><title>Second Research Tab</title></head><body><h1>Second Approved Tab</h1></body></html>`);
    }
  });
  await new Promise(r => fixtureSrv.listen(0, '127.0.0.1', r));
  const fixPort = fixtureSrv.address().port;
  const baseUrl = `http://127.0.0.1:${fixPort}`;

  const realProfile = path.join(os.tmpdir(), 'nb-real-ctrl-prof-' + Date.now());
  fs.mkdirSync(realProfile, { recursive: true });
  const realMgr = createControlManager({
    profileDir: realProfile,
    headless: true,
    allowLoopbackForTests: true
  });

  try {
    const started = await realMgr.start({ initialUrl: `${baseUrl}/search` });
    assert.strictEqual(started.ok, true, `Failed to start real Chrome control: ${started.error}`);
    assert.ok(started.availableTabs.some(t => t.url.includes('/search')));

    const searchTab = started.availableTabs.find(t => t.url.includes('/search'));
    // Approve searchTab via Control Console API
    const tok = realMgr.hostHandle.getUiTokenForHost();
    const g1 = await fetch(`http://127.0.0.1:${realMgr.getControlPort()}/api/grant`, {
      method: 'POST',
      headers: { 'x-northbridge-ui-token': tok, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: searchTab.targetId })
    }).then(r => r.json());
    assert.strictEqual(g1.ok, true);

    // 1. Snapshot
    const rSnap = await realMgr.act({ action: 'snapshot' });
    assert.strictEqual(rSnap.ok, true);
    assert.ok(rSnap.snapshot.includes('Northbridge Search Portal'));

    // 2. Search-field input + Enter submit
    const searchRef = (rSnap.snapshot.match(/searchbox "Search scholarly articles"[^\n]*\bref=(e\d+)/)?.[1])
      ? '@' + rSnap.snapshot.match(/searchbox "Search scholarly articles"[^\n]*\bref=(e\d+)/)[1]
      : 'input[type="search"]';
    const rSearch = await realMgr.act({ action: 'search_input', ref: searchRef, text: 'Agentic Browsing', submit: true });
    assert.strictEqual(rSearch.ok, true);
    assert.ok(rSearch.url.includes('/results'), `Expected results URL, got ${rSearch.url}`);
    assert.ok(rSearch.snapshot.includes('Agentic Browsing'));

    // 3. Click link
    const artRef = (rSearch.snapshot.match(/link "Result 1:[^"]*"[^\n]*\bref=(e\d+)/)?.[1])
      ? '@' + rSearch.snapshot.match(/link "Result 1:[^"]*"[^\n]*\bref=(e\d+)/)[1]
      : 'a';
    const rClick = await realMgr.act({ action: 'click', ref: artRef });
    assert.strictEqual(rClick.ok, true, `Click failed (artRef=${artRef}): ${JSON.stringify(rClick)}`);
    assert.ok(rClick.url.includes('/article'));
    assert.ok(rClick.snapshot.includes('Verified Study Full Text'));

    // 4. Scroll
    const rScroll = await realMgr.act({ action: 'scroll', direction: 'down', amount: 300 });
    assert.strictEqual(rScroll.ok, true);

    // 5. Navigate to Sign-in page -> hands control back & pauses
    const rLogin = await realMgr.act({ action: 'navigate', url: `${baseUrl}/login` });
    assert.strictEqual(rLogin.ok, false);
    assert.strictEqual(rLogin.status, 'HANDED_BACK_SIGNIN');
    assert.strictEqual(rLogin.handedBack, true);

    // Resume after sign-in -> check Google block fallback on /sorry/index
    await realMgr.hostHandle.resume();
    const rSorry = await realMgr.act({ action: 'navigate', url: `${baseUrl}/sorry/index`, queryHint: 'Agentic Browsing' });
    assert.strictEqual(rSorry.ok, false);
    assert.strictEqual(rSorry.status, 'BLOCKED_GOOGLE_FALLBACK');
    assert.ok(rSorry.blockRecord && rSorry.blockRecord.status === 'BLOCKED');
    assert.ok(rSorry.fallbackRoutes.length >= 4);

    // 6. Verify MCP server stdio tool listing & rejection without host grant
    const mcp = new StdioMcpClient('bin/northbridge-control-mcp.mjs', {
      NORTHBRIDGE_CONTROL_HEADLESS: '1',
      NORTHBRIDGE_CONTROL_ALLOW_LOOPBACK: '1'
    });
    await mcp.init();
    const tList = await mcp.send('tools/list');
    assert.deepStrictEqual(
      tList.result.tools.map(t => t.name),
      ['northbridge_control_start', 'northbridge_control_status', 'northbridge_control_act']
    );
    const mcpDeny = await mcp.send('tools/call', {
      name: 'northbridge_control_act',
      arguments: { action: 'snapshot', approved: true }
    });
    assert.strictEqual(mcpDeny.result.isError, true);
    await mcp.close();
  } finally {
    await realMgr.close({ closeBrowser: true });
    fixtureSrv.close();
    try { fs.rmSync(realProfile, { recursive: true, force: true }); } catch {}
  }

  console.log('  PASS: Real Chrome CDP control actions, auth handback, Google block fallback, and MCP stdio verified.\n');
  console.log('========================================================================');
  console.log('ALL OPT-IN CHROME CONTROL TESTS PASSED (6/6)!');
  console.log('========================================================================');
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
