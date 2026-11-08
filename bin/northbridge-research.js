#!/usr/bin/env node

/**
 * Northbridge Browser Research MCP Server entry point.
 * Provides a strictly isolated, read-only public web research interface backed by the pinned agent-browser.
 *
 * Security & Isolation Architecture:
 * 1. Session Isolation & Namespacing: Each server instance generates an unguessable cryptographic
 *    session namespace. The server strictly owns its sessions and tracks authorized sessions.
 *    Any caller-supplied session not created by this instance is rejected immediately across
 *    all tools (snapshot, read, click, scroll, close, tabs), preventing cross-session data leaks
 *    or unauthorized teardown.
 * 2. Pre-Request Network Boundary: Enforces domain restrictions at the engine level via
 *    allowedDomains, ensuring direct navigations, HTTP redirects, and page-initiated
 *    subresources (fetch, img, script) to localhost, private networks (RFC1918),
 *    link-local metadata, or unapproved domains are blocked before requests leave the browser.
 * 3. User-Enforced Domain Approval: Requires explicit user configuration of approved domains
 *    via NORTHBRIDGE_APPROVED_DOMAINS or --approved-domains. Agent self-approval in chat is
 *    rejected because the host cannot verify human confirmation.
 * 4. Boundary Non-Bypassable: User approval never overrides the private network or localhost boundary.
 * 5. Safe Read-Only Profile: Mutating actions (fill, type, press, eval) are strictly disabled.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns').promises;
const readline = require('node:readline');
const crypto = require('node:crypto');

// Generate unique unguessable session namespace for this research server instance
const instanceSecret = crypto.randomBytes(8).toString('hex');
const sessionPrefix = `nbr_${instanceSecret}_`;

function findAgentBrowser() {
  const localPkg = path.resolve(__dirname, '..', 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
  if (fs.existsSync(localPkg)) {
    return localPkg;
  }
  const parentPkg = path.resolve(__dirname, '..', '..', 'agent-browser', 'bin', 'agent-browser.js');
  if (fs.existsSync(parentPkg)) {
    return parentPkg;
  }
  return 'agent-browser';
}

function isPrivateIp(rawIp) {
  let ip = rawIp;
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] === 10) return true; // 10.0.0.0/8 (RFC1918)
    if (parts[0] === 127) return true; // 127.0.0.0/8 (Loopback)
    if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 (Link-local, cloud metadata)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12 (RFC1918)
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16 (RFC1918)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // 100.64.0.0/10 (Carrier NAT)
    if (parts[0] >= 224) return true; // Multicast / Reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::1' || norm === '::') return true;
    if (norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) return true; // fe80::/10 (Link-local)
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // fc00::/7 (Unique local)
    if (norm.startsWith('::ffff:')) {
      return isPrivateIp(norm.slice(7));
    }
    return false;
  }

  return true;
}

// Parse user-approved domains from environment or CLI arguments
const userApprovedDomains = new Set();

function parseApprovedDomains() {
  const rawList = [];
  if (process.env.NORTHBRIDGE_APPROVED_DOMAINS) {
    rawList.push(...process.env.NORTHBRIDGE_APPROVED_DOMAINS.split(','));
  }
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--approved-domains');
  if (flagIdx !== -1 && args[flagIdx + 1]) {
    rawList.push(...args[flagIdx + 1].split(','));
  }

  for (const raw of rawList) {
    const d = raw.trim().toLowerCase();
    if (!d) continue;

    // Reject private IP literals and localhost in approved list
    if (
      d === 'localhost' ||
      d.endsWith('.localhost') ||
      d.endsWith('.local') ||
      d.endsWith('.internal') ||
      d.endsWith('.lan') ||
      d === '127.0.0.1' ||
      d === '::1' ||
      d === '0.0.0.0'
    ) {
      console.error(`[northbridge-research] WARNING: Prohibited domain pattern "${d}" ignored. Private networks and loopback cannot be approved.`);
      continue;
    }

    if (net.isIP(d) && isPrivateIp(d)) {
      console.error(`[northbridge-research] WARNING: Prohibited private IP "${d}" ignored in approved domains.`);
      continue;
    }

    userApprovedDomains.add(d);
  }
}

parseApprovedDomains();

function domainMatches(host, pattern) {
  if (host === pattern) return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return host.endsWith('.' + base);
  }
  return false;
}

function isHostApproved(host) {
  for (const d of userApprovedDomains) {
    if (domainMatches(host, d)) return true;
  }
  return false;
}

async function validateUrlSecurity(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, error: 'Invalid URL provided (must be a non-empty string).' };
  }

  if (rawUrl === 'about:blank') {
    return { ok: true, url: 'about:blank', host: '' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return { ok: false, error: `Invalid URL format: "${rawUrl}" (${err.message}).` };
  }

  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') {
    return {
      ok: false,
      error: `[SECURITY POLICY VIOLATION] Prohibited URL scheme "${proto}". Only http: and https: protocols are permitted in Northbridge Research mode. Access to local files (file:) and internal schemes is blocked.`
    };
  }

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  // Check localhost / internal hostnames
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host === '0.0.0.0'
  ) {
    return {
      ok: false,
      error: `[SECURITY POLICY VIOLATION] Access to localhost or internal network target "${host}" is prohibited in Northbridge Research mode.`
    };
  }

  // Check IP literals
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      return {
        ok: false,
        error: `[SECURITY POLICY VIOLATION] Target IP "${host}" is a loopback or private network address. Access is strictly prohibited in Northbridge Research mode.`
      };
    }
  }

  // Check user approval before DNS lookup for public hostnames
  if (!isHostApproved(host)) {
    return {
      ok: false,
      requiresApproval: true,
      error: `[APPROVAL REQUIRED] Domain "${host}" is not in the user-approved domains list. In this host, add "${host}" to "NORTHBRIDGE_APPROVED_DOMAINS" in your MCP configuration to authorize it. In-chat agent self-approval is disabled because the host cannot enforce user confirmation.`
    };
  }

  // DNS pre-resolution check to prevent private-network rebinding
  if (!net.isIP(host)) {
    try {
      const records = await dns.lookup(host, { all: true });
      for (const rec of records) {
        if (isPrivateIp(rec.address)) {
          return {
            ok: false,
            error: `[SECURITY POLICY VIOLATION] Hostname "${host}" resolves to private/loopback IP address (${rec.address}). Navigation blocked.`
          };
        }
      }
    } catch (dnsErr) {
      return {
        ok: false,
        error: `DNS resolution failed for host "${host}": ${dnsErr.message}. Target host could not be verified.`
      };
    }
  }

  return { ok: true, url: parsed.toString(), host };
}

// Session ownership & namespacing tracking
const ownedSessions = new Set(); // Stores caller-facing session names created by this server

function toInternalSession(callerSession) {
  const name = callerSession || 'default';
  return `${sessionPrefix}${name}`;
}

const ALLOWED_TOOLS = new Set([
  'agent_browser_open',
  'agent_browser_read',
  'agent_browser_snapshot',
  'agent_browser_click',
  'agent_browser_scroll',
  'agent_browser_wait_ms',
  'agent_browser_wait_for_selector',
  'agent_browser_wait_for_text',
  'agent_browser_wait_for_load',
  'agent_browser_screenshot',
  'agent_browser_get_text',
  'agent_browser_get_url',
  'agent_browser_get_title',
  'agent_browser_close',
  'agent_browser_back',
  'agent_browser_forward',
  'agent_browser_reload',
  'agent_browser_tab_list',
  'agent_browser_tab_switch',
  'agent_browser_tab_close'
]);

class McpChildBridge {
  constructor(agentBrowserPath) {
    this.agentBrowserPath = agentBrowserPath;
    this.proc = null;
    this.msgId = 0;
    this.pending = new Map();
    this.buffer = '';
  }

  start() {
    const cleanEnv = { ...process.env };
    // Clear parent environment allowed domains so we pass session-specific allowedDomains array
    delete cleanEnv.AGENT_BROWSER_ALLOWED_DOMAINS;

    this.proc = spawn(process.execPath, [this.agentBrowserPath, 'mcp', '--tools', 'core'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: cleanEnv
    });

    this.proc.on('exit', (code, signal) => {
      for (const [id, { reject }] of this.pending) {
        reject(new Error(`Upstream agent-browser exited (code: ${code}, signal: ${signal})`));
      }
      this.pending.clear();
      process.exit(code ?? 0);
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
          console.error('[northbridge-research] Parse error from upstream:', e.message);
        }
      }
    });
  }

  send(msg) {
    return new Promise((resolve, reject) => {
      const id = msg.id ?? ++this.msgId;
      const outgoing = { ...msg, id };
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(outgoing) + '\n');
    });
  }
}

async function handleMcpServer() {
  const agentBrowserPath = findAgentBrowser();
  const bridge = new McpChildBridge(agentBrowserPath);
  bridge.start();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  const cleanup = () => {
    if (bridge.proc) {
      try { bridge.proc.kill(); } catch (e) {}
    }
    process.exit(0);
  };

  rl.on('close', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', () => {
    if (bridge.proc) {
      try { bridge.proc.kill(); } catch (e) {}
    }
  });

  rl.on('line', async line => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch (err) {
      console.error('[northbridge-research] Bad JSON on stdin:', err.message);
      return;
    }

    const { id, method, params } = req;

    // Handle notifications (no id)
    if (id === undefined) {
      if (bridge.proc && bridge.proc.stdin.writable) {
        bridge.proc.stdin.write(JSON.stringify(req) + '\n');
      }
      return;
    }

    if (method === 'initialize') {
      const upstreamResp = await bridge.send(req);
      if (upstreamResp.result && upstreamResp.result.serverInfo) {
        upstreamResp.result.serverInfo.name = 'northbridge-browser-research';
      }
      process.stdout.write(JSON.stringify(upstreamResp) + '\n');
      return;
    }

    if (method === 'tools/list') {
      const upstreamResp = await bridge.send(req);
      if (upstreamResp.result && Array.isArray(upstreamResp.result.tools)) {
        // Expose only safe read-only research tools
        upstreamResp.result.tools = upstreamResp.result.tools.filter(t => ALLOWED_TOOLS.has(t.name));
      }
      process.stdout.write(JSON.stringify(upstreamResp) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = { ...(params?.arguments || {}) };
      const callerSession = args.session || 'default';

      // Check tool permission
      if (!ALLOWED_TOOLS.has(toolName)) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{
              type: 'text',
              text: `Tool "${toolName}" is disabled in Northbridge Research mode (read-only safe profile). Form input and scripting actions are disallowed.`
            }]
          }
        }) + '\n');
        return;
      }

      // Handle session opening
      if (toolName === 'agent_browser_open') {
        const targetUrl = args.url;
        const validation = await validateUrlSecurity(targetUrl);
        if (!validation.ok) {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [{ type: 'text', text: validation.error }]
            }
          }) + '\n');
          return;
        }

        // Register session ownership and map to isolated internal name
        ownedSessions.add(callerSession);
        args.session = toInternalSession(callerSession);

        // Pass exact approved domains to engine's domain filter (Fetch.enable interceptor)
        args.allowedDomains = Array.from(userApprovedDomains);

        const upstreamReq = {
          ...req,
          params: {
            ...params,
            arguments: args
          }
        };

        const upstreamResp = await bridge.send(upstreamReq);
        process.stdout.write(JSON.stringify(upstreamResp) + '\n');
        return;
      }

      // For all other tools: enforce session ownership!
      if (!ownedSessions.has(callerSession)) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{
              type: 'text',
              text: `[SESSION ISOLATION VIOLATION] Session "${callerSession}" was not created by this Northbridge Research instance. Access is denied.`
            }]
          }
        }) + '\n');
        return;
      }

      // Map session to internal namespaced session
      args.session = toInternalSession(callerSession);

      // Handle direct fetch via agent_browser_read
      if (toolName === 'agent_browser_read' && args.url) {
        const readValidation = await validateUrlSecurity(args.url);
        if (!readValidation.ok) {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [{ type: 'text', text: readValidation.error }]
            }
          }) + '\n');
          return;
        }
      }

      // Handle session closing
      if (toolName === 'agent_browser_close') {
        const upstreamReq = {
          ...req,
          params: { ...params, arguments: args }
        };
        const upstreamResp = await bridge.send(upstreamReq);
        ownedSessions.delete(callerSession);
        process.stdout.write(JSON.stringify(upstreamResp) + '\n');
        return;
      }

      // Forward other allowed tools
      const upstreamReq = {
        ...req,
        params: { ...params, arguments: args }
      };
      const upstreamResp = await bridge.send(upstreamReq);
      process.stdout.write(JSON.stringify(upstreamResp) + '\n');
      return;
    }

    // Forward any other JSON-RPC method
    const upstreamResp = await bridge.send(req);
    process.stdout.write(JSON.stringify(upstreamResp) + '\n');
  });
}

async function main() {
  await handleMcpServer();
}

main().catch(err => {
  console.error('[northbridge-research] Fatal:', err.message);
  process.exit(1);
});
