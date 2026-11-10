import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
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
 * Returns normalized paths for known standard shared browser User Data directories.
 * Any workflow that mutates browser-wide settings (e.g. Browser.setDownloadBehavior)
 * must never target these shared default profiles.
 */
export function getDefaultSharedChromeProfileDirs() {
  const dirs = [];
  if (process.env.LOCALAPPDATA) {
    dirs.push(
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'),
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome SxS', 'User Data'),
      path.join(process.env.LOCALAPPDATA, 'Chromium', 'User Data'),
      path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data'),
      path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data')
    );
  }
  const home = os.homedir();
  if (home) {
    dirs.push(
      path.join(home, '.config', 'google-chrome'),
      path.join(home, '.config', 'chromium'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Chromium')
    );
  }
  return Array.from(new Set(dirs.map(d => path.resolve(d))));
}

function normalizePathForCompare(p) {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Returns true if dirPath IS or lives inside a standard shared browser User Data directory
 * (e.g., Chrome/User Data or Chrome/User Data/Default).
 */
export function isSharedDefaultChromeProfileDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false;
  const target = normalizePathForCompare(dirPath);
  for (const shared of getDefaultSharedChromeProfileDirs()) {
    const normShared = normalizePathForCompare(shared);
    if (target === normShared || target.startsWith(normShared + path.sep)) {
      return true;
    }
  }
  return false;
}

function getDedicatedChromeProfileCandidates() {
  const dirs = [];
  if (process.env.NORTHBRIDGE_CHROME_PROFILE_DIR) dirs.push(process.env.NORTHBRIDGE_CHROME_PROFILE_DIR);
  if (process.env.CHROME_USER_DATA_DIR && !isSharedDefaultChromeProfileDir(process.env.CHROME_USER_DATA_DIR)) {
    dirs.push(process.env.CHROME_USER_DATA_DIR);
  }
  if (process.env.LOCALAPPDATA) {
    dirs.push(
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'ScopusProfile'),
      path.join(process.env.LOCALAPPDATA, 'Northbridge', 'ChromeProfile')
    );
  }
  return Array.from(new Set(dirs.map(d => path.resolve(d))));
}

function readDevToolsActivePort(dir) {
  try {
    const portFile = path.join(dir, 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) return null;
    const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    const port = parseInt((lines[0] || '').trim(), 10);
    return (port && port > 0 && port <= 65535) ? port : null;
  } catch {
    return null;
  }
}

/**
 * Verifies whether the attached Chrome endpoint corresponds to a dedicated Chrome profile
 * before allowing browser-wide CDP download configuration (Browser.setDownloadBehavior).
 */
export function inspectChromeProfileSafety({
  profileDir = null,
  userDataDir = null,
  endpointCheck = null,
  activeCdpPort = null
} = {}) {
  const port = activeCdpPort != null ? Number(activeCdpPort) : (endpointCheck?.port != null ? Number(endpointCheck.port) : null);
  const candidateDir = profileDir || userDataDir || endpointCheck?.profileDir || null;

  if (candidateDir) {
    const resolvedDir = path.resolve(String(candidateDir));
    if (isSharedDefaultChromeProfileDir(resolvedDir)) {
      return {
        isDedicated: false,
        reason: 'shared_default_profile',
        profileDir: resolvedDir,
        error: `DEDICATED PROFILE REQUIRED: Refusing to call Browser.setDownloadBehavior on shared Chrome profile '${resolvedDir}'. Launch Chrome with a dedicated user-data-dir (e.g. "${process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'ScopusProfile') : 'ScopusProfile'}") and pass --profile-dir.`
      };
    }

    if (port) {
      for (const sharedDir of getDefaultSharedChromeProfileDirs()) {
        const sharedPort = readDevToolsActivePort(sharedDir);
        if (sharedPort && sharedPort === port) {
          return {
            isDedicated: false,
            reason: 'shared_default_port_match',
            profileDir: sharedDir,
            error: `DEDICATED PROFILE REQUIRED: Active CDP port ${port} matches shared Chrome profile '${sharedDir}'. Refusing to alter browser-wide download settings.`
          };
        }
      }
    }

    return {
      isDedicated: true,
      reason: 'verified_dedicated_profile',
      profileDir: resolvedDir,
      error: null
    };
  }

  // No profileDir was supplied (e.g. bare --cdp <port> or anonymous port 9222 fallback):
  // check shared dirs first to block shared Chrome, then known dedicated profile dirs.
  if (port) {
    for (const sharedDir of getDefaultSharedChromeProfileDirs()) {
      const sharedPort = readDevToolsActivePort(sharedDir);
      if (sharedPort && sharedPort === port) {
        return {
          isDedicated: false,
          reason: 'shared_default_port_match',
          profileDir: sharedDir,
          error: `DEDICATED PROFILE REQUIRED: CDP port ${port} belongs to shared Chrome profile '${sharedDir}'. Use a dedicated Chrome profile directory with --profile-dir for Scopus exports.`
        };
      }
    }
    for (const dedicatedDir of getDedicatedChromeProfileCandidates()) {
      const dedPort = readDevToolsActivePort(dedicatedDir);
      if (dedPort && dedPort === port && !isSharedDefaultChromeProfileDir(dedicatedDir)) {
        return {
          isDedicated: true,
          reason: 'matched_known_dedicated_profile',
          profileDir: dedicatedDir,
          error: null
        };
      }
    }
  }

  return {
    isDedicated: false,
    reason: 'unverified_profile',
    profileDir: null,
    error: `DEDICATED PROFILE REQUIRED: Cannot verify that Chrome${port ? ` on CDP port ${port}` : ''} uses a dedicated profile. Pass --profile-dir <dedicated-dir> (or launch Chrome using the dedicated ScopusProfile) before calling Browser.setDownloadBehavior.`
  };
}

/**
 * Automatically discovers a running Chrome instance endpoint or validates an explicit CDP endpoint.
 * Does not probe port 9222 first during auto-discovery.
 * Checks candidate user data directories for DevToolsActivePort.
 *
 * @param {Object} opts
 * @param {string|number} [opts.cdp] - Explicit CDP endpoint (port or host:port)
 * @param {boolean} [opts.autoConnect] - Discover running Chrome
 * @param {string} [opts.profileDir] - User data directory to inspect
 * @param {string} [opts.userDataDir] - Alias for profileDir
 * @param {boolean} [opts.requireDedicatedProfile] - Skip shared default dirs unless reporting safety refusal
 * @returns {Promise<Object>} Discovery result { valid, host, port, endpoint, versionData, discoveredVia, error }
 */
