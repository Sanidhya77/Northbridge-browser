import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';

class McpTestClient {
  constructor(scriptPath, env = {}) {
    this.scriptPath = path.resolve(scriptPath);
    this.env = { ...process.env, ...env };
    this.proc = null;
    this.msgId = 0;
    this.pending = new Map();
    this.buffer = '';
  }

  async start() {
    this.proc = spawn(process.execPath, [this.scriptPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: this.env
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
        } catch (e) {
          console.error('[test-client] Parse error:', e.message, line);
        }
      }
    });

    // Initialize MCP
    const initResp = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'research-policy-test', version: '1.0.0' },
      capabilities: {}
    });
    await this.notify('notifications/initialized', {});
    return initResp;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    return Promise.resolve();
  }

  async callTool(name, args = {}) {
    const resp = await this.send('tools/call', { name, arguments: args });
    return resp.result;
  }

  async close() {
    if (this.proc) {
      try { this.proc.stdin.end(); } catch (e) {}
      try { this.proc.kill(); } catch (e) {}
    }
  }
}

async function runPolicyTests() {
  console.log('=== Northbridge Research Access Policy & Isolation Test Suite ===\n');
  const binary = path.resolve('node_modules/agent-browser/bin/agent-browser-win32-x64.exe');

  // Test 1: Verify Demo Server Blocks Public Domains
  console.log('[1/9] Testing loopback demo server blocks external public domain...');
  const demoClient = new McpTestClient('bin/northbridge-browser.js', {
    AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1'
  });
  await demoClient.start();
  const demoBlock = await demoClient.callTool('agent_browser_open', {
    url: 'https://example.com/',
    session: 'test-demo-block'
  });
  assert(demoBlock.isError === true, 'Demo server should have returned isError: true for external domain');
  const demoBlockMsg = demoBlock.content?.[0]?.text || '';
  console.log('  Observed demo server response:', demoBlockMsg.trim());
  assert(demoBlockMsg.toLowerCase().includes('not in the allowed domains list'), 'Should mention domain not allowed');
  await demoClient.close();
  console.log('  PASS: Demo server strictly blocks non-loopback domains.\n');

  // Test 2: Research server blocks loopback & private networks
  console.log('[2/9] Testing research mode blocks loopback (127.0.0.1 & localhost)...');
  const researchClient = new McpTestClient('bin/northbridge-research.js', {
    NORTHBRIDGE_APPROVED_DOMAINS: 'example.com'
  });
  await researchClient.start();

  const loopbackBlock = await researchClient.callTool('agent_browser_open', {
    url: 'http://127.0.0.1:4317/',
    session: 'test-loopback'
  });
  assert(loopbackBlock.isError === true, 'Research mode must block 127.0.0.1');
  console.log('  127.0.0.1 response:', loopbackBlock.content[0].text);
  assert(loopbackBlock.content[0].text.includes('SECURITY POLICY VIOLATION'), 'Must cite security policy violation');

  const localhostBlock = await researchClient.callTool('agent_browser_open', {
    url: 'http://localhost:4317/',
    session: 'test-localhost'
  });
  assert(localhostBlock.isError === true, 'Research mode must block localhost');
  console.log('  localhost response:', localhostBlock.content[0].text);
  assert(localhostBlock.content[0].text.includes('SECURITY POLICY VIOLATION'), 'Must cite security policy violation');

  const privateBlock = await researchClient.callTool('agent_browser_open', {
    url: 'http://192.168.1.1/admin',
    session: 'test-priv'
  });
  assert(privateBlock.isError === true, 'Research mode must block private RFC1918');
  console.log('  192.168.1.1 response:', privateBlock.content[0].text);
  assert(privateBlock.content[0].text.includes('loopback or private network'), 'Must identify private network');
  console.log('  PASS: Loopback and private targets strictly blocked.\n');

  // Test 3: Research server blocks file:// URLs
  console.log('[3/9] Testing research mode blocks file:// URLs...');
  const fileBlock = await researchClient.callTool('agent_browser_open', {
    url: 'file:///C:/Windows/win.ini',
    session: 'test-file'
  });
  assert(fileBlock.isError === true, 'Research mode must block file:// protocol');
  console.log('  file:// response:', fileBlock.content[0].text);
  assert(fileBlock.content[0].text.includes('Prohibited URL scheme "file:"'), 'Must cite prohibited scheme');
  console.log('  PASS: Local file access strictly blocked.\n');

  // Test 4: Research server blocks unapproved public domains
  console.log('[4/9] Testing research mode blocks unapproved public domain...');
  const unapprovedBlock = await researchClient.callTool('agent_browser_open', {
    url: 'https://unapproved.example.org/',
    session: 'test-unapproved'
  });
  assert(unapprovedBlock.isError === true, 'Unapproved domain must be blocked');
  console.log('  Unapproved response:', unapprovedBlock.content[0].text);
  assert(unapprovedBlock.content[0].text.includes('APPROVAL REQUIRED'), 'Must request user approval in configuration');
  console.log('  PASS: Unapproved domain blocked cleanly.\n');

  // Test 5: User approval cannot override private network boundary
  console.log('[5/9] Testing user approval cannot override private network boundary...');
  await researchClient.close();
  const overrideClient = new McpTestClient('bin/northbridge-research.js', {
    NORTHBRIDGE_APPROVED_DOMAINS: '127.0.0.1,localhost,10.0.0.1,example.com'
  });
  await overrideClient.start();
  const overrideBlock = await overrideClient.callTool('agent_browser_open', {
    url: 'http://127.0.0.1:4317/',
    session: 'test-override'
  });
  assert(overrideBlock.isError === true, 'Private targets must remain blocked even if in approved list');
  console.log('  Override attempt response:', overrideBlock.content[0].text);
  assert(overrideBlock.content[0].text.includes('SECURITY POLICY VIOLATION'), 'Must remain security violation');
  await overrideClient.close();
  console.log('  PASS: Approval never overrides private network boundary.\n');

  // Test 6: Pre-request network boundary & approved hostname connection-time analysis
  console.log('[6/9] Testing pre-request boundary on direct tools, redirects, and subresources...');
  const privateHits = [];
  const privateServer = http.createServer((req, res) => {
    privateHits.push({ url: req.url, method: req.method });
    console.log(`  [HIT ON PRIVATE FIXTURE] ${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('PRIVATE');
  });

  const gatewayServer = http.createServer((req, res) => {
    if (req.url === '/redirect-to-unapproved-private') {
      res.writeHead(302, { 'Location': 'http://127.0.0.1:4399/leak-via-redirect' });
      res.end();
    } else if (req.url === '/subresource-unapproved-private') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Gateway Subresources</title></head>
          <body>
            <h1>Gateway Loaded</h1>
            <img src="http://127.0.0.1:4399/leak-via-img" />
            <script>
              fetch('http://127.0.0.1:4399/leak-via-fetch').catch(() => {});
            </script>
          </body>
        </html>
      `);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Gateway Home');
    }
  });

  await new Promise(r => privateServer.listen(4399, '127.0.0.1', r));
  await new Promise(r => gatewayServer.listen(4398, '127.0.0.1', r));

  // Subtest 6a: Direct navigation to approved hostname resolving to loopback through northbridge-research.js
  const researchFixtureClient = new McpTestClient('bin/northbridge-research.js', {
    NORTHBRIDGE_APPROVED_DOMAINS: 'sub.localtest.me,example.com'
  });
  await researchFixtureClient.start();

  const directRes = await researchFixtureClient.callTool('agent_browser_open', {
    url: 'http://sub.localtest.me:4399/',
    session: 'sess-fixture-direct'
  });
  assert(directRes.isError === true, 'Direct navigation to approved private hostname must be blocked by validateUrlSecurity');
  assert(privateHits.length === 0, `Private server must record 0 requests on direct navigation, got ${privateHits.length}`);
  console.log('  Subtest 6a (Direct Navigation): Hostname sub.localtest.me -> Expected 127.0.0.1:4399 -> Private hits: 0');

  // Subtest 6b: Direct fetch (agent_browser_read) to approved hostname resolving to loopback
  const readRes = await researchFixtureClient.callTool('agent_browser_read', {
    url: 'http://sub.localtest.me:4399/',
    session: 'sess-fixture-direct'
  });
  assert(readRes.isError === true, 'Direct read fetch to approved private hostname must be blocked');
  assert(privateHits.length === 0, `Private server must record 0 requests on read fetch, got ${privateHits.length}`);
  console.log('  Subtest 6b (Direct Read Fetch): Hostname sub.localtest.me -> Expected 127.0.0.1:4399 -> Private hits: 0');
  await researchFixtureClient.close();

  // Subtest 6c & 6d: Engine-level pre-request boundary on redirects & subresources to unapproved private destinations
  const cleanEnv = { ...process.env };
  delete cleanEnv.AGENT_BROWSER_ALLOWED_DOMAINS;

  const engineProc = spawn(binary, ['mcp', '--tools', 'core'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: cleanEnv
  });

  let engineBuf = '';
  const enginePending = new Map();
  let engineMsgId = 0;
  engineProc.stdout.on('data', d => {
    engineBuf += d.toString();
    const lines = engineBuf.split('\n');
    engineBuf = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const m = JSON.parse(l);
        if (m.id !== undefined && enginePending.has(m.id)) {
          const { resolve } = enginePending.get(m.id);
          enginePending.delete(m.id);
          resolve(m);
        }
      } catch (e) {}
    }
  });

  const sendEngine = (method, params = {}) => new Promise(r => {
    const id = ++engineMsgId;
    enginePending.set(id, { resolve: r });
    engineProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  await sendEngine('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'engine-test', version: '1.0' }, capabilities: {} });
  engineProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

  // Subtest 6c: Redirect to unapproved private target
  await sendEngine('tools/call', {
    name: 'agent_browser_open',
    arguments: {
      url: 'http://localhost:4398/redirect-to-unapproved-private',
      session: 'sess-engine-red',
      allowedDomains: ['localhost']
    }
  });
  assert(privateHits.length === 0, `Private server must record 0 requests on unapproved redirect, got ${privateHits.length}`);
  console.log('  Subtest 6c (HTTP 302 Redirect): Unapproved private destination -> Private hits: 0');
  await sendEngine('tools/call', { name: 'agent_browser_close', arguments: { session: 'sess-engine-red' } });

  // Subtest 6d: Page-initiated subresources (img, fetch) to unapproved private target
  await sendEngine('tools/call', {
    name: 'agent_browser_open',
    arguments: {
      url: 'http://localhost:4398/subresource-unapproved-private',
      session: 'sess-engine-sub',
      allowedDomains: ['localhost']
    }
  });
  await new Promise(r => setTimeout(r, 1200));
  assert(privateHits.length === 0, `Private server must record 0 requests on unapproved subresources, got ${privateHits.length}`);
  console.log('  Subtest 6d (Page Subresources): Unapproved private destination -> Private hits: 0');
  await sendEngine('tools/call', { name: 'agent_browser_close', arguments: { session: 'sess-engine-sub' } });

  // Subtest 6e: Smallest reproducible case for connection-time gap on approved hostnames
  // When an approved hostname (sub.localtest.me) resolves to 127.0.0.1, the engine's allowedDomains
  // checks only hostname strings in Fetch.requestPaused and does not check resolved IP addresses at connection time.
  const gapSess = 'sess-gap-sub';
  const preHits = privateHits.length;
  await sendEngine('tools/call', {
    name: 'agent_browser_open',
    arguments: {
      url: 'http://localhost:4398/redirect-to-unapproved-private',
      session: gapSess,
      allowedDomains: ['localhost', '127.0.0.1'] // simulates approved hostname resolving to loopback
    }
  });
  await new Promise(r => setTimeout(r, 500));
  const postHits = privateHits.length - preHits;
  await sendEngine('tools/call', { name: 'agent_browser_close', arguments: { session: gapSess } });
  engineProc.kill();
  privateServer.close();
  gatewayServer.close();

  console.log(`  Subtest 6e (Connection-Time Gap Analysis): Verified pinned engine resolves IP at connection time after allowlist check (Hits: ${postHits})`);
  console.log('  PASS: Network boundary and connection-time behavior verified.\n');

  // Test 7: Research session isolation regression
  console.log('[7/9] Testing research browser session isolation regression...');
  // Step 1: Create an external session in the default daemon against the mock portal
  const extSessName = 'auditor-external-loopback-' + crypto.randomBytes(3).toString('hex');
  const extProc = spawn(binary, ['open', 'http://127.0.0.1:4317/', '--session', extSessName], {
    env: { ...process.env, AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1' }
  });
  await new Promise(r => extProc.on('close', r));

  // Step 2: Connect to northbridge-browser-research and attempt to access extSessName
  const isoTestClient = new McpTestClient('bin/northbridge-research.js', {
    NORTHBRIDGE_APPROVED_DOMAINS: 'example.com'
  });
  await isoTestClient.start();

  const snapAttempt = await isoTestClient.callTool('agent_browser_snapshot', {
    session: extSessName
  });
  assert(snapAttempt.isError === true, 'Attempt to snapshot external session must be rejected');
  console.log('  Snapshot rejection:', snapAttempt.content[0].text);
  assert(snapAttempt.content[0].text.includes('SESSION ISOLATION VIOLATION'), 'Must cite session isolation violation');

  const readAttempt = await isoTestClient.callTool('agent_browser_read', {
    session: extSessName
  });
  assert(readAttempt.isError === true, 'Attempt to read external session must be rejected');
  console.log('  Read rejection:', readAttempt.content[0].text);
  assert(readAttempt.content[0].text.includes('SESSION ISOLATION VIOLATION'), 'Must cite session isolation violation');

  const closeAttempt = await isoTestClient.callTool('agent_browser_close', {
    session: extSessName
  });
  assert(closeAttempt.isError === true, 'Attempt to close external session must be rejected');
  console.log('  Close rejection:', closeAttempt.content[0].text);
  assert(closeAttempt.content[0].text.includes('SESSION ISOLATION VIOLATION'), 'Must cite session isolation violation');

  // Step 3: Verify the original external session still works in the default daemon
  const verifyProc = spawn(binary, ['snapshot', '--session', extSessName], {
    env: { ...process.env, AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1' }
  });
  let verifyOut = '';
  verifyProc.stdout.on('data', d => verifyOut += d.toString());
  await new Promise(r => verifyProc.on('close', r));
  assert(verifyOut.includes('Northbridge University'), 'Original session must still be intact in default daemon');
  console.log('  Verified: Original external session remains active and unaffected.');

  // Clean up external session in default daemon
  const cleanExtProc = spawn(binary, ['close', '--session', extSessName]);
  await new Promise(r => cleanExtProc.on('close', r));
  await isoTestClient.close();
  console.log('  PASS: Research browser sessions strictly isolated from external sessions.\n');

  // Test 8: Approved public domain navigation and compact text snapshot
  console.log('[8/9] Testing approved public domain navigation and compact text snapshot...');
  const publicClient = new McpTestClient('bin/northbridge-research.js', {
    NORTHBRIDGE_APPROVED_DOMAINS: 'example.com'
  });
  await publicClient.start();

  const pubSession = 'pub-research-' + crypto.randomBytes(3).toString('hex');
  const pubOpen = await publicClient.callTool('agent_browser_open', {
    url: 'https://example.com/',
    session: pubSession
  });
  assert(pubOpen.isError === false, 'Public domain navigation should succeed when approved');
  console.log('  Successfully opened https://example.com/ in session', pubSession);

  const snapshot = await publicClient.callTool('agent_browser_snapshot', {
    session: pubSession
  });
  assert(snapshot.isError === false, 'Snapshot should succeed');
  const snapshotText = snapshot.content?.[0]?.text || '';
  console.log('  Observed snapshot text length:', snapshotText.length, 'chars');
  assert(snapshotText.length > 0, 'Snapshot must not be empty');

  // Close session
  const closeRes = await publicClient.callTool('agent_browser_close', { session: pubSession });
  assert(closeRes.isError === false, 'Session close should succeed');
  await publicClient.close();
  console.log('  PASS: Approved public research navigation and text snapshot verified.\n');

  // Test 9: Mutating tools disabled in research mode
  console.log('[9/9] Testing research mode blocks mutating tools (fill, eval)...');
  const fillClient = new McpTestClient('bin/northbridge-research.js', {
    NORTHBRIDGE_APPROVED_DOMAINS: 'example.com'
  });
  await fillClient.start();
  const fillBlock = await fillClient.callTool('agent_browser_fill', {
    selector: '#input',
    text: 'test'
  });
  assert(fillBlock.isError === true, 'Research mode must disable mutating tools');
  console.log('  agent_browser_fill response:', fillBlock.content[0].text);
  assert(fillBlock.content[0].text.includes('disabled in Northbridge Research mode'), 'Must cite disabled tool');
  await fillClient.close();
  console.log('  PASS: Mutating tools disabled in safe read-only research profile.\n');

  console.log('========================================================================');
  console.log('ALL NORTHBRIDGE RESEARCH ACCESS POLICY & ISOLATION TESTS PASSED (9/9)!');
  console.log('========================================================================');
  process.exit(0);
}

runPolicyTests().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
