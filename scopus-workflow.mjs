import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findAgentBrowserBinary() {
  const binaryWin = path.resolve(__dirname, 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
  if (fs.existsSync(binaryWin)) return binaryWin;
  const parentBinary = path.resolve(__dirname, '..', '..', 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
  if (fs.existsSync(parentBinary)) return parentBinary;
  return 'agent-browser';
}

/**
 * Validates Chrome DevTools Protocol remote debugging endpoint.
 * Enforces loopback connection (127.0.0.1 or localhost), validates port,
 * and probes http://${host}:${port}/json/version to verify Chrome is reachable.
 */
export async function validateCdpEndpoint(cdp) {
  if (!cdp && cdp !== 0) {
    return { valid: false, error: 'CDP endpoint is required' };
  }

  let host = '127.0.0.1';
  let port = null;

  if (typeof cdp === 'number' || /^\d+$/.test(String(cdp).trim())) {
    port = Number(String(cdp).trim());
  } else {
    let raw = String(cdp).trim();
    if (!raw.startsWith('http://') && !raw.startsWith('https://') && !raw.startsWith('ws://')) {
      raw = `http://${raw}`;
    }
    try {
      const parsed = new URL(raw);
      host = parsed.hostname;
      port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    } catch (e) {
      return { valid: false, error: `Invalid CDP endpoint format: '${cdp}'` };
    }
  }

  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    return {
      valid: false,
      error: `Chrome debugging endpoint must be a loopback address (127.0.0.1 or localhost). Refusing to connect to non-loopback host '${host}'.`
    };
  }

  if (!port || port < 1 || port > 65535) {
    return { valid: false, error: `Invalid port '${port}' in CDP endpoint '${cdp}'` };
  }

  const probeUrl = `http://${host}:${port}/json/version`;
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.get(probeUrl, { timeout: 1500 }, (resp) => {
        let body = '';
        resp.on('data', d => body += d);
        resp.on('end', () => {
          if (resp.statusCode === 200) {
            try {
              resolve({ ok: true, data: JSON.parse(body) });
            } catch (err) {
              resolve({ ok: false, error: `Invalid JSON response from ${probeUrl}` });
            }
          } else {
            resolve({ ok: false, error: `HTTP status ${resp.statusCode}` });
          }
        });
      });
      req.on('error', err => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
    });

    if (!res.ok) {
      return {
        valid: false,
        error: `Chrome remote debugging endpoint ${probeUrl} returned error: ${res.error}`
      };
    }

    const data = res.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        valid: false,
        error: `Chrome remote debugging endpoint ${probeUrl} returned non-object response.`
      };
    }

    // Require valid Chrome debugger metadata: Browser, Protocol-Version, webSocketDebuggerUrl
    const browserStr = data.Browser || data.browser;
    if (!browserStr || typeof browserStr !== 'string' || !/chrome|chromium/i.test(browserStr)) {
      return {
        valid: false,
        error: `Chrome remote debugging endpoint ${probeUrl} returned missing or invalid 'Browser' metadata (observed: ${JSON.stringify(browserStr)}). Expected a valid Chrome debugger instance.`
      };
    }

    const wsUrlStr = data.webSocketDebuggerUrl;
    if (!wsUrlStr || typeof wsUrlStr !== 'string') {
      return {
        valid: false,
        error: `Chrome remote debugging endpoint ${probeUrl} returned missing or invalid 'webSocketDebuggerUrl' metadata.`
      };
    }

    // Verify webSocketDebuggerUrl stays within loopback boundary
    try {
      const wsUrl = new URL(wsUrlStr);
      const wsHost = wsUrl.hostname;
      const isWsLoopback = wsHost === '127.0.0.1' || wsHost === 'localhost' || wsHost === '::1';
      if (!isWsLoopback) {
        return {
          valid: false,
          error: `Chrome remote debugging endpoint returned non-loopback webSocketDebuggerUrl host '${wsHost}'. Expected loopback connection.`
        };
      }
      const wsPort = wsUrl.port ? Number(wsUrl.port) : (wsUrl.protocol === 'wss:' ? 443 : 80);
      if (wsPort !== port) {
        return {
          valid: false,
          error: `Chrome remote debugging endpoint returned webSocketDebuggerUrl on port ${wsPort}, expected port ${port}.`
        };
      }
    } catch (e) {
      return {
        valid: false,
        error: `Chrome remote debugging endpoint returned malformed webSocketDebuggerUrl: ${e.message}`
      };
    }

    return { valid: true, host, port, endpoint: `${host}:${port}`, versionData: data };
  } catch (err) {
    return {
      valid: false,
      error: `Chrome remote debugging endpoint http://${host}:${port} is unavailable (${err.message}). Ensure Chrome is running with --remote-debugging-port=${port}.`
    };
  }
}

/**
 * Validates export filename against path traversal attacks.
 * Rejects /, \, .., absolute paths, and non-.csv extensions.
 */
export function validateExportFilename(filename, targetFolder) {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'Filename is required' };
  }
  const trimmed = filename.trim();
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return { valid: false, error: 'Path traversal characters (/, \\, ..) are not permitted' };
  }
  if (path.isAbsolute(trimmed)) {
    return { valid: false, error: 'Absolute paths are not permitted' };
  }
  if (!trimmed.toLowerCase().endsWith('.csv')) {
    return { valid: false, error: 'Export filename must end with .csv' };
  }
  if (targetFolder) {
    const resolvedTarget = path.resolve(targetFolder);
    const resolvedPath = path.resolve(targetFolder, trimmed);
    if (!resolvedPath.startsWith(resolvedTarget + path.sep)) {
      return { valid: false, error: 'Target path resolves outside designated export directory' };
    }
  }
  return { valid: true, filename: trimmed };
}