export async function discoverChromeEndpoint(opts = {}) {
  const { cdp, autoConnect, profileDir, userDataDir, requireDedicatedProfile = false } = opts;

  // Case 1: Explicit --cdp specified
  if (cdp) {
    const check = await validateCdpEndpoint(cdp);
    if (!check.valid) return check;
    if (profileDir || userDataDir) {
      return { ...check, profileDir: path.resolve(profileDir || userDataDir) };
    }
    return check;
  }

  // Case 2: Automatic discovery (--auto-connect)
  if (autoConnect) {
    const explicitDirs = [];
    if (profileDir) explicitDirs.push(profileDir);
    if (userDataDir && userDataDir !== profileDir) explicitDirs.push(userDataDir);

    const dedicatedCandidates = getDedicatedChromeProfileCandidates();
    const sharedCandidates = getDefaultSharedChromeProfileDirs();
    const candidateDirs = explicitDirs.length > 0
      ? [...explicitDirs]
      : [...dedicatedCandidates, ...sharedCandidates];

    for (const dir of candidateDirs) {
      const port = readDevToolsActivePort(dir);
      if (port) {
        const endpointCheck = await validateCdpEndpoint(port);
        if (endpointCheck.valid) {
          if (requireDedicatedProfile && explicitDirs.length === 0 && isSharedDefaultChromeProfileDir(dir)) {
            return {
              valid: false,
              dedicatedRequired: true,
              profileDir: path.resolve(dir),
              error: `DEDICATED PROFILE REQUIRED: Discovered shared default Chrome profile '${path.resolve(dir)}' on port ${port}, but Scopus export requires a dedicated Chrome profile to safely configure Browser.setDownloadBehavior.`
            };
          }
          return { ...endpointCheck, discoveredVia: 'DevToolsActivePort', profileDir: dir };
        }
      }
    }

    if (explicitDirs.length > 0) {
      return {
        valid: false,
        error: `No active Chrome remote debugging endpoint found in specified profile directory (${explicitDirs.join(', ')}). Ensure Chrome is running on that profile with remote debugging enabled or pass --cdp <port>.`
      };
    }

    // Fallback: check standard 9222 ONLY as a last-resort fallback when no explicit profileDir was given
    try {
      const port9222Check = await validateCdpEndpoint(9222);
      if (port9222Check.valid) {
        return { ...port9222Check, discoveredVia: 'default-port-9222' };
      }
    } catch (e) {}

    return {
      valid: false,
      error: 'No running Chrome instance found with an active remote debugging endpoint. Please open Chrome with remote debugging enabled or launch a dedicated profile with --cdp <port>.'
    };
  }

  return { valid: false, error: 'No CDP endpoint or auto-connect option specified.' };
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
  const autoConnect = options.autoConnect;
  const pinTab = options.pinTab === true;
  const namespace = options.namespace;

  const args = ['mcp', '--tools', 'core'];
  if (namespace) {
    args.push('--namespace', namespace);
  }

  const env = { ...process.env };
  if (cdp) {
    env.AGENT_BROWSER_CDP = String(cdp);
    delete env.AGENT_BROWSER_ALLOWED_DOMAINS;
    delete env.AGENT_BROWSER_AUTO_CONNECT;
  } else if (autoConnect) {
    env.AGENT_BROWSER_AUTO_CONNECT = '1';
    delete env.AGENT_BROWSER_ALLOWED_DOMAINS;
    delete env.AGENT_BROWSER_CDP;
  } else {
    env.AGENT_BROWSER_ALLOWED_DOMAINS = allowedDomains;
    delete env.AGENT_BROWSER_CDP;
    delete env.AGENT_BROWSER_AUTO_CONNECT;
  }

  if (pinTab && (cdp || autoConnect)) {
    env.AGENT_BROWSER_PIN_TAB = '1';
  } else {
    delete env.AGENT_BROWSER_PIN_TAB;
  }

  const proc = spawn(binary, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env
  });

  let msgId = 0;
  const pending = new Map();
  let buffer = '';

  let transportError;
  function failTransport(error) {
    transportError = error;
    for (const { timer, reject } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }
  proc.on('error', failTransport);
  proc.stdin.on('error', failTransport);
  proc.on('exit', (code, signal) => failTransport(new Error(`MCP server exited (code: ${code}, signal: ${signal})`)));

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

  function send(method, params = {}, timeoutMs = 30000) {
    if (transportError) return Promise.reject(transportError);
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

  async function callTool(name, args = {}, timeoutMs = 30000) {
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
      try {
        if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
          spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
          if (proc.exitCode === null) proc.kill();
        }
      } catch (e) {
        proc.kill();
      }
    } catch (e) { }
  }

  return { init, callTool, close, proc };
}

/**
 * Extracts element ref from snapshot line matching a pattern.
 * Supports both simple `[ref=e12]` and multi-attribute brackets `[expanded=false, ref=e330]`.
 */
export function findRef(snapshotText, regex) {
  if (!snapshotText || typeof snapshotText !== 'string') return null;
  const lines = snapshotText.split(/\r?\n/);
  for (const line of lines) {
    if (regex.test(line)) {
      const match = line.match(/\[[^\]]*\bref=(e\d+)\b[^\]]*\]/) || line.match(/\bref=(e\d+)\b/);
      if (match) return `@${match[1]}`;
    }
  }
  return null;
}

/**
 * Checks if an MCP tool response indicates the bound tab is gone/closed under --pin-tab
 */
export function isTabGone(res) {
  if (!res) return false;
  if (res.raw?.structuredContent?.response?.code === 'tab_gone') return true;
  if (res.text && res.text.includes('tab_gone: bound tab is gone')) return true;
  return false;
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
 * @param {boolean} [opts.autoConnect] - Connect to already-open running Chrome instance
 * @param {boolean} [opts.approved] - Explicit user approval for attaching to open browser
 * @param {boolean} [opts.pinTab] - Enforce tab pinning so actions stay strictly on selected tab
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
    autoConnect = false,
    approved = true,
    pinTab = false,
    downloadsDir = process.env.AGENT_BROWSER_DOWNLOAD_PATH || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads'),
    downloadTimeoutMs = 6000,
    simulateExportFail = false
  } = opts;

  const searchDate = new Date().toISOString().slice(0, 10);
  const submittedQuery = (query || '').trim();

  // Validate user approval if connecting to open browser
  if (approved === false) {
    const errorMsg = 'APPROVAL ERROR: Browser connection denied by user. Halting automation before accessing open browser.';
    return buildReport({
      block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
      totalMain: 0, totalPreprints: 0, queryExecuted: false,
      queryMessage: errorMsg, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
      exportSuccess: false, exportMessage: errorMsg, exportFilePath: null,
      lastLine: errorMsg
    });
  }

  if (autoConnect && approved !== true) {
    const errorMsg = 'APPROVAL ERROR: User approval required to attach to open browser session. Pass approved: true or --approved to proceed.';
    return buildReport({
      block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
      totalMain: 0, totalPreprints: 0, queryExecuted: false,
      queryMessage: errorMsg, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
      exportSuccess: false, exportMessage: errorMsg, exportFilePath: null,
      lastLine: errorMsg
    });
  }

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

  // Validate CDP/autoConnect endpoint if specified (loopback enforcement & availability probe)
  let activeCdpPort = cdp;
  if (cdp || autoConnect) {
    const endpointCheck = await discoverChromeEndpoint({
      cdp,
      autoConnect,
      profileDir: opts.profileDir || opts.userDataDir
    });
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
    activeCdpPort = endpointCheck.port;

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
  const client = opts.client || createMcpClient({
    cdp: activeCdpPort,
    autoConnect: Boolean(autoConnect),
    pinTab: Boolean(pinTab),
    allowedDomains: (activeCdpPort || autoConnect) ? null : '127.0.0.1',
    namespace: opts.namespace
  });
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
  let pendingAttemptFile = null;
  let pendingAttemptToken = null;

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
      const targetTabId = targetTab.targetId || targetTab.tabId;
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
      const activeTab = postTabs.find(t => t.targetId === targetTargetId && t.active) ||
                        (postTabs.some(t => t.targetId === targetTargetId) ? postTabs.find(t => t.targetId === targetTargetId) : postTabs.find(t => t.active));

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
      if (isTabGone(snap)) {
        pauseOrStopReason = `TAB GONE: Bound tab is gone or closed: ${snap.text}`;
        lastLine = `TAB ERROR: Bound tab is gone or closed: ${snap.text}`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }
      entrySnapText = snap.text;
    } else {
      // User-provided library or Scopus link
      await client.callTool('agent_browser_open', { url: baseUrl, session });
      const snap = await client.callTool('agent_browser_snapshot', { session });
      if (isTabGone(snap)) {
        pauseOrStopReason = `TAB GONE: Bound tab is gone or closed: ${snap.text}`;
        lastLine = `TAB ERROR: Bound tab is gone or closed: ${snap.text}`;
        return buildReport({
          block, claim, query: submittedQuery, observedQuery: 'None', control, exportFile, searchDate,
          totalMain: 0, totalPreprints: 0, queryExecuted: false,
          queryMessage: pauseOrStopReason, controlStatus: 'UNCLEAR', indexedStatus: 'UNCLEAR',
          exportSuccess: false, exportMessage: pauseOrStopReason, exportFilePath: null, lastLine
        });
      }
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
      let advRef = findRef(entrySnapText, /link "Edit query"/i) ||
        findRef(entrySnapText, /button "Edit query"/i) ||
        findRef(entrySnapText, /Edit query/i) ||
        findRef(entrySnapText, /link "Advanced document search"/i) ||
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
      } else if (evalRes && !evalRes.raw?.isError && evalRes.text && evalRes.text.trim() !== 'null' && evalRes.text.trim() !== '') {
        try {
          const parsed = JSON.parse(evalRes.text);
          if (parsed !== null && parsed !== undefined && String(parsed).trim() !== 'null') {
            observedQuery = String(parsed);
          }
        } catch (e) {
          if (evalRes.text.trim() !== 'null') {
            observedQuery = evalRes.text.trim();
          }
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
        ...(process.env.AGENT_BROWSER_DOWNLOAD_PATH ? [] : [defaultDownloadsDir])
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
        // Give Chrome/Windows a short settle window to finish Zone.Identifier / DownloadItem finalization before read/cleanup
        await new Promise(r => setTimeout(r, 250));
        pendingAttemptFile = freshDownloadPath;
        pendingAttemptToken = attemptId;
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
          const cleanupAttemptTarget = async () => {
            if (!freshDownloadPath || !freshDownloadPath.includes(attemptId)) return;
            for (let pass = 0; pass < 3; pass++) {
              try {
                if (fs.existsSync(freshDownloadPath)) {
                  await fs.promises.rm(freshDownloadPath, { force: true, maxRetries: 10, retryDelay: 200 });
                }
              } catch (e) {
                if (pass === 2) {
                  console.warn(`[scopus-workflow] Deferred cleanup for ${path.basename(freshDownloadPath)}: ${e.code || e.message}`);
                }
              }
              await new Promise(r => setTimeout(r, 150));
              if (!fs.existsSync(freshDownloadPath)) break;
            }
          };
          await cleanupAttemptTarget();
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
    queryExecuted = false;
    exportSuccess = false;
    lastLine = `ERROR: Automation error during workflow execution: ${err.message}`;
  } finally {
    if (shouldCloseClient) {
      try {
        await client.callTool('agent_browser_close', { session }, 4000);
      } catch (e) { }
      await client.close();
    }
    if (pendingAttemptFile && pendingAttemptToken && pendingAttemptFile.includes(pendingAttemptToken)) {
      try {
        if (fs.existsSync(pendingAttemptFile)) {
          await fs.promises.rm(pendingAttemptFile, { force: true, maxRetries: 12, retryDelay: 250 });
        }
      } catch (e) {
        console.warn(`[scopus-workflow] Post-close attempt cleanup failed for ${path.basename(pendingAttemptFile)}: ${e.code || e.message}`);
      }
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
    cdp = null,
    autoConnect = false,
    profileDir = null,
    userDataDir = null,
    approved = true,
    pinTab = false,
    tab = null,
    session = 'cdp-attach-' + crypto.randomBytes(3).toString('hex'),
    namespace = null
  } = opts;

  if (approved === false) {
    return { ok: false, error: 'APPROVAL ERROR: Browser connection denied by user. Halting automation before accessing open browser.' };
  }

  if (autoConnect && approved !== true) {
    return { ok: false, error: 'APPROVAL ERROR: User approval required to attach to open browser session. Pass approved: true or --approved to proceed.' };
  }

  const endpointCheck = await discoverChromeEndpoint({
    cdp,
    autoConnect,
    profileDir: profileDir || userDataDir
  });
  if (!endpointCheck.valid) {
    return { ok: false, error: `ATTACHMENT ERROR: ${endpointCheck.error}` };
  }

  if (!tab) {
    return { ok: false, error: 'ATTACHMENT ERROR: A target tab pattern (--tab <pattern>) is required when attaching to external Chrome via CDP.' };
  }

  const client = opts.client || createMcpClient({
    cdp: endpointCheck.port,
    autoConnect: Boolean(autoConnect),
    pinTab: Boolean(pinTab),
    allowedDomains: null,
    namespace
  });
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
    const targetTabId = targetTab.targetId || targetTab.tabId;
    const switchRes = await client.callTool('agent_browser_tab_switch', { tab: targetTabId, session });

    if (switchRes.raw?.isError || switchRes.raw?.structuredContent?.response?.success === false || switchRes.raw?.structuredContent?.response?.error) {
      const errorDetail = switchRes.raw?.structuredContent?.response?.error || switchRes.text || 'tab_switch error';
      return { ok: false, error: `TAB ERROR: Tab switch failed for pattern '${tabTarget}': ${errorDetail}` };
    }

    const postSwitchTabsRes = await client.callTool('agent_browser_tab_list', { session });
    const postTabs = postSwitchTabsRes.raw?.structuredContent?.response?.data?.tabs || [];
    const activeTab = postTabs.find(t => t.targetId === targetTab.targetId && t.active) ||
                      (postTabs.some(t => t.targetId === targetTab.targetId) ? postTabs.find(t => t.targetId === targetTab.targetId) : postTabs.find(t => t.active));

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
    if (isTabGone(snap)) {
      return { ok: false, error: `TAB ERROR: Bound tab is gone or closed: ${snap.text}` };
    }

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
      try {
        await client.callTool('agent_browser_close', { session }, 4000);
      } catch (e) { }
      await client.close();
    }
  }
}

