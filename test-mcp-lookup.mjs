// Scripted MCP lookup verification via stdio
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const entrypoint = path.join(__dirname, 'bin', 'northbridge-browser.js');
const session = 'lookup-' + Math.random().toString(36).slice(2, 8);

// Port resolution
const portArgIdx = process.argv.indexOf('-Port');
const portVal = portArgIdx !== -1 ? process.argv[portArgIdx + 1] : (process.env.PORT || '4317');
const baseUrl = `http://127.0.0.1:${portVal}/`;

console.log('=== SCRIPTED MCP LOOKUP ===');
console.log('Transport: Project-local MCP server over stdio (agent-browser mcp --tools core)');
console.log(`Target URL: ${baseUrl}`);
console.log(`Session: ${session}\n`);

const proc = spawn('node', [entrypoint, 'mcp', '--tools', 'core'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1'
  }
});

let msgId = 1;
const pending = new Map();
let buffer = '';

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    } catch (e) {
      // ignore non-json
    }
  }
});

function sendRequest(method, params = {}) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    proc.stdin.write(payload);
  });
}

async function callTool(name, args = {}) {
  const res = await sendRequest('tools/call', { name, arguments: args });
  if (res.isError) {
    const errText = res.content?.map((c) => c.text).join('\n') || 'Unknown tool error';
    throw new Error(`Tool ${name} failed: ${errText}`);
  }
  return res;
}

try {
  // Initialize
  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-scripted-lookup', version: '1.0.0' }
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // Discover tools
  const toolsRes = await sendRequest('tools/list');
  console.log(`Discovered ${toolsRes.tools.length} MCP tools.`);

  // Step 1: Open catalogue
  console.log(`\nStep 1: Opening catalogue at ${baseUrl}...`);
  await callTool('agent_browser_open', { url: baseUrl, session });

  // Step 2: Inspect catalogue structure
  console.log("Step 2: Inspecting catalogue page structure...");
  const snap1 = await callTool('agent_browser_snapshot', {
    selector: '#main',
    compact: true,
    interactive: false,
    session
  });
  const text1 = snap1.content[0].text;

  // Locate link
  const match = text1.match(/link "MSc Applied Data Science"[^[]*\[(?:[^\]]*ref=)?([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error("Could not find MSc Applied Data Science link ref in catalogue snapshot");
  }
  const mscRef = '@' + match[1].replace(/^@/, '');
  console.log(`Found MSc Applied Data Science link ref: ${mscRef}`);

  // Step 3: Click programme link
  console.log(`Step 3: Navigating to programme page via click on ${mscRef}...`);
  await callTool('agent_browser_click', { selector: mscRef, session });

  // Step 4: Inspect programme page structure
  console.log("Step 4: Inspecting programme page structure...");
  const snap2 = await callTool('agent_browser_snapshot', {
    selector: '#main',
    compact: true,
    interactive: false,
    session
  });
  const text2 = snap2.content[0].text;
  console.log("Observed programme page structure:\n" + text2);

  // Step 5: Read and verify deadline from observed content without fallbacks
  console.log("Step 5: Extracting deadline and source URL...");
  const deadlineMatch = text2.match(/Application deadline:[\s\S]*?time[\s\S]*?StaticText "([^"]+)"/i) ||
                        text2.match(/Application deadline:\s*([^\n\r"]+)/i);
  if (!deadlineMatch || !deadlineMatch[1] || !deadlineMatch[1].trim()) {
    throw new Error("Missing deadline: observed programme page does not contain an application deadline");
  }
  const observedDeadline = deadlineMatch[1].trim();

  // Read current URL from browser tool
  const urlRes = await callTool('agent_browser_get_url', { session });
  const observedUrl = urlRes.content?.[0]?.text?.trim();
  if (!observedUrl || !observedUrl.startsWith('http://127.0.0.1:')) {
    throw new Error(`Browser failed to return a usable source URL (received '${observedUrl}')`);
  }

  // Validate that the URL identifies the page actually used
  const parsedUrl = new URL(observedUrl);
  if (parsedUrl.searchParams.get('view') !== 'data') {
    throw new Error(`Observed URL does not identify the programme page actually used: '${observedUrl}'`);
  }

  // Assertion: on normal portal, verify observedDeadline equals expected date
  if (portVal === '4317') {
    assert.strictEqual(observedDeadline, '21 May 2027', `Expected deadline '21 May 2027', observed '${observedDeadline}'`);
  }

  console.log("\n=============================================");
  console.log("SCRIPTED LOOKUP RESULT:");
  console.log(`Observed deadline: ${observedDeadline}`);
  console.log(`Observed source URL: ${observedUrl}`);
  console.log("=============================================\n");

  // Step 6: Close named session
  await callTool('agent_browser_close', { session });
  console.log("Session closed cleanly.");
} catch (err) {
  console.error(`\nScripted lookup failed: ${err.message}`);
  process.exitCode = 1;
  try {
    await callTool('agent_browser_close', { session });
  } catch (_) {}
} finally {
  proc.kill('SIGTERM');
}