/**
 * RFC 4180-compliant CSV parser.
 * Handles multiline abstracts, escaped quotes (""), and quoted commas.
 *
 * @param {string} text - Raw CSV text
 * @returns {Array<Array<string>>} Parsed rows and fields
 */
export function parseCsv(text) {
  if (!text || typeof text !== 'string') return [];
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          // Escaped quote ("") within quoted field
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++; // Skip \r of \r\n
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Remove trailing empty row caused by final newline
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0].trim() === '') {
      rows.pop();
    }
  }

  return rows;
}

/**
 * Normalizes query string for whitespace-invariant comparison.
 */
function normalizeQuery(q) {
  if (!q) return '';
  return q.replace(/\s+/g, ' ').trim();
}

/**
 * Creates an MCP client connected to agent-browser over stdio.
 */
export function createMcpClient(options = {}) {
  const binary = options.binary || findAgentBrowserBinary();
  const allowedDomains = options.allowedDomains || '127.0.0.1';
  const cdp = options.cdp;

  const args = ['mcp', '--tools', 'core'];

  const env = { ...process.env };
  if (cdp) {
    env.AGENT_BROWSER_CDP = String(cdp);
    delete env.AGENT_BROWSER_ALLOWED_DOMAINS;
  } else {
    env.AGENT_BROWSER_ALLOWED_DOMAINS = allowedDomains;
    delete env.AGENT_BROWSER_CDP;
  }

  const proc = spawn(binary, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env
  });

  let msgId = 0;
  const pending = new Map();
  let buffer = '';

  proc.on('exit', (code, signal) => {
    for (const [id, { timer, reject }] of pending) {
      clearTimeout(timer);
      reject(new Error(`MCP server exited (code: ${code}, signal: ${signal}) on id ${id}`));
    }
    pending.clear();
  });

  proc.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          const { timer, resolve, reject } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(`MCP error: ${JSON.stringify(msg.error)}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch (err) {
        console.error('JSON parse error from MCP:', err.message);
      }
    }
  });

  function send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request '${method}' (id ${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { timer, resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async function callTool(name, args = {}, timeoutMs = 20000) {
    const res = await send('tools/call', { name, arguments: args }, timeoutMs);
    let text = '';
    if (res && res.content) {
      for (const item of res.content) {
        if (item.type === 'text') text += item.text;
      }
    }
    return { raw: res, text };
  }

  async function init() {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'scopus-workflow-runner', version: '1.0' },
      capabilities: {}
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  }

  async function close() {
    try {
      proc.stdin.end();
      if (proc.stdout && !proc.stdout.destroyed) {
        proc.stdout.destroy();
      }
      proc.kill();
    } catch (e) { }
  }

  return { init, callTool, close, proc };
}

/**
 * Extracts element ref from snapshot line matching a pattern
 */
function findRef(snapshotText, regex) {
  const lines = snapshotText.split('\n');
  for (const line of lines) {
    if (regex.test(line)) {
      const match = line.match(/\[ref=(e\d+)\]/);
      if (match) return `@${match[1]}`;
    }
  }
  return null;
}

/**
 * Executes a Scopus search block according to the verified 5-step workflow.
 *
 * @param {Object} opts
 * @param {string} opts.block - Block identifier, e.g. "D3"
 * @param {string} opts.claim - Thesis claim
 * @param {string} opts.query - Exact Scopus query string
 * @param {string} opts.control - Control paper title
 * @param {string} opts.exportFile - Target export CSV filename
 * @param {string} [opts.baseUrl] - Fixture or Scopus base URL
 * @param {string} [opts.outputDir] - Dedicated export output directory
 * @param {string} [opts.session] - Browser session name
 * @param {string} [opts.tab] - Pattern to select an already-open tab (requires unique match)
 * @param {string} [opts.cdp] - Chrome remote debugging port or URL (e.g. 9222)
 * @param {string} [opts.downloadsDir] - Directory where browser saves downloads
 * @param {number} [opts.downloadTimeoutMs] - Maximum wait time for fresh download
 * @param {boolean} [opts.simulateExportFail] - Whether to simulate export failure
 * @returns {Promise<Object>} Search run results & formatted report
 */
export async function executeScopusBlock(opts) {
  const {
    block = 'D3',
    claim = '',
    query = '',
    control = '',
    exportFile = `Ch3_34_SC_${block}.csv`,
    baseUrl = 'http://127.0.0.1:4318',
    outputDir = path.resolve(__dirname, 'exports'),
    session = 'scopus-' + crypto.randomBytes(3).toString('hex'),
    tab = null,
    cdp = null,
    downloadsDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads'),
    downloadTimeoutMs = 6000,
    simulateExportFail = false
  } = opts;

  const searchDate = new Date().toISOString().slice(0, 10);
  const submittedQuery = (query || '').trim();

  // Validate export filename against path traversal
  const filenameCheck = validateExportFilename(exportFile, outputDir);
  if (!filenameCheck.valid) {
    return buildReport({
      block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
      totalMain: 0, totalPreprints: 0, queryExecuted: false,
      queryMessage: `INVALID FILENAME: ${filenameCheck.error}`,
      controlStatus: 'NOT FOUND', indexedStatus: 'UNCLEAR',
      exportSuccess: false,
      exportMessage: `EXPORT REJECTED: ${filenameCheck.error}`,
      exportFilePath: null,
      lastLine: `REJECTED: Target export filename '${exportFile}' rejected: ${filenameCheck.error}`
    });
  }

  // Validate CDP endpoint if specified (loopback enforcement & availability probe)
  if (cdp) {
    const endpointCheck = await validateCdpEndpoint(cdp);
    if (!endpointCheck.valid) {
      const errorMsg = `ATTACHMENT ERROR: ${endpointCheck.error}`;
      return buildReport({
        block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
        totalMain: 0, totalPreprints: 0, queryExecuted: false,
        queryMessage: errorMsg, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
        exportSuccess: false, exportMessage: errorMsg, exportFilePath: null,
        lastLine: errorMsg
      });
    }

    if (!tab) {
      const errorMsg = 'ATTACHMENT ERROR: A target tab pattern (--tab <pattern>) is required when attaching to external Chrome via CDP';
      return buildReport({
        block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
        totalMain: 0, totalPreprints: 0, queryExecuted: false,
        queryMessage: errorMsg, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
        exportSuccess: false, exportMessage: errorMsg, exportFilePath: null,
        lastLine: errorMsg
      });
    }
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const shouldCloseClient = !opts.client;
  const client = opts.client || createMcpClient({ cdp, allowedDomains: cdp ? null : '127.0.0.1' });
  if (shouldCloseClient) {
    await client.init();
  }

  let observedQuery = null;
  let totalMain = 0;
  let totalPreprints = 0;
  let queryExecuted = true;
  let queryMessage = 'None';
  let controlStatus = 'NOT FOUND';
  let indexedStatus = 'UNCLEAR';
  let exportSuccess = false;
  let exportMessage = 'None';
  let exportFilePath = null;
  let lastLine = '';
  let pauseOrStopReason = null;

  try {
    // -------------------------------------------------------------
    // Step 1: Open / Select Tab & Navigate to Advanced Search
    // -------------------------------------------------------------
    let entrySnapText = '';

    if (tab) {
      // Priority 1 · Require Selected Tab: unique match required, stop on missing or ambiguous
      const tabListRes = await client.callTool('agent_browser_tab_list', { session });
      const tabs = tabListRes.raw?.structuredContent?.response?.data?.tabs || [];
      const tabTarget = String(tab).trim();
      const tabLower = tabTarget.toLowerCase();

      const matchedTabs = tabs.filter(t =>
        (t.title && t.title.toLowerCase().includes(tabLower)) ||
        (t.url && t.url.toLowerCase().includes(tabLower)) ||
        t.tabId === tabTarget ||
        t.targetId === tabTarget
      );

      if (matchedTabs.length === 0) {
        pauseOrStopReason = `TAB NOT FOUND: No browser tab matching pattern '${tabTarget}' was found in session`;
        lastLine = `TAB ERROR: Tab not found matching pattern '${tabTarget}' in session.`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }

      if (matchedTabs.length > 1) {
        pauseOrStopReason = `TAB AMBIGUOUS: Ambiguous tab selection: Found ${matchedTabs.length} tabs matching pattern '${tabTarget}'`;
        lastLine = `TAB ERROR: Ambiguous tab selection: Found ${matchedTabs.length} tabs matching pattern '${tabTarget}'. Unique match required.`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }

      // Exactly 1 unique match found -> Switch to target tab
      const targetTab = matchedTabs[0];
      const targetTabId = targetTab.tabId || targetTab.targetId;
      const targetTargetId = targetTab.targetId;
      const targetUrl = targetTab.url;

      // Check tab_switch result for tool errors
      const switchRes = await client.callTool('agent_browser_tab_switch', { tab: targetTabId, session });
      if (switchRes.raw?.isError || switchRes.raw?.structuredContent?.response?.success === false || switchRes.raw?.structuredContent?.response?.error) {
        const errorDetail = switchRes.raw?.structuredContent?.response?.error || switchRes.text || 'tab_switch error';
        pauseOrStopReason = `TAB SWITCH FAILED: ${errorDetail}`;
        lastLine = `TAB ERROR: Tab switch failed for pattern '${tabTarget}': ${errorDetail}`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }

      // Re-read active tab after switching and verify exact target ID and URL before typing/clicking
      const postSwitchTabsRes = await client.callTool('agent_browser_tab_list', { session });
      const postTabs = postSwitchTabsRes.raw?.structuredContent?.response?.data?.tabs || [];
      const activeTab = postTabs.find(t => t.active);

      if (!activeTab) {
        pauseOrStopReason = `TAB NOT VERIFIED: Unable to identify active tab after switching to '${tabTarget}'`;
        lastLine = `TAB ERROR: Unable to verify active tab after switching to '${tabTarget}'. Stopping before search.`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }

      if (targetTargetId && activeTab.targetId && activeTab.targetId !== targetTargetId) {
        pauseOrStopReason = `TAB TARGET MISMATCH: Active tab target ID '${activeTab.targetId}' differs from selected target ID '${targetTargetId}'`;
        lastLine = `TAB ERROR: Active tab target ID '${activeTab.targetId}' differs from selected target ID '${targetTargetId}'. Stopping before search.`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }

      if (targetUrl && activeTab.url && activeTab.url !== targetUrl) {
        pauseOrStopReason = `TAB URL MISMATCH: Active tab URL '${activeTab.url}' differs from selected tab URL '${targetUrl}'`;
        lastLine = `TAB ERROR: Active tab URL '${activeTab.url}' differs from selected tab URL '${targetUrl}'. Stopping before search.`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }

      const snap = await client.callTool('agent_browser_snapshot', { session });
      entrySnapText = snap.text;
    } else {
      // User-provided library or Scopus link
      await client.callTool('agent_browser_open', { url: baseUrl, session });
      const snap = await client.callTool('agent_browser_snapshot', { session });
      entrySnapText = snap.text;
    }

    // Check for simulated login or bot challenge
    if (entrySnapText.includes('Institutional Sign-In Required') || entrySnapText.includes('Sign in to access') || entrySnapText.includes('Authentication pending')) {
      pauseOrStopReason = 'PAUSED: Institutional sign-in required (RTU / Elsevier)';
      lastLine = `PAUSED: Workflow paused. User must complete institutional sign-in at ${baseUrl} before continuing.`;
      return buildReport({
        block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
        totalMain: 0, totalPreprints: 0, queryExecuted: false,
        queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
        exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
      });
    }

    if (entrySnapText.includes('Unusual traffic detected') || entrySnapText.includes('Bot challenge')) {
      pauseOrStopReason = 'STOPPED: Bot challenge / unusual traffic warning encountered';
      lastLine = 'STOPPED: Bot challenge encountered. Automation halted to respect website protection policies.';
      return buildReport({
        block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
        totalMain: 0, totalPreprints: 0, queryExecuted: false,
        queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
        exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
      });
    }

    // Navigate to Advanced Document Search if not already there
    const isOnAdvanced = entrySnapText.includes('Enter query string:') || (entrySnapText.includes('query-input') && !entrySnapText.includes('results-heading'));
    if (!isOnAdvanced) {
      let advRef = findRef(entrySnapText, /link "Advanced document search"/i) ||
        findRef(entrySnapText, /tab "Advanced document search"/i) ||
        findRef(entrySnapText, /Advanced document search/i);

      if (advRef) {
        await client.callTool('agent_browser_click', { selector: advRef, session });
      } else {
        await client.callTool('agent_browser_open', { url: `${baseUrl}/scopus/advanced`, session });
      }
    }

    // Snapshot Advanced Search page to locate query input and search button
    let advSnap = await client.callTool('agent_browser_snapshot', { session });
    for (let attempt = 0; attempt < 10; attempt++) {
      if (advSnap.text.includes('Enter query string:') || advSnap.text.includes('query-input')) {
        break;
      }
      await new Promise(r => setTimeout(r, 150));
      advSnap = await client.callTool('agent_browser_snapshot', { session });
    }

    const queryInputRef = findRef(advSnap.text, /textbox ".*query.*"/i) ||
      findRef(advSnap.text, /textbox "Enter query string:"/i) ||
      findRef(advSnap.text, /query-input/i) ||
      '#query-input';

    const searchBtnRef = findRef(advSnap.text, /button "Search"(\s*\[|$)/i) ||
      findRef(advSnap.text, /search-btn/i) ||
      '#search-btn';

    // Enter query exactly as supplied - apply no filters or sort changes
    await client.callTool('agent_browser_fill', { selector: queryInputRef, text: submittedQuery, session });
    await client.callTool('agent_browser_click', { selector: searchBtnRef, session });

    // Snapshot Results / Error Page (poll briefly to ensure navigation completes)
    let resultsSnap = await client.callTool('agent_browser_snapshot', { session });
    for (let attempt = 0; attempt < 10; attempt++) {
      if (resultsSnap.text.includes('document results') || resultsSnap.text.includes('Syntax error') || resultsSnap.text.includes('error in query') || resultsSnap.text.includes('No documents found')) {
        break;
      }
      await new Promise(r => setTimeout(r, 150));
      resultsSnap = await client.callTool('agent_browser_snapshot', { session });
    }

    // Check if database rejected or reported syntax error
    if (resultsSnap.text.includes('Syntax error') || resultsSnap.text.includes('error in query') || resultsSnap.text.includes('Edit query string:')) {
      queryExecuted = false;
      const errorMatch = resultsSnap.text.match(/Syntax error[^\n]+/i);
      let cleanMsg = errorMatch ? errorMatch[0].replace(/\[ref=e\d+\]|\[level=\d+\]|"/g, '').trim() : 'Syntax error in query: Search was not executed.';
      queryMessage = `NOT EXECUTED: ${cleanMsg}`;
      lastLine = `NOT EXECUTED: Query rejected by database with message '${cleanMsg}'.`;
      return buildReport({
        block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
        totalMain: 0, totalPreprints: 0, queryExecuted: false,
        queryMessage, controlStatus: 'NOT FOUND', indexedStatus: 'UNCLEAR',
        exportSuccess: false, exportMessage: queryMessage, exportFilePath: null, lastLine
      });
    }

    // Extract observed query from DOM element (#query-executed)
    try {
      const evalRes = await client.callTool('agent_browser_eval', {
        script: '(() => { const el = document.getElementById("query-executed"); return el ? el.innerText.trim() : null; })()',
        session
      });
      if (evalRes && evalRes.raw?.structuredContent?.response?.data?.result) {
        observedQuery = evalRes.raw.structuredContent.response.data.result;
      } else if (evalRes.text && evalRes.text !== 'null') {
        try {
          const parsed = JSON.parse(evalRes.text);
          if (parsed !== null) observedQuery = parsed;
        } catch (e) {
          observedQuery = evalRes.text.trim();
        }
      }
    } catch (e) { }

    // Fallback regex extraction from snapshot if eval was null
    if (!observedQuery) {
      const execMatch = resultsSnap.text.match(/(?:Query as executed|executed query string|query-executed)[^"]*?"([^"]+)"/i);
      if (execMatch) {
        observedQuery = execMatch[1].trim();
      }
    }

    // 1. Check if query display is missing entirely -> UNCLEAR
    if (!observedQuery) {
      queryExecuted = false;
      queryMessage = 'UNCLEAR: Query display missing entirely from database results page';
      lastLine = 'UNCLEAR: Query display was not found on results page. Workflow stopped before export.';
      return buildReport({
        block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
        totalMain: 0, totalPreprints: 0, queryExecuted: false,
        queryMessage, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
        exportSuccess: false, exportMessage: queryMessage, exportFilePath: null, lastLine
      });
    }

    // 2. Check if database silently rewrote query -> NOT EXECUTED
    if (normalizeQuery(observedQuery) !== normalizeQuery(submittedQuery)) {
      queryExecuted = false;
      queryMessage = `NOT EXECUTED: Database rewrote query to '${observedQuery}'`;
      lastLine = `NOT EXECUTED: Database silently rewrote submitted query. Rewritten query: '${observedQuery}'. Workflow stopped before export.`;
      return buildReport({
        block, claim, query: submittedQuery, observedQuery, control, exportFile, searchDate,
        totalMain: 0, totalPreprints: 0, queryExecuted: false,
        queryMessage, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
        exportSuccess: false, exportMessage: queryMessage, exportFilePath: null, lastLine
      });
    }

    // Record total document count
    const totalMatch = resultsSnap.text.match(/(\d+)\s+document results/i) ||
      resultsSnap.text.match(/total-results[^>]*>(\d+)/i) ||
      resultsSnap.text.match(/Documents \((\d+)\)/i);
    if (totalMatch) {
      totalMain = parseInt(totalMatch[1], 10);
    }

    // -------------------------------------------------------------
    // Step 2: Record Preprints Count (Keep Separate From Main & Export)
    // -------------------------------------------------------------
    const preprintMatch = resultsSnap.text.match(/Preprints\s*\((?:<[^>]+>)?(\d+)/i) ||
      resultsSnap.text.match(/preprints-count[^>]*>(\d+)/i);
    if (preprintMatch) {
      totalPreprints = parseInt(preprintMatch[1], 10);
    }

    // -------------------------------------------------------------
    // Step 3: Search Within Results for Control Title & Clear Filter
    // -------------------------------------------------------------
    if (control && totalMain > 0) {
      const withinInputRef = findRef(resultsSnap.text, /textbox "Search within.*"/i) ||
        findRef(resultsSnap.text, /search-within-input/i) ||
        '#search-within-input';

      const withinBtnRef = findRef(resultsSnap.text, /button "Search within"/i) ||
        findRef(resultsSnap.text, /Search within/i) ||
        '#search-within-btn';

      if (withinInputRef && withinBtnRef) {
        await client.callTool('agent_browser_fill', { selector: withinInputRef, text: `"${control}"`, session });
        await client.callTool('agent_browser_click', { selector: withinBtnRef, session });

        // Snapshot search-within results (poll briefly to ensure navigation completes)
        let withinSnap = await client.callTool('agent_browser_snapshot', { session });
        for (let attempt = 0; attempt < 10; attempt++) {
          if (withinSnap.text.includes('Clear filter') || withinSnap.text.includes('No documents found') || withinSnap.text.includes('document results')) {
            break;
          }
          await new Promise(r => setTimeout(r, 150));
          withinSnap = await client.callTool('agent_browser_snapshot', { session });
        }

        // Check if results count in heading is >= 1 and does not report no documents found
        const countMatch = withinSnap.text.match(/(\d+)\s+document results/i);
        const withinCount = countMatch ? parseInt(countMatch[1], 10) : 0;
        const hasNoResults = withinSnap.text.includes('No documents found') || withinCount === 0;

        if (!hasNoResults && withinCount > 0) {
          controlStatus = 'FOUND';
          indexedStatus = 'INDEXED';
        } else {
          controlStatus = 'NOT FOUND';
        }

        // CRITICAL: Clear search-within filter before export and verify results restored
        let clearFilterRef = findRef(withinSnap.text, /link "Clear filter"/i) ||
          findRef(withinSnap.text, /Clear filter/i);

        if (clearFilterRef) {
          await client.callTool('agent_browser_click', { selector: clearFilterRef, session });
        } else {
          // Direct navigation back to original search query
          await client.callTool('agent_browser_open', {
            url: `${baseUrl}/scopus/advanced?q=${encodeURIComponent(submittedQuery)}`,
            session
          });
        }

        // Verify that results count is restored to full main results count (poll briefly)
        let restoredSnap = await client.callTool('agent_browser_snapshot', { session });
        for (let attempt = 0; attempt < 10; attempt++) {
          const restoredCountMatch = restoredSnap.text.match(/(\d+)\s+document results/i);
          const restoredCount = restoredCountMatch ? parseInt(restoredCountMatch[1], 10) : 0;
          if (restoredCount === totalMain) {
            break;
          }
          await new Promise(r => setTimeout(r, 150));
          restoredSnap = await client.callTool('agent_browser_snapshot', { session });
        }
        const restoredCountMatch = restoredSnap.text.match(/(\d+)\s+document results/i);
        const restoredCount = restoredCountMatch ? parseInt(restoredCountMatch[1], 10) : 0;

        if (restoredCount !== totalMain) {
          exportSuccess = false;
          exportMessage = `FILTER CLEAR FAILED: Results count was ${restoredCount}, expected full count of ${totalMain} before export`;
          lastLine = `EXPORT ISSUE: Search-within filter could not be cleared; expected ${totalMain} main results, but observed ${restoredCount}.`;
          return buildReport({
            block, claim, query: submittedQuery, observedQuery, control, exportFile, searchDate,
            totalMain, totalPreprints, queryExecuted: true,
            queryMessage: 'None', controlStatus, indexedStatus,
            exportSuccess: false, exportMessage, exportFilePath: null, lastLine
          });
        }
      }
    }

    // If control was NOT found in block results, test if indexed on its own
    if (control && controlStatus === 'NOT FOUND') {
      const titleQuery = `TITLE ( "${control}" )`;
      await client.callTool('agent_browser_open', { url: `${baseUrl}/scopus/advanced`, session });

      const advSnap2 = await client.callTool('agent_browser_snapshot', { session });
      const queryInputRef2 = findRef(advSnap2.text, /textbox/i) || '#query-input';
      const searchBtnRef2 = findRef(advSnap2.text, /button "Search"/i) || '#search-btn';

      await client.callTool('agent_browser_fill', { selector: queryInputRef2, text: titleQuery, session });
      await client.callTool('agent_browser_click', { selector: searchBtnRef2, session });

      let titleResultsSnap = await client.callTool('agent_browser_snapshot', { session });
      for (let attempt = 0; attempt < 10; attempt++) {
        if (titleResultsSnap.text.includes('document results') || titleResultsSnap.text.includes('No documents found')) {
          break;
        }
        await new Promise(r => setTimeout(r, 150));
        titleResultsSnap = await client.callTool('agent_browser_snapshot', { session });
      }
      const countMatch2 = titleResultsSnap.text.match(/(\d+)\s+document results/i);
      const titleCount = countMatch2 ? parseInt(countMatch2[1], 10) : 0;
      const hasNoTitleResults = titleResultsSnap.text.includes('No documents found') || titleCount === 0;

      if (!hasNoTitleResults && titleCount > 0) {
        indexedStatus = 'INDEXED'; // Missed by block, but confirmed indexed
      } else {
        indexedStatus = 'NOT INDEXED';
      }

      // Restore full block results view
      await client.callTool('agent_browser_open', {
        url: `${baseUrl}/scopus/advanced?q=${encodeURIComponent(submittedQuery)}`,
        session
      });
    }

    // -------------------------------------------------------------
    // Step 4: Export Main Results as CSV via Fresh Browser Download
    // -------------------------------------------------------------
    if (totalMain > 0) {
      const preExportSnap = await client.callTool('agent_browser_snapshot', { session });
      const exportBtnRef = findRef(preExportSnap.text, /button "Export.*"/i) ||
        findRef(preExportSnap.text, /Export/i) ||
        '#export-btn';

      await client.callTool('agent_browser_click', { selector: exportBtnRef, session });

      // Inspect export modal
      const modalSnap = await client.callTool('agent_browser_snapshot', { session });

      const confirmBtnRef = simulateExportFail
        ? (findRef(modalSnap.text, /button "Simulate Export Failure"/i) || '#simulate-fail-btn')
        : (findRef(modalSnap.text, /button "Confirm Export"/i) || '#confirm-export-btn');

      // Generate attempt-identifying filename to ensure fresh download identification
      // and preserve any same-named files in Downloads and exports folders
      const attemptId = crypto.randomBytes(4).toString('hex');
      const baseName = path.basename(exportFile, '.csv');
      const attemptFilename = `${baseName}.attempt-${attemptId}.csv`;

      // Set target filename in modal to attempt-identifying filename
      const filenameRef = findRef(modalSnap.text, /textbox.*Target file name/i) ||
        findRef(modalSnap.text, /export-filename/i) ||
        '#export-filename';
      if (filenameRef) {
        await client.callTool('agent_browser_fill', { selector: filenameRef, text: attemptFilename, session });
      }

      // Search candidate download directories: user-specified downloadsDir and default OS Downloads
      const defaultDownloadsDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads');
      const candidateDirs = Array.from(new Set([
        downloadsDir,
        defaultDownloadsDir
      ].filter(d => d && fs.existsSync(d))));

      // Snapshot existing files across all candidate download dirs before attempt (NEVER delete existing files)
      const existingDownloadsBefore = new Map();
      for (const dir of candidateDirs) {
        existingDownloadsBefore.set(dir, new Set(fs.readdirSync(dir)));
      }

      const attemptStartTime = Date.now();

      // Click export button (attempt evidence)
      await client.callTool('agent_browser_click', { selector: confirmBtnRef, session });

      // Bounded wait polling candidate download dirs for the attempt's fresh download
      let freshDownloadPath = null;
      const pollInterval = 150;
      const maxWait = downloadTimeoutMs;
      const startWait = Date.now();

      while (Date.now() - startWait < maxWait) {
        for (const dir of candidateDirs) {
          // 1. Check for attempt-specific filename
          const candidateAttempt = path.join(dir, attemptFilename);
          if (fs.existsSync(candidateAttempt)) {
            try {
              const stat = fs.statSync(candidateAttempt);
              if (stat.size > 0 && stat.mtimeMs >= attemptStartTime - 1000) {
                freshDownloadPath = candidateAttempt;
                break;
              }
            } catch (e) {}
          }

          // 2. Also check for any new file created in candidate dir that was NOT in before snapshot
          const beforeSet = existingDownloadsBefore.get(dir) || new Set();
          const currentFiles = fs.readdirSync(dir);
          for (const file of currentFiles) {
            if (!beforeSet.has(file) && !file.endsWith('.crdownload') && !file.endsWith('.tmp')) {
              // Strictly match attemptFilename or baseName with attemptId (never broad prefixes like 'scopus')
              if (file === attemptFilename || (file.startsWith(baseName) && file.includes(attemptId))) {
                const fullP = path.join(dir, file);
                try {
                  const stat = fs.statSync(fullP);
                  if (stat.size > 0 && stat.mtimeMs >= attemptStartTime - 1000) {
                    freshDownloadPath = fullP;
                    break;
                  }
                } catch (e) {}
              }
            }
          }
          if (freshDownloadPath) break;
        }
        if (freshDownloadPath) break;
        await new Promise(r => setTimeout(r, pollInterval));
      }

      const targetFilePath = path.join(outputDir, exportFile);

      if (!freshDownloadPath || simulateExportFail) {
        exportSuccess = false;
        exportMessage = 'EXPORT FAILED: Fresh browser download never arrived within bounded wait timeout';
        // Note: targetFilePath in outputDir and existing files in downloadsDir remain 100% UNTOUCHED
      } else {
        // Validate the downloaded CSV BEFORE placing it at its final destination
        try {
          const rawContent = fs.readFileSync(freshDownloadPath, 'utf8');
          const parsedRows = parseCsv(rawContent);

          if (parsedRows.length < 2) {
            exportSuccess = false;
            exportMessage = 'EXPORT INCOMPLETE: CSV file contains no document rows';
          } else {
            const headerRow = parsedRows[0].map(h => h.trim().toLowerCase());
            const hasAuthors = headerRow.some(h => h.includes('authors'));
            const hasTitle = headerRow.some(h => h.includes('title'));
            const hasYear = headerRow.some(h => h.includes('year'));
            const hasSource = headerRow.some(h => h.includes('source'));
            const hasDoi = headerRow.some(h => h.includes('doi'));
            const hasAbstract = headerRow.some(h => h.includes('abstract'));
            const hasKeywords = headerRow.some(h => h.includes('keyword'));

            if (!hasAuthors || !hasTitle || !hasYear || !hasSource || !hasDoi || !hasAbstract || !hasKeywords) {
              exportSuccess = false;
              exportMessage = 'EXPORT INCOMPLETE: Downloaded CSV is missing required citation, abstract, or keyword columns';
            } else {
              const recordCount = parsedRows.length - 1; // subtract header
              if (recordCount !== totalMain) {
                exportSuccess = false;
                exportMessage = `EXPORT INCOMPLETE: Expected ${totalMain} records, but file contains ${recordCount}`;
              } else {
                // Validation passed! Safely place at final destination in outputDir
                // Preserve pre-existing files byte-for-byte; assign unique candidate if collision occurs
                let placedPath = targetFilePath;
                let finalExportFilename = exportFile;
                let isRenamed = false;

                if (fs.existsSync(targetFilePath)) {
                  isRenamed = true;
                  let counter = 1;
                  const ext = path.extname(exportFile);
                  const base = path.basename(exportFile, ext);
                  while (true) {
                    const candidateName = `${base} (${counter})${ext}`;
                    const candidatePath = path.join(outputDir, candidateName);
                    try {
                      fs.copyFileSync(freshDownloadPath, candidatePath, fs.constants.COPYFILE_EXCL);
                      placedPath = candidatePath;
                      finalExportFilename = candidateName;
                      break;
                    } catch (err) {
                      if (err.code === 'EEXIST') {
                        counter++;
                        continue;
                      }
                      throw err;
                    }
                  }
                } else {
                  try {
                    fs.copyFileSync(freshDownloadPath, targetFilePath, fs.constants.COPYFILE_EXCL);
                    placedPath = targetFilePath;
                  } catch (err) {
                    if (err.code === 'EEXIST') {
                      isRenamed = true;
                      let counter = 1;
                      const ext = path.extname(exportFile);
                      const base = path.basename(exportFile, ext);
                      while (true) {
                        const candidateName = `${base} (${counter})${ext}`;
                        const candidatePath = path.join(outputDir, candidateName);
                        try {
                          fs.copyFileSync(freshDownloadPath, candidatePath, fs.constants.COPYFILE_EXCL);
                          placedPath = candidatePath;
                          finalExportFilename = candidateName;
                          break;
                        } catch (copyErr) {
                          if (copyErr.code === 'EEXIST') {
                            counter++;
                            continue;
                          }
                          throw copyErr;
                        }
                      }
                    } else {
                      throw err;
                    }
                  }
                }

                exportSuccess = true;
                exportFilePath = placedPath;
                exportMessage = isRenamed
                  ? `NOTE: Pre-existing '${exportFile}' preserved byte-for-byte; saved as '${finalExportFilename}'`
                  : 'None';
              }
            }
          }
        } catch (parseErr) {
          exportSuccess = false;
          exportMessage = `EXPORT ERROR: Failed parsing downloaded file: ${parseErr.message}`;
        } finally {
          // Clean up only our own attempt-identifying file from downloadsDir, leaving user files untouched
          try {
            if (freshDownloadPath && freshDownloadPath.includes(attemptId) && fs.existsSync(freshDownloadPath)) {
              fs.unlinkSync(freshDownloadPath);
            }
          } catch (e) {}
        }
      }
    }

    // -------------------------------------------------------------
    // Step 5: Formulate Last Line Summary
    // -------------------------------------------------------------
    const placedRel = exportFilePath ? path.relative(__dirname, exportFilePath) : exportFile;
    const renameNote = (exportMessage && exportMessage.includes('Pre-existing'))
      ? ` (Saved as ${path.basename(exportFilePath)} because ${exportFile} already exists; existing file preserved byte-for-byte).`
      : '';

    if (!exportSuccess) {
      lastLine = `EXPORT ISSUE: ${exportMessage}`;
    } else if (controlStatus === 'NOT FOUND' && indexedStatus === 'INDEXED') {
      lastLine = `DEVIATION: Control paper '${control}' missed by block query, but confirmed indexed in database. Exported ${totalMain} main records to ${placedRel}.${renameNote}`;
    } else if (controlStatus === 'FOUND') {
      lastLine = `OK: ${totalMain} main records exported to ${placedRel}; control paper confirmed in block; ${totalPreprints} preprint excluded.${renameNote}`;
    } else {
      lastLine = `OK: ${totalMain} records exported; control paper status: ${controlStatus}/${indexedStatus}.${renameNote}`;
    }

  } catch (err) {
    lastLine = `ERROR: Automation error during workflow execution: ${err.message}`;
  } finally {
    try {
      // Do not close browser if attaching to an existing tab or CDP instance,
      // confirming unrelated tabs stay open
      if (!tab && !cdp) {
        await client.callTool('agent_browser_close', { session });
      }
    } catch (e) { }
    if (shouldCloseClient) {
      await client.close();
    }
  }

  return buildReport({
    block, claim, query: submittedQuery, observedQuery: observedQuery || 'None',
    control, exportFile, searchDate,
    totalMain, totalPreprints, queryExecuted, queryMessage,
    controlStatus, indexedStatus, exportSuccess, exportMessage, exportFilePath, lastLine
  });
}

function buildReport(data) {
  const relPath = data.exportFilePath ? path.relative(__dirname, data.exportFilePath).replace(/\\/g, '/') : 'None';

  const searchRows = [
    `Scopus | ${data.block} | MAIN | ${data.query} | None | ${data.totalMain} | ${data.searchDate} | ${relPath} | ${data.queryMessage !== 'None' ? data.queryMessage : (data.exportSuccess ? 'None' : data.exportMessage)}`,
    `Scopus | ${data.block} | PREPRINTS | ${data.query} | None | ${data.totalPreprints} | ${data.searchDate} | None | Excluded from main count and export`
  ];

  const controlRows = [
    `Scopus | ${data.block} | ${data.control} | ${data.controlStatus} | ${data.indexedStatus}`
  ];

  const reportText = `SEARCH ROWS
SITE | BLOCK | ROW TYPE | STRING AS EXECUTED | FILTERS | TOTAL | DATE | FILE | MESSAGES
${searchRows.join('\n')}

CONTROL ROWS
SITE | BLOCK | TITLE | FOUND / NOT FOUND / UNCLEAR | INDEXED / NOT INDEXED / UNCLEAR
${controlRows.join('\n')}

LAST LINE
${data.lastLine}`;

  return {
    ...data,
    reportText,
    searchRows,
    controlRows
  };
}

/**
 * Verifies CDP attachment and target tab selection without executing a search or export.
 * Returns verified attachment evidence (endpoint, targetTab, activeTab, snapshot preview).
 */
export async function verifyCdpAttachment(opts = {}) {
  const {
    cdp = 9222,
    tab = null,
    session = 'cdp-attach-' + crypto.randomBytes(3).toString('hex')
  } = opts;

  const endpointCheck = await validateCdpEndpoint(cdp);
  if (!endpointCheck.valid) {
    return { ok: false, error: `ATTACHMENT ERROR: ${endpointCheck.error}` };
  }

  if (!tab) {
    return { ok: false, error: 'ATTACHMENT ERROR: A target tab pattern (--tab <pattern>) is required when attaching to external Chrome via CDP.' };
  }

  const client = opts.client || createMcpClient({ cdp, allowedDomains: null });
  const shouldCloseClient = !opts.client;

  try {
    if (shouldCloseClient) {
      await client.init();
    }

    const tabListRes = await client.callTool('agent_browser_tab_list', { session });
    const tabs = tabListRes.raw?.structuredContent?.response?.data?.tabs || [];
    const tabTarget = String(tab).trim();
    const tabLower = tabTarget.toLowerCase();

    const matchedTabs = tabs.filter(t =>
      (t.title && t.title.toLowerCase().includes(tabLower)) ||
      (t.url && t.url.toLowerCase().includes(tabLower)) ||
      t.tabId === tabTarget ||
      t.targetId === tabTarget
    );

    if (matchedTabs.length === 0) {
      return { ok: false, error: `TAB ERROR: Tab not found matching pattern '${tabTarget}' in session.` };
    }

    if (matchedTabs.length > 1) {
      return { ok: false, error: `TAB ERROR: Ambiguous tab selection: Found ${matchedTabs.length} tabs matching pattern '${tabTarget}'. Unique match required.` };
    }

    const targetTab = matchedTabs[0];
    const targetTabId = targetTab.tabId || targetTab.targetId;
    const switchRes = await client.callTool('agent_browser_tab_switch', { tab: targetTabId, session });

    if (switchRes.raw?.isError || switchRes.raw?.structuredContent?.response?.success === false || switchRes.raw?.structuredContent?.response?.error) {
      const errorDetail = switchRes.raw?.structuredContent?.response?.error || switchRes.text || 'tab_switch error';
      return { ok: false, error: `TAB ERROR: Tab switch failed for pattern '${tabTarget}': ${errorDetail}` };
    }

    const postSwitchTabsRes = await client.callTool('agent_browser_tab_list', { session });
    const postTabs = postSwitchTabsRes.raw?.structuredContent?.response?.data?.tabs || [];
    const activeTab = postTabs.find(t => t.active);

    if (!activeTab) {
      return { ok: false, error: `TAB ERROR: Unable to verify active tab after switching to '${tabTarget}'.` };
    }

    if (targetTab.targetId && activeTab.targetId && activeTab.targetId !== targetTab.targetId) {
      return { ok: false, error: `TAB ERROR: Active tab target ID '${activeTab.targetId}' differs from selected target ID '${targetTab.targetId}'.` };
    }

    if (targetTab.url && activeTab.url && activeTab.url !== targetTab.url) {
      return { ok: false, error: `TAB ERROR: Active tab URL '${activeTab.url}' differs from selected tab URL '${targetTab.url}'.` };
    }

    const snap = await client.callTool('agent_browser_snapshot', { session });

    return {
      ok: true,
      endpoint: endpointCheck.endpoint,
      versionData: endpointCheck.versionData,
      targetTab,
      activeTab,
      snapshotText: snap.text,
      message: `Successfully attached to Chrome at ${endpointCheck.endpoint} and verified tab '${targetTab.title || tabTarget}'.`
    };
  } finally {
    if (shouldCloseClient) {
      await client.close();
    }
  }
}