/**
 * Pure download attribution helper: identifies ONLY a single fresh download created after clickStartTime.
 * Rejects incomplete temp downloads and FAILS loudly on ambiguous matches (>1 new CSV candidates).
 *
 * @param {Map<string, {size:number, mtimeMs:number}>} beforeMap
 * @param {Array<{name:string, fullPath?:string, size:number, mtimeMs:number}>} currentFiles
 * @param {Object} [opts]
 * @returns {Object}
 */
export function identifyFreshDownload(beforeMap, currentFiles, opts = {}) {
  const {
    clickStartTime = 0,
    allowGuidFiles = false,
    expectedNameFragment = null
  } = opts;

  const isTempExt = (name) => /\.(crdownload|tmp|part|download)$/i.test(name);
  const isGuidName = (name) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);

  const pendingTemp = [];
  const candidates = [];

  for (const item of currentFiles || []) {
    const name = item.name;
    if (!name) continue;
    const prev = beforeMap ? beforeMap.get(name) : null;
    const isNew = !prev;
    const isModified = prev && (item.size !== prev.size || item.mtimeMs > prev.mtimeMs + 1);
    if (!isNew && !isModified) continue;

    if (isTempExt(name)) {
      pendingTemp.push(name);
      continue;
    }

    const validExt = name.toLowerCase().endsWith('.csv') || (allowGuidFiles && isGuidName(name));
    if (!validExt) continue;
    if (item.size <= 0) continue;
    if (clickStartTime && item.mtimeMs < clickStartTime - 2000) continue;
    if (expectedNameFragment && !name.includes(expectedNameFragment)) continue;

    candidates.push(item);
  }

  if (pendingTemp.length > 0 && candidates.length === 0) {
    return { ok: false, pending: true, ambiguous: false, pendingFiles: pendingTemp, candidates: [] };
  }

  if (candidates.length > 1) {
    const names = candidates.map(c => c.name).join(', ');
    return {
      ok: false,
      pending: false,
      ambiguous: true,
      candidates,
      error: `EXPORT AMBIGUOUS: Expected 1 fresh download from export attempt, found ${candidates.length} candidate files (${names}). Refusing to guess.`
    };
  }

  if (candidates.length === 1) {
    return { ok: true, pending: pendingTemp.length > 0, ambiguous: false, file: candidates[0], candidates };
  }

  return { ok: false, pending: pendingTemp.length > 0, ambiguous: false, candidates: [] };
}

/**
 * Validates exported Scopus CSV text, distinguishing MISSING REQUIRED COLUMNS
 * from individual rows having blank DOI or blank keyword values.
 *
 * @param {string} rawCsvText
 * @param {Object} [opts]
 * @returns {Object}
 */
export function validateScopusCsvContent(rawCsvText, opts = {}) {
  const {
    expectedRowCount = null,
    requireTitle = true,
    requireDoi = true,
    requireAbstract = true,
    requireKeywords = true
  } = opts;

  if (!rawCsvText || typeof rawCsvText !== 'string') {
    return {
      ok: false,
      error: 'EXPORT INCOMPLETE: Downloaded CSV content is empty or unreadable',
      missingColumns: ['Title', 'DOI', 'Abstract', 'Keywords'],
      parsedRowCount: 0,
      headers: [],
      blankCells: {}
    };
  }

  // Strip UTF-8 BOM if present
  const normalizedText = rawCsvText.charCodeAt(0) === 0xFEFF ? rawCsvText.slice(1) : rawCsvText;
  const rows = parseCsv(normalizedText);
  if (rows.length === 0) {
    return {
      ok: false,
      error: 'EXPORT INCOMPLETE: CSV contains no header row',
      missingColumns: ['Title', 'DOI', 'Abstract', 'Keywords'],
      parsedRowCount: 0,
      headers: [],
      blankCells: {}
    };
  }

  const headers = rows[0].map(h => String(h || '').trim());
  const headerLower = headers.map(h => h.toLowerCase());
  const dataRows = rows.slice(1);

  const findColIdx = (predicate) => headerLower.findIndex(predicate);
  const titleIdx = findColIdx(h => h === 'title' || h === 'document title');
  const doiIdx = findColIdx(h => h === 'doi');
  const abstractIdx = findColIdx(h => h === 'abstract');
  const authorKwIdx = findColIdx(h => h === 'author keywords');
  const indexKwIdx = findColIdx(h => h === 'index keywords' || h === 'indexed keywords');
  const anyKwIdx = authorKwIdx !== -1
    ? authorKwIdx
    : (indexKwIdx !== -1 ? indexKwIdx : findColIdx(h => h.includes('keyword')));

  const missingColumns = [];
  if (requireTitle && titleIdx === -1) missingColumns.push('Title');
  if (requireDoi && doiIdx === -1) missingColumns.push('DOI');
  if (requireAbstract && abstractIdx === -1) missingColumns.push('Abstract');
  if (requireKeywords && anyKwIdx === -1) missingColumns.push('Keywords (Author Keywords / Index Keywords)');

  const countBlanks = (colIdx) => {
    if (colIdx === -1) return null;
    let blanks = 0;
    for (const r of dataRows) {
      if (!r || !String(r[colIdx] ?? '').trim()) blanks++;
    }
    return blanks;
  };

  const blankCells = {
    title: countBlanks(titleIdx),
    doi: countBlanks(doiIdx),
    abstract: countBlanks(abstractIdx),
    authorKeywords: countBlanks(authorKwIdx),
    indexKeywords: countBlanks(indexKwIdx)
  };

  const presentColumns = {
    title: titleIdx !== -1 ? headers[titleIdx] : null,
    doi: doiIdx !== -1 ? headers[doiIdx] : null,
    abstract: abstractIdx !== -1 ? headers[abstractIdx] : null,
    authorKeywords: authorKwIdx !== -1 ? headers[authorKwIdx] : null,
    indexKeywords: indexKwIdx !== -1 ? headers[indexKwIdx] : null
  };

  if (missingColumns.length > 0) {
    return {
      ok: false,
      error: `EXPORT INCOMPLETE: Downloaded CSV is missing required column header(s): ${missingColumns.join(', ')}`,
      missingColumns,
      presentColumns,
      parsedRowCount: dataRows.length,
      headers,
      blankCells
    };
  }

  if (dataRows.length === 0) {
    return {
      ok: false,
      error: 'EXPORT INCOMPLETE: CSV file contains header only and 0 document rows',
      missingColumns: [],
      presentColumns,
      parsedRowCount: 0,
      headers,
      blankCells
    };
  }

  if (expectedRowCount != null && dataRows.length !== expectedRowCount) {
    return {
      ok: false,
      error: `EXPORT INCOMPLETE: Expected ${expectedRowCount} records, but parsed CSV contains ${dataRows.length}`,
      missingColumns: [],
      presentColumns,
      parsedRowCount: dataRows.length,
      headers,
      blankCells
    };
  }

  return {
    ok: true,
    missingColumns: [],
    presentColumns,
    parsedRowCount: dataRows.length,
    headers,
    blankCells,
    firstTitle: titleIdx !== -1 ? String(dataRows[0]?.[titleIdx] || '').trim() : ''
  };
}

function parseEvalPayload(evalRes) {
  if (!evalRes || evalRes.raw?.isError) return null;
  if (evalRes.raw?.structuredContent?.response?.data && 'result' in evalRes.raw.structuredContent.response.data) {
    return evalRes.raw.structuredContent.response.data.result;
  }
  const t = (evalRes.text || '').trim();
  if (!t || t === 'null' || t === '(no output)') return null;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function collectFrameIds(frameTree, out = new Set()) {
  if (!frameTree) return out;
  if (frameTree.frame?.id) out.add(frameTree.frame.id);
  if (Array.isArray(frameTree.childFrames)) {
    for (const child of frameTree.childFrames) collectFrameIds(child, out);
  }
  return out;
}

export async function createCdpDownloadSession(wsUrl, targetId, attemptDownloadDir, opts = {}) {
  const { profileSafety = null } = opts;
  if (profileSafety && profileSafety.isDedicated === false) {
    return {
      ok: false,
      status: 'DEDICATED_PROFILE_REQUIRED',
      error: profileSafety.error || 'DEDICATED PROFILE REQUIRED: Refusing to call Browser.setDownloadBehavior on non-dedicated profile.'
    };
  }
  if (!targetId || typeof targetId !== 'string') {
    return {
      ok: false,
      status: 'TARGET_ID_REQUIRED',
      error: 'CDP ATTRIBUTION ERROR: Approved tab targetId is required so downloads from other tabs cannot be attributed.'
    };
  }
  if (!wsUrl || typeof WebSocket !== 'function') {
    return {
      ok: false,
      status: 'CDP_WS_UNAVAILABLE',
      error: 'CDP ATTRIBUTION ERROR: Chrome webSocketDebuggerUrl / WebSocket client unavailable.'
    };
  }

  const ws = new WebSocket(wsUrl);
  let msgId = 0;
  const pending = new Map();
  const beginEvents = [];
  const progressEvents = [];
  let closed = false;
  let targetSessionId = null;
  const tabFrameIds = new Set();

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 1500);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', (err) => { clearTimeout(timer); reject(new Error(err?.message || 'CDP WebSocket error')); }, { once: true });
    });
  } catch (err) {
    closed = true;
    try { ws.close(); } catch {}
    return { ok: false, status: 'CDP_WS_ERROR', error: `CDP ATTRIBUTION ERROR: ${err.message}` };
  }

  ws.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.method === 'Browser.downloadWillBegin') {
        beginEvents.push({ ...m.params, observedAt: Date.now() });
      } else if (m.method === 'Browser.downloadProgress') {
        progressEvents.push(m.params);
      } else if (targetSessionId && m.sessionId === targetSessionId) {
        if (m.method === 'Page.frameAttached' && m.params?.frameId) {
          tabFrameIds.add(m.params.frameId);
        } else if (m.method === 'Page.frameNavigated' && m.params?.frame?.id) {
          tabFrameIds.add(m.params.frame.id);
        } else if (m.method === 'Page.navigatedWithinDocument' && m.params?.frameId) {
          tabFrameIds.add(m.params.frameId);
        }
      }
      if (m.id && pending.has(m.id)) {
        const { resolve, reject, timer } = pending.get(m.id);
        clearTimeout(timer);
        pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message || JSON.stringify(m.error)));
        else resolve(m.result);
      }
    } catch {}
  });

  const cdpSend = (method, params = {}, sessionId = undefined, timeoutMs = 2000) => {
    if (closed) return Promise.reject(new Error('CDP WebSocket closed'));
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  };

  try {
    const attached = await cdpSend('Target.attachToTarget', { targetId, flatten: true });
    targetSessionId = attached?.sessionId || null;
    if (!targetSessionId) {
      throw new Error(`Target.attachToTarget returned no sessionId for targetId '${targetId}'`);
    }
    try { await cdpSend('Page.enable', {}, targetSessionId); } catch {}
    const ft = await cdpSend('Page.getFrameTree', {}, targetSessionId);
    collectFrameIds(ft?.frameTree, tabFrameIds);
    if (tabFrameIds.size === 0) {
      throw new Error(`Page.getFrameTree yielded 0 frame IDs for targetId '${targetId}'`);
    }
    await cdpSend('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: attemptDownloadDir,
      eventsEnabled: true
    });
  } catch (err) {
    if (targetSessionId) {
      try { await cdpSend('Target.detachFromTarget', { sessionId: targetSessionId }, undefined, 800); } catch {}
    }
    closed = true;
    try { ws.close(); } catch {}
    return {
      ok: false,
      status: 'CDP_ATTRIBUTION_SETUP_FAILED',
      error: `CDP ATTRIBUTION ERROR: Unable to isolate and attribute downloads for tab '${targetId}': ${err.message}`
    };
  }

  return {
    ok: true,
    tabFrameIds,
    async waitForDownload(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        // Strictly match ONLY downloadWillBegin events whose frameId belongs to our pinned tab.
        // Never fall back to unattributed/foreign-tab events.
        const matchingBegins = beginEvents.filter(b => b.frameId && tabFrameIds.has(b.frameId));
        const ignoredOtherTabEvents = beginEvents.filter(b => !b.frameId || !tabFrameIds.has(b.frameId));

        const matchingGuids = new Set(matchingBegins.map(b => b.guid));
        const canceled = progressEvents.filter(p => matchingGuids.has(p.guid) && (p.state === 'canceled' || p.state === 'interrupted'));
        if (canceled.length > 0) {
          return {
            ok: false,
            canceled: true,
            ignoredOtherTabCount: ignoredOtherTabEvents.length,
            ignoredOtherTabEvents: ignoredOtherTabEvents.map(e => ({ guid: e.guid, frameId: e.frameId || '', suggestedFilename: e.suggestedFilename || '' })),
            error: 'EXPORT FAILED: Browser download was canceled'
          };
        }

        const completed = [];
        for (const guid of matchingGuids) {
          const doneEv = [...progressEvents].reverse().find(p => p.guid === guid && p.state === 'completed');
          if (doneEv) {
            const beginEv = matchingBegins.find(b => b.guid === guid);
            const filePath = doneEv.filePath || path.join(attemptDownloadDir, guid);
            if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
              completed.push({
                guid,
                suggestedFilename: beginEv?.suggestedFilename || `${guid}.csv`,
                url: beginEv?.url || '',
                frameId: beginEv?.frameId || '',
                filePath
              });
            }
          }
        }

        if (completed.length > 1) {
          return {
            ok: false,
            ambiguous: true,
            ignoredOtherTabCount: ignoredOtherTabEvents.length,
            ignoredOtherTabEvents: ignoredOtherTabEvents.map(e => ({ guid: e.guid, frameId: e.frameId || '', suggestedFilename: e.suggestedFilename || '' })),
            error: `EXPORT AMBIGUOUS: Expected 1 CDP download for target tab, observed ${completed.length} (${completed.map(c => c.suggestedFilename).join(', ')}). Refusing to guess.`
          };
        }
        if (completed.length === 1) {
          return {
            ok: true,
            download: completed[0],
            ignoredOtherTabCount: ignoredOtherTabEvents.length,
            ignoredOtherTabEvents: ignoredOtherTabEvents.map(e => ({ guid: e.guid, frameId: e.frameId || '', suggestedFilename: e.suggestedFilename || '' }))
          };
        }
        await new Promise(r => setTimeout(r, 150));
      }
      const ignoredOtherTabEvents = beginEvents.filter(b => !b.frameId || !tabFrameIds.has(b.frameId));
      const ignoredNote = ignoredOtherTabEvents.length > 0
        ? ` Ignored ${ignoredOtherTabEvents.length} download event(s) from other browser tab(s)/frame(s).`
        : '';
      return {
        ok: false,
        timedOut: true,
        ignoredOtherTabCount: ignoredOtherTabEvents.length,
        ignoredOtherTabEvents: ignoredOtherTabEvents.map(e => ({ guid: e.guid, frameId: e.frameId || '', suggestedFilename: e.suggestedFilename || '' })),
        error: `EXPORT FAILED: No CDP download completed for approved tab within ${timeoutMs}ms.${ignoredNote}`
      };
    },
    async cleanup() {
      if (closed) return;
      try {
        await cdpSend('Browser.setDownloadBehavior', { behavior: 'default' }, undefined, 1500);
      } catch {}
      if (targetSessionId) {
        try { await cdpSend('Target.detachFromTarget', { sessionId: targetSessionId }, undefined, 1000); } catch {}
      }
      closed = true;
      try { ws.close(); } catch {}
    }
  };
}

function copyCsvPreservingExisting(sourceFilePath, outputDir, targetFilename) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const targetFilePath = path.join(outputDir, targetFilename);
  let placedPath = targetFilePath;
  let finalFilename = targetFilename;
  let preservedExisting = false;

  try {
    fs.copyFileSync(sourceFilePath, targetFilePath, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    preservedExisting = true;
    const ext = path.extname(targetFilename);
    const base = path.basename(targetFilename, ext);
    let counter = 1;
    while (true) {
      const candidateName = `${base} (${counter})${ext}`;
      const candidatePath = path.join(outputDir, candidateName);
      try {
        fs.copyFileSync(sourceFilePath, candidatePath, fs.constants.COPYFILE_EXCL);
        placedPath = candidatePath;
        finalFilename = candidateName;
        break;
      } catch (copyErr) {
        if (copyErr.code === 'EEXIST') {
          counter++;
          continue;
        }
        throw copyErr;
      }
    }
  }

  return { placedPath, finalFilename, preservedExisting };
}

/**
 * Repeatable Scopus Results-Tab -> CSV Export workflow.
 * Starts from an explicitly approved, uniquely identified Scopus results tab
 * (via --auto-connect --approved or --cdp fallback), checks displayed query & count,
 * drives Export -> CSV dialog (range + Abstract & keywords), attributes ONLY a fresh
 * download from this attempt, verifies CSV schema separately from individual blank fields,
 * and preserves any existing exports byte-for-byte.
 *
 * @param {Object} opts
 * @returns {Promise<Object>}
 */
export async function exportScopusResultsTab(opts = {}) {
  const totalWallStartMs = Date.now();
  const from = opts.from != null ? parseInt(opts.from, 10) : 1;
  const to = opts.to != null
    ? parseInt(opts.to, 10)
    : (opts.count != null ? from + parseInt(opts.count, 10) - 1 : 20);
  const {
    expectedQuery = null,
    outputDir = path.resolve(__dirname, 'pilot-exports'),
    exportFile = `scopus-export-${from}-${to}.csv`,
    tab = null,
    cdp = null,
    autoConnect = false,
    approved = null,
    pinTab = true,
    profileDir = null,
    userDataDir = null,
    session = 'scopus-export-' + crypto.randomBytes(3).toString('hex'),
    namespace = null,
    downloadTimeoutMs = 45000,
    downloadsDir = process.env.AGENT_BROWSER_DOWNLOAD_PATH || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads'),
    isolateDownloads = true,
    client: providedClient = null
  } = opts;

  const metrics = {
    engine: 'agent-browser',
    totalWallMs: 0,
    browserActionMs: 0,
    toolCalls: 0,
    retries: 0,
    observationUtf8Bytes: 0,
    observationChars: 0,
    modelTokens: null,
    toolSequence: []
  };

  function finishResult(payload) {
    metrics.totalWallMs = Date.now() - totalWallStartMs;
    return { ...payload, metrics };
  }

  // 1. Validate inputs & approval gates
  if (approved === false) {
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: 'APPROVAL_DENIED',
      error: 'APPROVAL ERROR: Browser connection denied by user. Halting before accessing open browser.'
    });
  }

  if (autoConnect && approved !== true) {
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: 'APPROVAL_REQUIRED',
      error: 'APPROVAL ERROR: Explicit user approval required to attach to open browser session. Pass approved: true or --approved.'
    });
  }

  if (!cdp && !autoConnect && !providedClient) {
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: 'ATTACHMENT_REQUIRED',
      error: 'ATTACHMENT ERROR: Open-tab export requires --auto-connect --approved --tab <pattern> (or --cdp <port> --tab <pattern>).'
    });
  }

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: 'INVALID_RANGE',
      error: `EXPORT RANGE ERROR: Invalid document range from=${from}, to=${to}. Both must be integers with 1 <= from <= to.`
    });
  }

  const filenameCheck = validateExportFilename(exportFile, outputDir);
  if (!filenameCheck.valid) {
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: 'INVALID_FILENAME',
      error: `REJECTED: Target export filename '${exportFile}' rejected: ${filenameCheck.error}`
    });
  }

  if ((cdp || autoConnect) && !tab) {
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: 'TAB_REQUIRED',
      error: 'ATTACHMENT ERROR: A target tab pattern (--tab <pattern>) is required to identify the approved Scopus results tab.'
    });
  }

  // 2. Endpoint discovery, validation & dedicated-profile guard
  if (isolateDownloads && (profileDir || userDataDir) && isSharedDefaultChromeProfileDir(profileDir || userDataDir)) {
    const resolvedShared = path.resolve(String(profileDir || userDataDir));
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: 'DEDICATED_PROFILE_REQUIRED',
      error: `DEDICATED PROFILE REQUIRED: Refusing to run Browser.setDownloadBehavior on shared Chrome profile '${resolvedShared}'. Launch Chrome with a dedicated user-data-dir (for example ScopusProfile) and pass --profile-dir.`
    });
  }

  let activeCdpPort = cdp;
  let wsUrl = null;
  let profileSafety = null;
  if (cdp || autoConnect) {
    const endpointCheck = await discoverChromeEndpoint({
      cdp,
      autoConnect,
      profileDir: profileDir || userDataDir,
      requireDedicatedProfile: Boolean(isolateDownloads)
    });
    if (!endpointCheck.valid) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: endpointCheck.dedicatedRequired ? 'DEDICATED_PROFILE_REQUIRED' : 'ATTACHMENT_ERROR',
        error: endpointCheck.dedicatedRequired ? endpointCheck.error : `ATTACHMENT ERROR: ${endpointCheck.error}`
      });
    }
    activeCdpPort = endpointCheck.port;
    wsUrl = endpointCheck.versionData?.webSocketDebuggerUrl || null;
    profileSafety = inspectChromeProfileSafety({
      profileDir,
      userDataDir,
      endpointCheck,
      activeCdpPort
    });
    if (isolateDownloads && !profileSafety.isDedicated) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'DEDICATED_PROFILE_REQUIRED',
        error: profileSafety.error
      });
    }
  }

  const client = providedClient || createMcpClient({
    cdp: activeCdpPort,
    autoConnect: Boolean(autoConnect),
    pinTab: Boolean(pinTab),
    allowedDomains: null,
    namespace
  });
  const shouldCloseClient = !providedClient;
  const attemptId = crypto.randomBytes(4).toString('hex');
  const attemptDownloadDir = path.join(os.tmpdir(), `northbridge-scopus-dl-${attemptId}`);
  let cdpDownloadMonitor = null;

  function recordObs(text) {
    if (!text || typeof text !== 'string') return;
    const norm = text.replace(/\r\n/g, '\n');
    metrics.observationChars += norm.length;
    metrics.observationUtf8Bytes += Buffer.byteLength(norm, 'utf8');
  }

  async function call(name, args = {}, timeoutMs = 30000) {
    metrics.toolCalls++;
    metrics.toolSequence.push(name);
    const res = await client.callTool(name, args, timeoutMs);
    if (name === 'agent_browser_snapshot' || name === 'agent_browser_eval') {
      recordObs(res?.text || '');
    }
    if (isTabGone(res)) {
      const err = new Error(`TAB ERROR: Bound tab closed or left target context (tab_gone): ${res.text}`);
      err.code = 'TAB_GONE';
      throw err;
    }
    return res;
  }

  if (shouldCloseClient) {
    await client.init();
  }

  const browserActionStartMs = Date.now();
  try {
    // 3. Locate unique approved tab, switch, and verify targetId & URL
    let activeTab = null;
    if (tab) {
      const tabListRes = await call('agent_browser_tab_list', { session });
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
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'TAB_NOT_FOUND',
          error: `TAB ERROR: Tab not found matching pattern '${tabTarget}'.`
        });
      }
      if (matchedTabs.length > 1) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'TAB_AMBIGUOUS',
          error: `TAB ERROR: Ambiguous tab selection: Found ${matchedTabs.length} tabs matching pattern '${tabTarget}'. Unique match required.`
        });
      }

      const targetTab = matchedTabs[0];
      const targetTabId = targetTab.targetId || targetTab.tabId;
      const switchRes = await call('agent_browser_tab_switch', { tab: targetTabId, session });
      if (switchRes.raw?.isError || switchRes.raw?.structuredContent?.response?.success === false || switchRes.raw?.structuredContent?.response?.error) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'TAB_SWITCH_FAILED',
          error: `TAB ERROR: Tab switch failed for pattern '${tabTarget}': ${switchRes.raw?.structuredContent?.response?.error || switchRes.text}`
        });
      }

      const postSwitchRes = await call('agent_browser_tab_list', { session });
      const postTabs = postSwitchRes.raw?.structuredContent?.response?.data?.tabs || [];
      activeTab = postTabs.find(t => t.targetId === targetTab.targetId && t.active) ||
        (postTabs.some(t => t.targetId === targetTab.targetId) ? postTabs.find(t => t.targetId === targetTab.targetId) : postTabs.find(t => t.active));

      if (!activeTab) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'TAB_NOT_VERIFIED',
          error: `TAB ERROR: Unable to verify active tab after switching to '${tabTarget}'.`
        });
      }
      if (targetTab.targetId && activeTab.targetId && activeTab.targetId !== targetTab.targetId) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'TAB_MISMATCH',
          error: `TAB ERROR: Active tab target ID '${activeTab.targetId}' differs from selected target ID '${targetTab.targetId}'.`
        });
      }
      if (targetTab.url && activeTab.url && activeTab.url !== targetTab.url) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'TAB_URL_MISMATCH',
          error: `TAB ERROR: Active tab URL '${activeTab.url}' differs from selected tab URL '${targetTab.url}'.`
        });
      }
    }

    // 4. Inspect page state, guard auth/bot challenges, verify displayed query & count
    let snap = await call('agent_browser_snapshot', { session });
    if (/Institutional Sign-In Required|Authentication pending|Sign in to access Scopus/i.test(snap.text)) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'PAUSED_AUTH',
        error: 'PAUSED: Scopus or institutional sign-in required. Complete authentication in Chrome before retrying export.'
      });
    }
    if (/Unusual traffic detected|Bot challenge|Verify you are a human/i.test(snap.text)) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'STOPPED_BOT_CHALLENGE',
        error: 'STOPPED: Bot challenge / unusual traffic warning encountered. Halting without bypass attempts.'
      });
    }

    const domState = parseEvalPayload(await call('agent_browser_eval', {
      script: `(() => {
        const cb = document.querySelector('input[aria-label="Back to simple search"], [role="combobox"][aria-label="Back to simple search"]');
        const qBox = document.getElementById('query-executed');
        const query = cb ? (cb.value ?? cb.getAttribute('value') ?? cb.innerText ?? '').trim()
                         : (qBox ? (qBox.innerText || '').trim() : null);
        const hText = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]')).map(el => (el.innerText || '').trim()).join('\\n');
        const cm = hText.match(/(\\d[\\d,]*)\\s+(?:documents?\\s+found|document\\s+results)/i);
        const totalMain = cm ? parseInt(cm[1].replace(/,/g, ''), 10) : null;
        return { query, totalMain };
      })()`,
      session
    })) || {};

    let displayedQuery = domState.query || null;
    if (!displayedQuery) {
      const combLine = snap.text.split(/\r?\n/).find(l => /combobox\s+"Back to simple search"/i.test(l));
      const cm = combLine && combLine.match(/:\s*(.+)$/);
      if (cm) displayedQuery = cm[1].replace(/^"|"$/g, '').trim();
    }
    if (!displayedQuery) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'QUERY_MISSING',
        error: 'UNCLEAR: Displayed Scopus query could not be verified on the selected results tab. Stopping before export.'
      });
    }

    const normText = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (expectedQuery && normText(displayedQuery) !== normText(expectedQuery)) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'QUERY_MISMATCH',
        displayedQuery,
        error: `NOT EXECUTED: Displayed query '${displayedQuery}' does not match expected query '${expectedQuery}'. Stopping before export.`
      });
    }

    let totalMain = domState.totalMain;
    if (!Number.isInteger(totalMain)) {
      const countMatch = snap.text.match(/(\d[\d,]*)\s+(?:documents?\s+found|document\s+results)/i);
      if (countMatch) totalMain = parseInt(countMatch[1].replace(/,/g, ''), 10);
    }
    if (!Number.isInteger(totalMain) || totalMain <= 0) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'NO_RESULTS',
        displayedQuery,
        error: `STOPPED: Unable to verify positive results count on Scopus results tab (observed total=${totalMain}).`
      });
    }

    if (from > totalMain) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'INVALID_RANGE',
        displayedQuery,
        totalMain,
        error: `EXPORT RANGE ERROR: Requested start record ${from} exceeds total results (${totalMain}).`
      });
    }

    const effectiveTo = Math.min(to, totalMain);
    const expectedBatchCount = effectiveTo - from + 1;

    // 5. Open Export -> CSV (unless dialog already open)
    const isDialogOpen = (s) => /heading\s+"Export\s+\d+\s+documents\s+to\s+CSV"|heading\s+"Export document settings"/i.test(s);

    if (!isDialogOpen(snap.text)) {
      const exportBtnRef = findRef(snap.text, /-\s*button\s+"Export"\s*\[/i) ||
        findRef(snap.text.split(/\r?\n/).filter(l => !/Export filter counts|Export\.\.\./i.test(l)).join('\n'), /button\s+"Export"/i);

      if (!exportBtnRef) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'EXPORT_BUTTON_MISSING',
          displayedQuery,
          totalMain,
          error: 'EXPORT ERROR: Could not locate the Export button on the Scopus results tab.'
        });
      }

      await call('agent_browser_click', { selector: exportBtnRef, session });
      await new Promise(r => setTimeout(r, 450));
      snap = await call('agent_browser_snapshot', { session });

      if (!isDialogOpen(snap.text)) {
        const csvMenuRef = findRef(snap.text, /menuitem\s+"CSV"/i);
        if (!csvMenuRef) {
          return finishResult({
            ok: false,
            exportSuccess: false,
            status: 'EXPORT_MENU_CLOSED',
            displayedQuery,
            totalMain,
            error: 'EXPORT ERROR: Export menu did not open (menuitem "CSV" not visible) after clicking Export once.'
          });
        }
        await call('agent_browser_click', { selector: csvMenuRef, session });
        await new Promise(r => setTimeout(r, 600));
        snap = await call('agent_browser_snapshot', { session });
      }
    }

    const getDialogSlice = (snapText) => {
      const lines = snapText.split(/\r?\n/);
      const idx = lines.findIndex(l => /heading\s+"Export\s+\d+\s+documents\s+to\s+CSV"|heading\s+"Export document settings"|document\s+"Export\s+\d+\s+documents\s+to\s+CSV"/i.test(l));
      return idx >= 0 ? lines.slice(idx).join('\n') : snapText;
    };

    if (!isDialogOpen(snap.text)) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'EXPORT_DIALOG_MISSING',
        displayedQuery,
        totalMain,
        error: 'EXPORT ERROR: CSV Export dialog did not appear after selecting Export -> CSV.'
      });
    }

    // 6. Configure document range & Abstract & keywords fields using fresh refs
    let dlgSlice = getDialogSlice(snap.text);
    const readDlgState = async () => parseEvalPayload(await call('agent_browser_eval', {
      script: `(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        const cbs = {};
        for (const el of dlg.querySelectorAll('input[type="checkbox"]')) {
          const lbl = (el.closest('label')?.innerText || el.getAttribute('aria-label') || '').trim();
          if (lbl) cbs[lbl.toLowerCase()] = Boolean(el.checked);
        }
        const radios = {};
        for (const el of dlg.querySelectorAll('input[type="radio"]')) {
          const lbl = (el.closest('label')?.innerText || el.getAttribute('aria-label') || '').trim();
          if (lbl) radios[lbl.toLowerCase()] = Boolean(el.checked);
        }
        return { checkboxes: cbs, radios };
      })()`,
      session
    }));

    const initDlgState = await readDlgState();
    const docsRadioLine = dlgSlice.split(/\r?\n/).find(l => /^\s*-\s*radio\s+"Documents"\s*\[/i.test(l));
    const isDocsRadioChecked = /checked=true|\[checked(?:\s*,|\])/i.test(docsRadioLine || '') ||
      Object.entries(initDlgState?.radios || {}).some(([k, v]) => k.startsWith('documents') && v === true);

    if (docsRadioLine && !isDocsRadioChecked) {
      const radioRef = findRef(docsRadioLine, /radio\s+"Documents"/i);
      if (radioRef) {
        await call('agent_browser_click', { selector: radioRef, session });
        await new Promise(r => setTimeout(r, 300));
        snap = await call('agent_browser_snapshot', { session });
        dlgSlice = getDialogSlice(snap.text);
      }
    }

    const fromSpinRef = findRef(dlgSlice, /spinbutton\s+"From"/i);
    const toSpinRef = findRef(dlgSlice, /spinbutton\s+"To"/i);

    if (from > 1 && !fromSpinRef) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'RANGE_INPUT_MISSING',
        displayedQuery,
        totalMain,
        error: `EXPORT RANGE ERROR: Dialog does not expose an editable "From" spinbutton required for start=${from}.`
      });
    }

    if (fromSpinRef) {
      await call('agent_browser_fill', { selector: fromSpinRef, text: String(from), session });
      await new Promise(r => setTimeout(r, 120));
    }
    if (toSpinRef) {
      await call('agent_browser_fill', { selector: toSpinRef, text: String(effectiveTo), session });
      await call('agent_browser_press', { key: 'Tab', session });
      await new Promise(r => setTimeout(r, 300));
    }

    // Check Abstract & keywords parent + individual required checkboxes
    snap = await call('agent_browser_snapshot', { session });
    dlgSlice = getDialogSlice(snap.text);
    let currentCbs = (await readDlgState())?.checkboxes || {};

    const ensureChecked = async (labelPattern) => {
      const line = dlgSlice.split(/\r?\n/).find(l => new RegExp(`checkbox\\s+"${labelPattern}"`, 'i').test(l));
      if (!line) return false;
      const lblLower = labelPattern.toLowerCase();
      const domEntry = Object.entries(currentCbs).find(([k]) => k === lblLower || k.startsWith(lblLower));
      const snapSaysUnchecked = /checked=false/i.test(line);
      const needsClick = domEntry ? domEntry[1] === false : snapSaysUnchecked;
      if (needsClick) {
        const ref = findRef(line, /checkbox/i);
        if (ref) {
          await call('agent_browser_click', { selector: ref, session });
          await new Promise(r => setTimeout(r, 250));
          snap = await call('agent_browser_snapshot', { session });
          dlgSlice = getDialogSlice(snap.text);
          currentCbs = (await readDlgState())?.checkboxes || {};
          return true;
        }
      }
      return false;
    };

    await ensureChecked('Citation information');
    await ensureChecked('Abstract & keywords');

    for (const subCol of ['Document title', 'DOI', 'Abstract', 'Author keywords', 'Indexed keywords', 'Index keywords']) {
      await ensureChecked(subCol);
    }

    // 7. Verify final Export dialog state (format, range, count, columns, enabled button) before clicking Export ONCE
    snap = await call('agent_browser_snapshot', { session });
    dlgSlice = getDialogSlice(snap.text);

    const dialogVerify = parseEvalPayload(await call('agent_browser_eval', {
      script: `(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return { ok: false, reason: 'missing_dialog' };
        const hEl = dlg.querySelector('h1, h2, [role="heading"]');
        const heading = hEl ? (hEl.innerText || '').trim() : '';
        const nums = Array.from(dlg.querySelectorAll('input[type="number"], input[role="spinbutton"], input[type="text"]')).map(i => ({
          ariaLabel: (i.getAttribute('aria-label') || '').trim(),
          value: String(i.value || '').trim(),
          disabled: Boolean(i.disabled)
        }));
        const cbs = {};
        for (const el of dlg.querySelectorAll('input[type="checkbox"]')) {
          const lbl = (el.closest('label')?.innerText || el.getAttribute('aria-label') || '').trim();
          if (lbl) cbs[lbl.toLowerCase()] = Boolean(el.checked);
        }
        const radios = Array.from(dlg.querySelectorAll('input[type="radio"]')).map(r => ({
          label: (r.closest('label')?.innerText || r.getAttribute('aria-label') || '').trim(),
          checked: Boolean(r.checked)
        }));
        const expBtn = Array.from(dlg.querySelectorAll('button')).reverse().find(b => /^(Export(\\.\\.\\.)?|Confirm Export)$/i.test((b.innerText || b.textContent || '').trim()));
        return {
          ok: true,
          heading,
          nums,
          radios,
          checkboxes: cbs,
          dialogTextHead: (dlg.innerText || '').split('\\n').slice(0, 12).join(' | '),
          exportBtnText: expBtn ? (expBtn.innerText || '').trim() : null,
          exportBtnDisabled: expBtn ? (Boolean(expBtn.disabled) || expBtn.getAttribute('aria-disabled') === 'true') : true
        };
      })()`,
      session
    }));

    if (!dialogVerify?.ok) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'DIALOG_VERIFICATION_FAILED',
        displayedQuery,
        totalMain,
        error: `EXPORT ERROR: Could not inspect Export dialog before clicking Export (${dialogVerify?.reason || 'unknown'}).`
      });
    }

    const csvFormatOk = /to\s+csv\b/i.test(dialogVerify.heading) ||
      (dialogVerify.radios || []).some(r => /csv/i.test(r.label) && r.checked);
    const countMatch = dialogVerify.heading.match(/Export\s+(\d[\d,]*)\s+documents/i) ||
      dialogVerify.dialogTextHead.match(/Export\s+(\d[\d,]*)\s+documents/i);
    const modalCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : null;
    const countOk = modalCount === expectedBatchCount;

    const toInput = (dialogVerify.nums || []).find(n => /^to$/i.test(n.ariaLabel));
    const fromInput = (dialogVerify.nums || []).find(n => /^from$/i.test(n.ariaLabel));
    const toOk = toInput ? (parseInt(toInput.value, 10) === effectiveTo && !toInput.disabled) : true;
    const fromOk = fromInput ? (parseInt(fromInput.value, 10) === from && !fromInput.disabled) : (from === 1 && /\b1\s*[–-]/.test(dialogVerify.dialogTextHead));

    const cbMap = dialogVerify.checkboxes || {};
    const hasCb = (substr) => Object.entries(cbMap).some(([k, v]) => k.includes(substr) && v === true);
    const colsOk = (hasCb('document title') || hasCb('citation information')) &&
      (hasCb('doi') || hasCb('citation information')) &&
      (hasCb('abstract')) &&
      (hasCb('author keywords') || hasCb('indexed keywords') || hasCb('index keywords') || hasCb('abstract & keywords'));

    if (!csvFormatOk || !countOk || !toOk || !fromOk || !colsOk || dialogVerify.exportBtnDisabled) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'DIALOG_PRECHECK_FAILED',
        displayedQuery,
        totalMain,
        dialogVerify,
        error: `STOPPED BEFORE EXPORT: Pre-click verification failed (csvFormatOk=${csvFormatOk}, count=${modalCount}/${expectedBatchCount}, fromOk=${fromOk}, toOk=${toOk}, colsOk=${colsOk}, disabled=${dialogVerify.exportBtnDisabled}).`
      });
    }

    const dlgLines = dlgSlice.split(/\r?\n/);
    const finalExportLine = [...dlgLines].reverse().find(l => /button\s+"(?:Export(?:\.\.\.)?|Confirm Export)"/i.test(l));
    const finalExportRef = finalExportLine && findRef(finalExportLine, /button/i);
    if (!finalExportRef) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'EXPORT_BTN_REF_MISSING',
        displayedQuery,
        totalMain,
        error: 'EXPORT ERROR: Final Export button reference not found inside CSV Export dialog.'
      });
    }

    // 8. Isolate & capture ONLY fresh download from this single Export click
    fs.mkdirSync(attemptDownloadDir, { recursive: true });
    if (isolateDownloads && wsUrl) {
      const monitorRes = await createCdpDownloadSession(wsUrl, activeTab?.targetId || null, attemptDownloadDir, { profileSafety });
      if (!monitorRes || !monitorRes.ok) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: monitorRes?.status || 'DOWNLOAD_MONITOR_FAILED',
          displayedQuery,
          totalMain,
          error: monitorRes?.error || 'CDP ATTRIBUTION ERROR: Failed to attach isolated CDP download monitor to approved tab.'
        });
      }
      cdpDownloadMonitor = monitorRes;
    }

    let beforeDownloadsMap = null;
    if (!cdpDownloadMonitor && downloadsDir && fs.existsSync(downloadsDir)) {
      beforeDownloadsMap = new Map();
      for (const name of fs.readdirSync(downloadsDir)) {
        try {
          const st = fs.statSync(path.join(downloadsDir, name));
          beforeDownloadsMap.set(name, { size: st.size, mtimeMs: st.mtimeMs });
        } catch {}
      }
    }

    const clickStartTime = Date.now();
    await call('agent_browser_click', { selector: finalExportRef, session });

    let downloadedSourcePath = null;
    let downloadAttribution = null;

    if (cdpDownloadMonitor) {
      const cdpRes = await cdpDownloadMonitor.waitForDownload(downloadTimeoutMs);
      if (!cdpRes.ok) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: cdpRes.ambiguous ? 'DOWNLOAD_AMBIGUOUS' : 'DOWNLOAD_FAILED',
          displayedQuery,
          totalMain,
          ignoredOtherTabCount: cdpRes.ignoredOtherTabCount || 0,
          ignoredOtherTabEvents: cdpRes.ignoredOtherTabEvents || [],
          error: cdpRes.error
        });
      }
      downloadedSourcePath = cdpRes.download.filePath;
      downloadAttribution = {
        method: 'cdp-event-allowAndName',
        guid: cdpRes.download.guid,
        suggestedFilename: cdpRes.download.suggestedFilename,
        frameId: cdpRes.download.frameId,
        isolatedDir: attemptDownloadDir,
        ignoredOtherTabCount: cdpRes.ignoredOtherTabCount || 0
      };
    } else {
      const watchDirs = Array.from(new Set([downloadsDir].filter(d => d && fs.existsSync(d))));
      if (watchDirs.length === 0) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'DOWNLOAD_DIR_MISSING',
          displayedQuery,
          totalMain,
          error: `EXPORT ERROR: Downloads directory does not exist (${downloadsDir}).`
        });
      }
      const watchDir = watchDirs[0];
      const deadline = Date.now() + downloadTimeoutMs;
      while (Date.now() < deadline) {
        const entries = fs.readdirSync(watchDir).map(name => {
          const fullPath = path.join(watchDir, name);
          try {
            const st = fs.statSync(fullPath);
            return { name, fullPath, size: st.size, mtimeMs: st.mtimeMs };
          } catch {
            return null;
          }
        }).filter(Boolean);

        const matchRes = identifyFreshDownload(beforeDownloadsMap, entries, { clickStartTime });
        if (matchRes.ambiguous) {
          return finishResult({
            ok: false,
            exportSuccess: false,
            status: 'DOWNLOAD_AMBIGUOUS',
            displayedQuery,
            totalMain,
            error: matchRes.error
          });
        }
        if (matchRes.ok) {
          downloadedSourcePath = matchRes.file.fullPath;
          downloadAttribution = {
            method: 'folder-diff-strict',
            observedFilename: matchRes.file.name,
            sourceDir: watchDir
          };
          break;
        }
        await new Promise(r => setTimeout(r, 250));
      }

      if (!downloadedSourcePath) {
        return finishResult({
          ok: false,
          exportSuccess: false,
          status: 'DOWNLOAD_TIMEOUT',
          displayedQuery,
          totalMain,
          error: `EXPORT FAILED: Fresh CSV download did not complete within ${downloadTimeoutMs}ms.`
        });
      }
    }

    // 9. Validate CSV schema & row count BEFORE placing in outputDir
    const rawCsvContent = fs.readFileSync(downloadedSourcePath, 'utf8');
    const csvCheck = validateScopusCsvContent(rawCsvContent, { expectedRowCount: expectedBatchCount });
    if (!csvCheck.ok) {
      return finishResult({
        ok: false,
        exportSuccess: false,
        status: 'CSV_VALIDATION_FAILED',
        displayedQuery,
        totalMain,
        downloadAttribution,
        missingColumns: csvCheck.missingColumns,
        presentColumns: csvCheck.presentColumns,
        parsedRowCount: csvCheck.parsedRowCount,
        blankCells: csvCheck.blankCells,
        error: csvCheck.error
      });
    }

    // 10. Copy atomically preserving any existing files byte-for-byte
    const placement = copyCsvPreservingExisting(downloadedSourcePath, outputDir, filenameCheck.filename);
    metrics.browserActionMs = Date.now() - browserActionStartMs;

    // Clean up our own fresh download only when using fallback folder if it was isolated, NEVER delete user pre-existing files
    if (!cdpDownloadMonitor && downloadedSourcePath && fs.existsSync(downloadedSourcePath)) {
      try { fs.rmSync(downloadedSourcePath, { force: true, maxRetries: 5, retryDelay: 120 }); } catch {}
    }

    return finishResult({
      ok: true,
      exportSuccess: true,
      status: 'EXPORTED',
      displayedQuery,
      totalMain,
      requestedRange: { from, to },
      effectiveRange: { from, to: effectiveTo },
      expectedRowCount: expectedBatchCount,
      parsedRowCount: csvCheck.parsedRowCount,
      csvHeaders: csvCheck.headers,
      presentColumns: csvCheck.presentColumns,
      missingColumns: csvCheck.missingColumns,
      blankCells: csvCheck.blankCells,
      firstTitle: csvCheck.firstTitle,
      exportFilePath: placement.placedPath,
      finalFilename: placement.finalFilename,
      preservedExistingFile: placement.preservedExisting,
      downloadAttribution,
      message: `Exported ${csvCheck.parsedRowCount} Scopus records (${from}-${effectiveTo} of ${totalMain}) to ${placement.placedPath}`
    });
  } catch (err) {
    return finishResult({
      ok: false,
      exportSuccess: false,
      status: err.code === 'TAB_GONE' ? 'TAB_GONE' : 'ERROR',
      error: err.message
    });
  } finally {
    if (cdpDownloadMonitor) {
      await cdpDownloadMonitor.cleanup();
    }
    try {
      if (fs.existsSync(attemptDownloadDir)) {
        fs.rmSync(attemptDownloadDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
      }
    } catch {}
    if (shouldCloseClient) {
      try { await client.callTool('agent_browser_close', { session }, 4000); } catch {}
      await client.close();
    }
  }
}
