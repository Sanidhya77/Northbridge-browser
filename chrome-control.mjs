#!/usr/bin/env node

/**
 * Northbridge Opt-In Chrome Control Manager & Loopback Control UI.
 *
 * Provides user-controlled interactive browser assistance inside a visible,
 * dedicated Chrome research profile using Agent Browser + CDP with genuine
 * browser/desktop host grants (model-provided `approved: true` alone is rejected).
 *
 * Capabilities:
 * - Dedicated research Chrome profile launcher (rejects shared default Chrome profiles)
 * - Original Northbridge Control Console UI (`http://127.0.0.1:<port>/control`)
 *   with per-launch secret token hidden from MCP tool outputs
 * - Tab selection, live controlled-tab status, pause, resume, and revoke controls
 * - Actions gated by real grant: snapshot, navigate, click, search_input, scroll, tab_switch
 * - Automatic handback to user for sign-in and CAPTCHA (no password entry or bypass)
 * - Explicit Google / Scholar block recording + Paper Orchestra / keyless fallbacks
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns/promises';
import { spawn, spawnSync } from 'node:child_process';
import {
  createMcpClient,
  discoverChromeEndpoint,
  inspectChromeProfileSafety,
  isSharedDefaultChromeProfileDir,
  findRef,
  isTabGone
} from './scopus-workflow.mjs';
import {
  sanitizeUrl,
  parseOutlineHeadings,
  extractTablesFromSnapshot,
  extractLinksFromSnapshot
} from './page-summary.mjs';

export function getDefaultResearchProfileDir() {
  if (process.env.NORTHBRIDGE_RESEARCH_PROFILE_DIR) {
    return path.resolve(process.env.NORTHBRIDGE_RESEARCH_PROFILE_DIR);
  }
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'Northbridge', 'ResearchProfile');
  }
  return path.join(os.tmpdir(), 'northbridge-research-profile');
}

export function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

function isPrivateOrLoopbackIp(rawIp) {
  let ip = String(rawIp || '').trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const n = ip.toLowerCase();
    if (n === '::1' || n === '::' || n.startsWith('fe8') || n.startsWith('fe9') || n.startsWith('fea') || n.startsWith('feb') || n.startsWith('fc') || n.startsWith('fd')) {
      return true;
    }
    if (n.startsWith('::ffff:')) return isPrivateOrLoopbackIp(n.slice(7));
    return false;
  }
  return true;
}

function isHostLoopback(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

export async function validateControlledNavigationUrl(rawUrl, { controlPort = null, allowLoopbackForTests = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { ok: false, status: 'INVALID_URL', error: 'Navigation URL must be a non-empty string.' };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return { ok: false, status: 'INVALID_URL', error: `Invalid navigation URL "${rawUrl}": ${err.message}` };
  }

  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') {
    return {
      ok: false,
      status: 'POLICY_BLOCKED',
      error: `Prohibited URL scheme "${proto}". Only http: and https: are permitted.`
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const portNum = parsed.port ? Number(parsed.port) : (proto === 'https:' ? 443 : 80);

  // Strict self-approval protection: block MCP actions from navigating to Northbridge Control UI
  if (controlPort && isHostLoopback(host) && portNum === Number(controlPort)) {
    return {
      ok: false,
      status: 'CONTROL_PANEL_SELF_APPROVAL_BLOCKED',
      error: 'SECURITY BOUNDARY: Controlled browser actions cannot access the Northbridge Control Console itself.'
    };
  }

  if (isHostLoopback(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host === '0.0.0.0') {
    if (!allowLoopbackForTests || !isHostLoopback(host)) {
      return {
        ok: false,
        status: 'POLICY_BLOCKED',
        error: `Loopback/internal target "${host}" is blocked in controlled research mode.`
      };
    }
    return { ok: true, url: parsed.toString(), host };
  }

  if (net.isIP(host)) {
    if (isPrivateOrLoopbackIp(host)) {
      return {
        ok: false,
        status: 'POLICY_BLOCKED',
        error: `Private network IP "${host}" is blocked.`
      };
    }
    return { ok: true, url: parsed.toString(), host };
  }

  try {
    const recs = await dns.lookup(host, { all: true });
    if (recs.some(r => isPrivateOrLoopbackIp(r.address))) {
      return {
        ok: false,
        status: 'POLICY_BLOCKED',
        error: `Hostname "${host}" resolved to a private or loopback IP address.`
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: 'DNS_ERROR',
      error: `DNS lookup failed for "${host}": ${err.message}`
    };
  }

  return { ok: true, url: parsed.toString(), host };
}

export function detectAuthCaptchaOrGoogleBlock({ url = '', title = '', snapshotText = '', httpStatus = null } = {}) {
  const cleanUrl = String(url || '');
  const combined = [title, snapshotText].join('\n');
  let hostname = '';
  try { hostname = new URL(cleanUrl).hostname.toLowerCase(); } catch {}

  const isGoogleHost = /(?:^|\.)google\.[a-z.]+$/i.test(hostname) || /(?:^|\.)scholar\.google\.[a-z.]+$/i.test(hostname) || /\bGoogle Scholar\b|\bGoogle Search\b/i.test(title);
  const isScholarHost = /(?:^|\.)scholar\.google\.[a-z.]+$/i.test(hostname) || /\bGoogle Scholar\b/i.test(title);

  // 1. CAPTCHA / Google Sorry / Bot-block patterns
  const sorryUrl = /\/sorry\/index/i.test(cleanUrl);
  const captchaText = [
    /unusual traffic from your computer network/i,
    /our systems have detected unusual traffic/i,
    /please show you['’]?re not a robot/i,
    /verify (?:that )?you are (?:a )?human/i,
    /\breCAPTCHA\b|g-recaptcha|hcaptcha|cf-turnstile|turnstile/i,
    /complete the security check/i,
    /automated requests|automated queries/i,
    /Sorry, you have been blocked/i,
    /Attention Required!\s*\|\s*Cloudflare/i,
    /Access Denied\b/i
  ].find(rx => rx.test(combined));

  if (sorryUrl || captchaText || httpStatus === 429 || (isGoogleHost && httpStatus === 403)) {
    const reason = sorryUrl
      ? 'Google /sorry/ anti-automation page encountered.'
      : (captchaText ? `CAPTCHA or bot challenge detected (${captchaText.source}).` : `HTTP ${httpStatus} automation block detected.`);

    return {
      detected: true,
      kind: isGoogleHost ? 'GOOGLE_BLOCK' : 'CAPTCHA',
      isGoogleBlock: isGoogleHost || sorryUrl,
      provider: isScholarHost ? 'Northbridge Chrome / Google Scholar' : (isGoogleHost ? 'Northbridge Chrome / Google' : 'Web Page'),
      reason,
      url: sanitizeUrl(cleanUrl),
      fallbackRoutes: [
        { provider: 'openalex', tool: 'paper_orchestra_lookup', reason: 'Keyless scholarly work & citation discovery' },
        { provider: 'crossref', tool: 'paper_orchestra_lookup', reason: 'Keyless journal DOI & metadata lookup' },
        { provider: 'datacite', tool: 'paper_orchestra_check_citation', reason: 'Keyless dataset & preprint DOI lookup' },
        { provider: 'semantic_scholar', tool: 'paper_orchestra_lookup', reason: 'Keyless complementary scholarly index' },
        { provider: 'northbridge_search_web', tool: 'northbridge_search_web', reason: 'Optional Brave web search (requires NORTHBRIDGE_BRAVE_SEARCH_API_KEY)' },
        { provider: 'host_web_search', tool: null, reason: 'Active host model built-in web search fallback' }
      ]
    };
  }

  // 2. Sign-In / Institutional SSO / MFA handback patterns
  const authUrl = /(?:^|\/)accounts\.google\.com\/|\/(?:ServiceLogin|signin|login|oauth|sso|saml)\b/i.test(cleanUrl);
  const authUi = [
    /Institutional Sign-In Required/i,
    /Sign in to access (?:Scopus|IEEE|this resource|full text)/i,
    /Log in via your institution/i,
    /Sign in with Google/i,
    /Enter your password/i,
    /textbox "Password"/i,
    /Two-factor authentication|Multi-factor authentication|Verify your identity/i
  ].find(rx => rx.test(combined));

  // Distinguish article body containing passing mention from actual login gate
  const hasFullArticleBody = combined.length > 4000 && /\bAbstract\b/i.test(combined) && /\bReferences\b/i.test(combined);
  if ((authUrl || authUi) && !hasFullArticleBody) {
    return {
      detected: true,
      kind: 'SIGNIN',
      isGoogleBlock: false,
      provider: hostname || 'Web Page',
      reason: authUi ? `Sign-in or authentication required (${authUi.source}).` : `Authentication page encountered (${sanitizeUrl(cleanUrl)}).`,
      url: sanitizeUrl(cleanUrl),
      fallbackRoutes: []
    };
  }

  return { detected: false, kind: null, isGoogleBlock: false };
}

function buildHudOverlayScript(state, tabLabel) {
  const mode = state === 'active' ? 'ACTIVE' : (state === 'paused_for_user' ? 'HANDBACK' : 'PAUSED');
  const bg = mode === 'ACTIVE' ? '#0f6e52' : (mode === 'HANDBACK' ? '#b45309' : '#475569');
  const title = mode === 'ACTIVE'
    ? `Northbridge Controlling · ${tabLabel || 'Research Tab'}`
    : (mode === 'HANDBACK' ? 'Northbridge Handed Back · User Sign-In/CAPTCHA' : 'Northbridge Paused · User Control');
  const safeBg = JSON.stringify(bg);
  const safeTitle = JSON.stringify(title.slice(0, 72));
  return `(() => {
    try {
      const id = '__northbridge_control_hud__';
      let host = document.getElementById(id);
      if (!host) {
        host = document.createElement('div');
        host.id = id;
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;';
        const shadow = host.attachShadow({ mode: 'open' });
        const pill = document.createElement('div');
        pill.id = 'pill';
        pill.style.cssText = 'padding:6px 12px;border-radius:999px;color:#fff;font-size:12px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,0.22);display:flex;align-items:center;gap:6px;letter-spacing:0.01em;';
        shadow.appendChild(pill);
        (document.documentElement || document.body).appendChild(host);
      }
      const pill = host.shadowRoot && host.shadowRoot.getElementById('pill');
      if (pill) {
        pill.style.background = ${safeBg};
        pill.textContent = ${safeTitle};
      }
    } catch {}
  })()`;
}

const REMOVE_HUD_SCRIPT = `(() => {
  try {
    const el = document.getElementById('__northbridge_control_hud__');
    if (el) el.remove();
  } catch {}
})()`;

async function evalOnTargetId(cdpPort, targetId, expression) {
  if (!cdpPort || !targetId) return false;
  let wsUrl = null;
  try {
    const list = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${cdpPort}/json/list`, { timeout: 1200 }, (res) => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => {
          try { resolve(JSON.parse(b)); } catch { resolve([]); }
        });
      }).on('error', reject);
    });
    const match = Array.isArray(list) ? list.find(t => t.id === targetId) : null;
    wsUrl = match?.webSocketDebuggerUrl || null;
  } catch {
    return false;
  }
  if (!wsUrl) return false;

  const ws = new WebSocket(wsUrl);
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws open timeout')), 1200);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('ws error')); }, { once: true });
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    await new Promise(r => setTimeout(r, 80));
    return true;
  } catch {
    return false;
  } finally {
    try { ws.close(); } catch {}
  }
}

async function listChromeTabsDirect(cdpPort) {
  const raw = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${cdpPort}/json/list`, { timeout: 1500 }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('CDP /json/list timeout')); });
  });
  return (Array.isArray(raw) ? raw : []).filter(t => t.type === 'page').map(t => ({
    targetId: t.id,
    title: t.title || '(Untitled)',
    url: t.url || ''
  }));
}

async function openChromeTabDirect(cdpPort, url) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: cdpPort,
      path: `/json/new?${encodeURIComponent(url)}`,
      method: 'PUT',
      timeout: 2500
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve({ raw: b }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function renderControlConsoleHtml(uiToken) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Northbridge Chrome Control Console</title>
  <style>
    :root {
      --bg: #f8fafc; --card: #ffffff; --border: #e2e8f0; --ink: #0f172a; --muted: #475569;
      --green: #0f6e52; --green-bg: #ecfdf5; --amber: #b45309; --amber-bg: #fffbeb;
      --red: #b91c1c; --red-bg: #fef2f2; --navy: #365377;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--ink); padding: 24px; line-height: 1.45; }
    .container { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
    .header { display: flex; align-items: center; justify-content: space-between; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 22px; }
    .brand { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: var(--green); text-transform: uppercase; }
    h1 { margin: 4px 0 0; font-size: 20px; }
    .pill { padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; background: #e2e8f0; color: var(--ink); }
    .pill.active { background: var(--green-bg); color: var(--green); border: 1px solid #a7f3d0; }
    .pill.paused, .pill.paused_for_user { background: var(--amber-bg); color: var(--amber); border: 1px solid #fde68a; }
    .pill.revoked { background: var(--red-bg); color: var(--red); border: 1px solid #fecaca; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 22px; }
    .card h2 { margin: 0 0 12px; font-size: 15px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    button { border: 1px solid var(--border); background: #fff; color: var(--ink); padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    button.primary { background: var(--green); color: #fff; border-color: var(--green); }
    button.warn { background: var(--amber); color: #fff; border-color: var(--amber); }
    button.danger { background: var(--red); color: #fff; border-color: var(--red); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .tab-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; gap: 12px; }
    .tab-item.controlled { border-color: var(--green); background: var(--green-bg); }
    .tab-meta { min-width: 0; flex: 1; }
    .tab-title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tab-url { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .banner { padding: 12px 16px; border-radius: 10px; font-size: 13px; display: none; }
    .banner.show { display: block; }
    .banner.warn { background: var(--amber-bg); border: 1px solid #fcd34d; color: #78350f; }
    .banner.block { background: var(--red-bg); border: 1px solid #fca5a5; color: #7f1d1d; }
    .log-list { font-family: ui-monospace, Consolas, monospace; font-size: 12px; max-height: 220px; overflow-y: auto; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; }
    .log-entry { margin-bottom: 4px; }
    input[type=url] { flex: 1; min-width: 240px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="brand">Northbridge Research Profile</div>
        <h1>Chrome Opt-In Control Console</h1>
      </div>
      <div id="status-pill" class="pill">No Grant</div>
    </div>

    <div id="handback-banner" class="banner warn"></div>
    <div id="block-banner" class="banner block"></div>

    <div class="card">
      <h2>Controlled Tab & Session Controls</h2>
      <p id="controlled-summary" style="margin:0 0 12px;color:#475569;font-size:14px;">No tab is currently approved for agent control.</p>
      <div class="row">
        <button id="btn-pause" class="warn" disabled>Pause Control</button>
        <button id="btn-resume" class="primary" disabled>Resume Control</button>
        <button id="btn-revoke" class="danger" disabled>Revoke Control</button>
      </div>
    </div>

    <div class="card">
      <h2>Select a Research Tab to Approve</h2>
      <p style="margin:0 0 12px;font-size:13px;color:#475569;">AI agents cannot self-approve tabs. Explicitly select and grant control to a research tab below.</p>
      <div id="tab-list">Loading tabs...</div>
      <form id="open-form" class="row" style="margin-top:12px;">
        <input id="open-url" type="url" placeholder="https://arxiv.org/ or https://scholar.google.com/" required />
        <button type="submit">Open Manual Tab</button>
      </form>
    </div>

    <div class="card">
      <h2>Live Control Audit Log</h2>
      <div id="audit-log" class="log-list">Waiting for activity...</div>
    </div>
  </div>
  <script>
    const TOKEN = ${JSON.stringify(uiToken)};
    async function api(path, method = 'GET', body = null) {
      const opts = {
        method,
        headers: { 'x-northbridge-ui-token': TOKEN, 'content-type': 'application/json' }
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(path, opts);
      return res.json();
    }
    async function refresh() {
      try {
        const st = await api('/api/state');
        const pill = document.getElementById('status-pill');
        pill.className = 'pill ' + (st.grantStatus || '');
        pill.textContent = ({
          none: 'Awaiting User Selection',
          active: 'Controlling Tab',
          paused: 'Paused by User',
          paused_for_user: 'Handed Back (Sign-In/CAPTCHA)',
          revoked: 'Control Revoked'
        }[st.grantStatus] || st.grantStatus);

        const summary = document.getElementById('controlled-summary');
        if (st.controlledTab && st.grantStatus !== 'revoked' && st.grantStatus !== 'none') {
          summary.innerHTML = '<strong>Controlled:</strong> ' + escapeHtml(st.controlledTab.title) + ' — <code>' + escapeHtml(st.controlledTab.url) + '</code>';
        } else {
          summary.textContent = 'No tab is currently under agent control.';
        }

        document.getElementById('btn-pause').disabled = st.grantStatus !== 'active';
        document.getElementById('btn-resume').disabled = (st.grantStatus !== 'paused' && st.grantStatus !== 'paused_for_user');
        document.getElementById('btn-revoke').disabled = (st.grantStatus === 'none' || st.grantStatus === 'revoked');

        const hb = document.getElementById('handback-banner');
        if (st.grantStatus === 'paused_for_user') {
          hb.className = 'banner warn show';
          hb.textContent = 'Control handed back to you: ' + (st.handbackReason || 'Manual action required.') + ' Complete it in Chrome, then click Resume Control.';
        } else {
          hb.className = 'banner warn';
        }

        const bb = document.getElementById('block-banner');
        if (st.googleBlocks && st.googleBlocks.length > 0) {
          const latest = st.googleBlocks[st.googleBlocks.length - 1];
          bb.className = 'banner block show';
          bb.textContent = 'Latest Search Block (' + latest.provider + '): ' + latest.reason + ' — Fallbacks returned (OpenAlex / Crossref / DataCite).';
        } else {
          bb.className = 'banner block';
        }

        const listEl = document.getElementById('tab-list');
        if (!st.tabs || st.tabs.length === 0) {
          listEl.textContent = 'No open research tabs yet. Open one below.';
        } else {
          listEl.innerHTML = '';
          for (const t of st.tabs) {
            const isCurr = st.controlledTab && st.controlledTab.targetId === t.targetId && (st.grantStatus === 'active' || st.grantStatus === 'paused' || st.grantStatus === 'paused_for_user');
            const row = document.createElement('div');
            row.className = 'tab-item' + (isCurr ? ' controlled' : '');
            const meta = document.createElement('div');
            meta.className = 'tab-meta';
            meta.innerHTML = '<div class="tab-title">' + escapeHtml(t.title) + '</div><div class="tab-url">' + escapeHtml(t.url) + '</div>';
            const btn = document.createElement('button');
            btn.className = isCurr ? '' : 'primary';
            btn.textContent = isCurr ? 'Selected' : 'Select & Grant Control';
            btn.disabled = isCurr;
            btn.onclick = async () => { await api('/api/grant', 'POST', { targetId: t.targetId }); await refresh(); };
            row.appendChild(meta);
            row.appendChild(btn);
            listEl.appendChild(row);
          }
        }

        const logEl = document.getElementById('audit-log');
        if (st.auditLog && st.auditLog.length > 0) {
          logEl.innerHTML = st.auditLog.slice(-25).reverse().map(e => '<div class="log-entry">[' + escapeHtml(e.at) + '] ' + escapeHtml(e.action) + ' — ' + escapeHtml(e.detail) + '</div>').join('');
        }
      } catch {}
    }
    function escapeHtml(s) {
      return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    document.getElementById('btn-pause').onclick = async () => { await api('/api/pause', 'POST'); await refresh(); };
    document.getElementById('btn-resume').onclick = async () => { await api('/api/resume', 'POST'); await refresh(); };
    document.getElementById('btn-revoke').onclick = async () => { await api('/api/revoke', 'POST'); await refresh(); };
    document.getElementById('open-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const url = document.getElementById('open-url').value.trim();
      if (!url) return;
      await api('/api/open-tab', 'POST', { url });
      document.getElementById('open-url').value = '';
      await refresh();
    };
    refresh();
    setInterval(refresh, 1500);
  </script>
</body>
</html>`;
}

export function createControlManager(options = {}) {
  const {
    profileDir = getDefaultResearchProfileDir(),
    headless = false,
    allowLoopbackForTests = false,
    clientFactory = null,
    tabLister = null,
    tabOpener = null,
    hudUpdater = null,
    chromeLauncher = null
  } = options;

  const uiToken = crypto.randomBytes(24).toString('hex');
  let controlServer = null;
  let controlPort = null;
  let chromeProc = null;
  let cdpPort = null;
  let mcpClient = null;
  let boundActiveTargetId = null;
  const sessionId = 'nb-ctrl-' + crypto.randomBytes(4).toString('hex');

  const state = {
    started: false,
    profileDir: path.resolve(String(profileDir)),
    grant: null, // { id, status: 'active'|'paused'|'paused_for_user'|'revoked', controlledTab, grantedTabIds: Set, grantedBy, handbackReason, handbackType }
    googleBlocks: [],
    auditLog: []
  };

  function logAudit(action, detail) {
    state.auditLog.push({
      at: new Date().toISOString().slice(11, 19),
      action,
      detail: sanitizeUrl(String(detail || ''))
    });
    if (state.auditLog.length > 100) state.auditLog.shift();
  }

  function isControlUrl(rawUrl) {
    if (!controlPort || !rawUrl) return false;
    try {
      const u = new URL(String(rawUrl));
      const p = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
      return isHostLoopback(u.hostname) && p === Number(controlPort);
    } catch {
      return String(rawUrl).includes(`127.0.0.1:${controlPort}`);
    }
  }

  async function fetchVisibleResearchTabs() {
    let rawTabs = [];
    if (tabLister) {
      rawTabs = await tabLister();
    } else if (cdpPort) {
      rawTabs = await listChromeTabsDirect(cdpPort);
    } else if (mcpClient) {
      const r = await mcpClient.callTool('agent_browser_tab_list', { session: sessionId });
      rawTabs = (r.raw?.structuredContent?.response?.data?.tabs || []).map(t => ({
        targetId: t.targetId || t.tabId,
        title: t.title || '(Untitled)',
        url: t.url || ''
      }));
    }
    return rawTabs.filter(t => !isControlUrl(t.url) && t.title !== 'Northbridge Chrome Control Console');
  }

  async function syncHud(grant) {
    if (!grant || !grant.controlledTab?.targetId) return;
    const tid = grant.controlledTab.targetId;
    if (hudUpdater) {
      await hudUpdater(tid, grant.status, grant.controlledTab.title);
      return;
    }
    if (!cdpPort) return;
    if (grant.status === 'revoked') {
      await evalOnTargetId(cdpPort, tid, REMOVE_HUD_SCRIPT);
    } else {
      await evalOnTargetId(cdpPort, tid, buildHudOverlayScript(grant.status, grant.controlledTab.title));
    }
  }

  async function grantTabControlFromHost({ targetId, grantedBy = 'browser-ui', allowTabSwitching = false } = {}) {
    const tabs = await fetchVisibleResearchTabs();
    const target = targetId
      ? tabs.find(t => t.targetId === targetId)
      : (tabs.length === 1 ? tabs[0] : null);

    if (!target) {
      return {
        ok: false,
        status: targetId ? 'TAB_NOT_FOUND' : 'TAB_SELECTION_REQUIRED',
        error: targetId
          ? `No selectable research tab found with targetId '${targetId}'.`
          : 'Multiple or zero research tabs exist; select a specific tab to grant control.'
      };
    }

    if (isControlUrl(target.url)) {
      return {
        ok: false,
        status: 'CONTROL_PANEL_SELF_APPROVAL_BLOCKED',
        error: 'Cannot grant agent control to the Control Console tab itself.'
      };
    }

    const grantId = 'grant_' + crypto.randomBytes(6).toString('hex');
    const prevIds = state.grant?.grantedTabIds ? Array.from(state.grant.grantedTabIds) : [];
    state.grant = {
      id: grantId,
      status: 'active',
      controlledTab: { ...target, url: sanitizeUrl(target.url) },
      grantedTabIds: new Set([...prevIds, target.targetId]),
      allowTabSwitching: Boolean(allowTabSwitching),
      grantedBy,
      handbackReason: null,
      handbackType: null
    };
    logAudit('GRANT', `${grantedBy} approved tab "${target.title}" (${sanitizeUrl(target.url)})`);
    await syncHud(state.grant);
    return { ok: true, grantId, grantStatus: 'active', controlledTab: state.grant.controlledTab };
  }

  async function pauseControlFromHost(reason = 'Paused by user') {
    if (!state.grant || state.grant.status === 'revoked') {
      return { ok: false, status: 'NO_ACTIVE_GRANT' };
    }
    state.grant.status = 'paused';
    state.grant.handbackReason = reason;
    logAudit('PAUSE', reason);
    await syncHud(state.grant);
    return { ok: true, grantStatus: 'paused' };
  }

  async function resumeControlFromHost() {
    if (!state.grant) return { ok: false, status: 'NO_GRANT' };
    if (state.grant.status === 'revoked') {
      return { ok: false, status: 'CONTROL_REVOKED', error: 'Revoked grants cannot be resumed. Grant a tab again.' };
    }
    state.grant.status = 'active';
    state.grant.handbackReason = null;
    state.grant.handbackType = null;
    logAudit('RESUME', `User resumed control on "${state.grant.controlledTab?.title}"`);
    await syncHud(state.grant);
    return { ok: true, grantStatus: 'active', controlledTab: state.grant.controlledTab };
  }

  async function revokeControlFromHost(reason = 'Revoked by user') {
    if (!state.grant) return { ok: false, status: 'NO_GRANT' };
    state.grant.status = 'revoked';
    state.grant.handbackReason = reason;
    logAudit('REVOKE', reason);
    await syncHud(state.grant);
    return { ok: true, grantStatus: 'revoked' };
  }

  async function startControlHttpServer() {
    if (controlServer) return controlPort;
    controlServer = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && reqUrl.pathname === '/control') {
        if (reqUrl.searchParams.get('uiToken') !== uiToken) {
          res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden: valid uiToken required.');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        }).end(renderControlConsoleHtml(uiToken));
        return;
      }

      if (reqUrl.pathname.startsWith('/api/')) {
        const hdrToken = req.headers['x-northbridge-ui-token'];
        const fetchSite = req.headers['sec-fetch-site'];
        if (hdrToken !== uiToken || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
          res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'Invalid host UI token or cross-site request rejected.' }));
          return;
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        let body = {};
        if (chunks.length > 0) {
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        }

        if (req.method === 'GET' && reqUrl.pathname === '/api/state') {
          let tabs = [];
          try { tabs = await fetchVisibleResearchTabs(); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            grantStatus: state.grant ? state.grant.status : 'none',
            controlledTab: state.grant?.controlledTab || null,
            handbackReason: state.grant?.handbackReason || null,
            googleBlocks: state.googleBlocks,
            auditLog: state.auditLog,
            tabs
          }));
          return;
        }
        if (req.method === 'POST' && reqUrl.pathname === '/api/grant') {
          const out = await grantTabControlFromHost({ targetId: body.targetId, grantedBy: 'browser-ui' });
          res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
          return;
        }
        if (req.method === 'POST' && reqUrl.pathname === '/api/pause') {
          const out = await pauseControlFromHost('User clicked Pause in Chrome Control Console');
          res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
          return;
        }
        if (req.method === 'POST' && reqUrl.pathname === '/api/resume') {
          const out = await resumeControlFromHost();
          res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
          return;
        }
        if (req.method === 'POST' && reqUrl.pathname === '/api/revoke') {
          const out = await revokeControlFromHost('User clicked Revoke in Chrome Control Console');
          res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
          return;
        }
        if (req.method === 'POST' && reqUrl.pathname === '/api/open-tab') {
          const v = await validateControlledNavigationUrl(body.url, { controlPort, allowLoopbackForTests });
          if (!v.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify(v));
            return;
          }
          if (tabOpener) await tabOpener(v.url);
          else if (cdpPort) await openChromeTabDirect(cdpPort, v.url);
          logAudit('USER_OPEN_TAB', v.url);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, url: v.url }));
          return;
        }
      }

      res.writeHead(404).end('Not found');
    });

    await new Promise(resolve => controlServer.listen(0, '127.0.0.1', resolve));
    controlPort = controlServer.address().port;
    return controlPort;
  }

  async function start({ initialUrl = null, cdp = null } = {}) {
    if (isSharedDefaultChromeProfileDir(state.profileDir)) {
      return {
        ok: false,
        status: 'DEDICATED_PROFILE_REQUIRED',
        error: `Refusing to launch or control shared default Chrome profile '${state.profileDir}'. Use a dedicated Northbridge research profile.`
      };
    }

    await startControlHttpServer();
    const consoleUrlForChrome = `http://127.0.0.1:${controlPort}/control?uiToken=${uiToken}`;

    if (cdp) {
      const check = await discoverChromeEndpoint({ cdp, profileDir: state.profileDir });
      if (!check.valid) return { ok: false, status: 'CDP_ERROR', error: check.error };
      const safety = inspectChromeProfileSafety({ profileDir: state.profileDir, endpointCheck: check, activeCdpPort: check.port });
      if (!safety.isDedicated) {
        return { ok: false, status: 'DEDICATED_PROFILE_REQUIRED', error: safety.error };
      }
      cdpPort = check.port;
    } else if (chromeLauncher) {
      const launched = await chromeLauncher({ profileDir: state.profileDir, controlUrl: consoleUrlForChrome, initialUrl, headless });
      cdpPort = launched.cdpPort;
      chromeProc = launched.proc || null;
    } else if (!clientFactory) {
      // Check if an existing dedicated profile Chrome is already open
      const existing = await discoverChromeEndpoint({ autoConnect: true, profileDir: state.profileDir, requireDedicatedProfile: true });
      if (existing.valid) {
        cdpPort = existing.port;
        await openChromeTabDirect(cdpPort, consoleUrlForChrome);
      } else {
        const chromeExe = findChromeExecutable();
        if (!chromeExe) {
          return {
            ok: false,
            status: 'CHROME_NOT_FOUND',
            error: 'Google Chrome executable not found. Install Chrome or set CHROME_PATH.'
          };
        }
        fs.mkdirSync(state.profileDir, { recursive: true });
        const chromeArgs = [
          '--remote-debugging-port=0',
          `--user-data-dir=${state.profileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          ...(headless ? ['--headless=new'] : []),
          consoleUrlForChrome
        ];
        chromeProc = spawn(chromeExe, chromeArgs, { detached: false, stdio: 'ignore' });
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          const check = await discoverChromeEndpoint({ autoConnect: true, profileDir: state.profileDir, requireDedicatedProfile: true });
          if (check.valid) {
            cdpPort = check.port;
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }
        if (!cdpPort) {
          return { ok: false, status: 'CHROME_START_TIMEOUT', error: 'Dedicated research Chrome did not expose a DevTools endpoint in time.' };
        }
        if (initialUrl) {
          await openChromeTabDirect(cdpPort, initialUrl);
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    if (!mcpClient) {
      mcpClient = clientFactory
        ? await clientFactory({ cdp: cdpPort, pinTab: true })
        : createMcpClient({ cdp: cdpPort, pinTab: true, allowedDomains: null });
      await mcpClient.init();
    }

    state.started = true;
    const tabs = await fetchVisibleResearchTabs();
    logAudit('START', `Dedicated profile ready (${state.profileDir})`);
    return {
      ok: true,
      status: 'AWAITING_USER_GRANT',
      profileDir: state.profileDir,
      headless,
      controlPort,
      controlConsoleDisplayUrl: `http://127.0.0.1:${controlPort}/control`,
      grantStatus: state.grant ? state.grant.status : 'none',
      availableTabs: tabs.map(t => ({ targetId: t.targetId, title: t.title, url: sanitizeUrl(t.url) })),
      message: 'Visible dedicated Chrome research profile started. Open tabs are listed; ask the user to select and grant control to a tab in the Northbridge Chrome Control Console.'
    };
  }

  async function status() {
    const tabs = state.started ? await fetchVisibleResearchTabs() : [];
    return {
      ok: true,
      started: state.started,
      profileDir: state.profileDir,
      grantStatus: state.grant ? state.grant.status : 'none',
      controlledTab: state.grant?.controlledTab || null,
      handbackReason: state.grant?.handbackReason || null,
      availableTabs: tabs.map(t => ({ targetId: t.targetId, title: t.title, url: sanitizeUrl(t.url) })),
      googleBlocks: state.googleBlocks,
      auditLog: state.auditLog.slice(-15)
    };
  }

  async function act(params = {}) {
    const {
      action,
      url = null,
      selector = null,
      ref = null,
      text = '',
      submit = false,
      direction = 'down',
      amount = 700,
      tab = null,
      section = null,
      maxChars = 2200,
      queryHint = null
    } = params;

    if (!state.started || !mcpClient) {
      return { ok: false, status: 'NOT_STARTED', error: 'Call northbridge_control_start first.' };
    }

    // Notice: even if caller passed `params.approved === true`, we intentionally ignore it
    // and enforce a genuine out-of-band browser UI or host grant in `state.grant`.
    if (!state.grant) {
      return {
        ok: false,
        status: 'HOST_GRANT_REQUIRED',
        error: 'REAL USER GRANT REQUIRED: A model-provided approved flag alone is insufficient. Select a tab and click "Select & Grant Control" in the Northbridge Chrome Control Console first.'
      };
    }

    if (state.grant.status === 'revoked') {
      return {
        ok: false,
        status: 'CONTROL_REVOKED',
        error: 'User revoked control. Future browser actions are blocked until the user issues a fresh grant.'
      };
    }

    if (state.grant.status === 'paused') {
      return {
        ok: false,
        status: 'CONTROL_PAUSED',
        error: 'Control is paused by the user. Wait for the user to click Resume Control in Chrome.'
      };
    }

    if (state.grant.status === 'paused_for_user') {
      return {
        ok: false,
        status: state.grant.handbackType === 'CAPTCHA' ? 'HANDED_BACK_CAPTCHA' : 'HANDED_BACK_SIGNIN',
        handedBack: true,
        resumeRequired: true,
        error: `Control was handed back to the user (${state.grant.handbackReason}). Resume in the Control Console after finishing.`
      };
    }

    // Guard against accessing or switching to Control Console itself
    const targetRef = ref || selector;
    if ((url && isControlUrl(url)) || (tab && isControlUrl(tab))) {
      return {
        ok: false,
        status: 'CONTROL_PANEL_SELF_APPROVAL_BLOCKED',
        error: 'SECURITY BOUNDARY: Agent cannot inspect, navigate to, or click inside the Northbridge Control Console.'
      };
    }

    const boundTab = state.grant.controlledTab;
    if (!boundTab?.targetId) {
      return { ok: false, status: 'HOST_GRANT_REQUIRED', error: 'No bound target tab in grant.' };
    }

    // Handle tab switching safely across granted/research tabs
    if (action === 'tab_switch') {
      const tabs = await fetchVisibleResearchTabs();
      const needle = String(tab || '').trim().toLowerCase();
      if (!needle) {
        return { ok: false, status: 'TAB_REQUIRED', error: 'Provide `tab` title, URL substring, or targetId to switch.' };
      }
      const matches = tabs.filter(t =>
        t.targetId === tab ||
        (t.title && t.title.toLowerCase().includes(needle)) ||
        (t.url && t.url.toLowerCase().includes(needle))
      );
      if (matches.length === 0) {
        return { ok: false, status: 'TAB_NOT_FOUND', error: `No non-control tab matches '${tab}'.` };
      }
      if (matches.length > 1) {
        return { ok: false, status: 'TAB_AMBIGUOUS', error: `Ambiguous tab match (${matches.length} tabs match '${tab}').` };
      }
      const chosen = matches[0];
      if (!state.grant.grantedTabIds.has(chosen.targetId) && !state.grant.allowTabSwitching) {
        return {
          ok: false,
          status: 'HOST_GRANT_REQUIRED',
          error: `Tab "${chosen.title}" has not been granted control by the user.`
        };
      }
      await mcpClient.callTool('agent_browser_tab_switch', { tab: chosen.targetId, session: sessionId });
      boundActiveTargetId = chosen.targetId;
      state.grant.controlledTab = { ...chosen, url: sanitizeUrl(chosen.url) };
      state.grant.grantedTabIds.add(chosen.targetId);
      await syncHud(state.grant);
      logAudit('TAB_SWITCH', `Switched to "${chosen.title}" (${sanitizeUrl(chosen.url)})`);
    } else {
      // Ensure bound tab is still alive and active without redundantly resetting @refs via tab_switch
      const liveTabs = await fetchVisibleResearchTabs();
      if (liveTabs.length > 0 && !liveTabs.some(t => t.targetId === boundTab.targetId)) {
        state.grant.status = 'revoked';
        boundActiveTargetId = null;
        return {
          ok: false,
          status: 'TAB_GONE',
          error: `Controlled tab "${boundTab.title}" was closed. Grant terminated.`
        };
      }
      if (boundActiveTargetId !== boundTab.targetId) {
        const sw = await mcpClient.callTool('agent_browser_tab_switch', { tab: boundTab.targetId, session: sessionId });
        if (isTabGone(sw) || sw.raw?.isError) {
          return { ok: false, status: 'TAB_SWITCH_FAILED', error: sw.text || 'Failed to focus bound tab.' };
        }
        boundActiveTargetId = boundTab.targetId;
      }
    }

    // Execute specific controlled action
    if (action === 'navigate') {
      const val = await validateControlledNavigationUrl(url, { controlPort, allowLoopbackForTests });
      if (!val.ok) return val;
      const openRes = await mcpClient.callTool('agent_browser_open', { url: val.url, session: sessionId });
      if (openRes.raw?.isError) {
        return { ok: false, status: 'NAVIGATION_ERROR', error: openRes.text || 'Navigation failed.' };
      }
      logAudit('NAVIGATE', val.url);
    } else if (action === 'click') {
      if (!targetRef) return { ok: false, status: 'SELECTOR_REQUIRED', error: 'Provide `ref` or `selector` to click.' };
      const clkRes = await mcpClient.callTool('agent_browser_click', { selector: targetRef, session: sessionId });
      if (clkRes.raw?.isError) return { ok: false, status: 'CLICK_ERROR', error: clkRes.text || 'Click failed.' };
      logAudit('CLICK', targetRef);
    } else if (action === 'search_input') {
      if (!targetRef) return { ok: false, status: 'SELECTOR_REQUIRED', error: 'Provide `ref` or `selector` for the search input field.' };
      if (!text || typeof text !== 'string') return { ok: false, status: 'TEXT_REQUIRED', error: 'Provide search `text`.' };

      // Guard against filling password / credential inputs
      const preSnap = await mcpClient.callTool('agent_browser_snapshot', { compact: true, interactive: false, includeUrls: true, session: sessionId });
      const lines = (preSnap.text || '').split(/\r?\n/);
      const matchedLine = lines.find(l => l.includes(`ref=${String(targetRef).replace(/^@/, '')}`)) || '';
      if (/password|passcode|pin|secret|credit/i.test(matchedLine) || /type=["']?password|\b(?:pass|pwd|passwd|password|secret|otp)\b/i.test(String(targetRef))) {
        state.grant.status = 'paused_for_user';
        state.grant.handbackType = 'SIGNIN';
        state.grant.handbackReason = 'Password/credential input requires direct user entry.';
        await syncHud(state.grant);
        return {
          ok: false,
          status: 'HANDED_BACK_SIGNIN',
          handedBack: true,
          resumeRequired: true,
          error: 'PASSWORD_INPUT_BLOCKED: Agents cannot enter passwords or credentials. Control handed back to user.'
        };
      }

      const fillRes = await mcpClient.callTool('agent_browser_fill', { selector: targetRef, text, session: sessionId });
      if (fillRes.raw?.isError) return { ok: false, status: 'FILL_ERROR', error: fillRes.text || 'Failed to fill search input.' };
      if (submit) {
        await mcpClient.callTool('agent_browser_press', { key: 'Enter', session: sessionId });
      }
      logAudit('SEARCH_INPUT', `${targetRef} <= "${text}"${submit ? ' + Enter' : ''}`);
    } else if (action === 'scroll') {
      const dir = ['up', 'down', 'left', 'right'].includes(direction) ? direction : 'down';
      const scrRes = await mcpClient.callTool('agent_browser_scroll', { direction: dir, amount: Number(amount) || 700, selector: selector || undefined, session: sessionId });
      if (scrRes.raw?.isError) return { ok: false, status: 'SCROLL_ERROR', error: scrRes.text || 'Scroll failed.' };
      logAudit('SCROLL', `${dir} (${Number(amount) || 700}px)`);
    } else if (action !== 'snapshot' && action !== 'tab_switch') {
      return { ok: false, status: 'UNKNOWN_ACTION', error: `Unsupported control action "${action}". Supported: snapshot, navigate, click, search_input, scroll, tab_switch.` };
    } else if (action === 'snapshot') {
      logAudit('SNAPSHOT', state.grant.controlledTab.url);
    }

    // Settle briefly and observe final state
    if (action !== 'snapshot') {
      try { await mcpClient.callTool('agent_browser_wait_ms', { ms: 250, session: sessionId }); } catch {}
    }

    const titleRes = await mcpClient.callTool('agent_browser_get_title', { session: sessionId });
    const urlRes = await mcpClient.callTool('agent_browser_get_url', { session: sessionId });
    const snapRes = await mcpClient.callTool('agent_browser_snapshot', {
      compact: true,
      interactive: false,
      includeUrls: true,
      session: sessionId
    });
    let outlineText = '';
    try {
      const readRes = await mcpClient.callTool('agent_browser_read', { outline: true, session: sessionId });
      outlineText = readRes.text || '';
    } catch {}

    const currentTitle = (titleRes.text || '').trim() || state.grant.controlledTab.title;
    const currentUrl = (urlRes.text || '').trim() || state.grant.controlledTab.url;
    const snapshotText = (snapRes.text || '').trim();

    if (isControlUrl(currentUrl)) {
      await mcpClient.callTool('agent_browser_back', { session: sessionId }).catch(() => {});
      return {
        ok: false,
        status: 'CONTROL_PANEL_SELF_APPROVAL_BLOCKED',
        error: 'Navigation reached the protected Northbridge Control Console and was halted.'
      };
    }

    state.grant.controlledTab.title = currentTitle;
    state.grant.controlledTab.url = sanitizeUrl(currentUrl);

    // Check post-action Sign-In / CAPTCHA / Google Automation Block
    const gate = detectAuthCaptchaOrGoogleBlock({
      url: currentUrl,
      title: currentTitle,
      snapshotText
    });

    if (gate.detected) {
      state.grant.status = 'paused_for_user';
      state.grant.handbackType = gate.kind === 'SIGNIN' ? 'SIGNIN' : 'CAPTCHA';
      state.grant.handbackReason = gate.reason;
      await syncHud(state.grant);
      logAudit('HANDBACK', `${gate.kind}: ${gate.reason}`);

      let blockRecord = null;
      if (gate.isGoogleBlock) {
        blockRecord = {
          provider: gate.provider,
          query: queryHint || (action === 'search_input' ? text : currentUrl),
          url: sanitizeUrl(currentUrl),
          searchedAt: new Date().toISOString(),
          observedTotal: null,
          returnedCount: null,
          status: 'BLOCKED',
          reason: gate.reason
        };
        state.googleBlocks.push(blockRecord);
      }

      return {
        ok: false,
        status: gate.isGoogleBlock ? 'BLOCKED_GOOGLE_FALLBACK' : (gate.kind === 'SIGNIN' ? 'HANDED_BACK_SIGNIN' : 'HANDED_BACK_CAPTCHA'),
        handedBack: true,
        resumeRequired: true,
        title: currentTitle,
        url: sanitizeUrl(currentUrl),
        reason: gate.reason,
        blockRecord,
        fallbackRoutes: gate.fallbackRoutes,
        message: gate.isGoogleBlock
          ? `Google automation block detected (${gate.reason}). Logged BLOCKED status, handed control back to user in Chrome, and returned keyless scholarly fallback routes.`
          : `Control handed back to user for ${gate.kind.toLowerCase()} verification. Complete it in Chrome and click Resume Control.`
      };
    }

    await syncHud(state.grant);

    const tables = extractTablesFromSnapshot(snapshotText, { maxTableRows: 20 });
    const linksData = extractLinksFromSnapshot(snapshotText, currentUrl, {});
    const headings = parseOutlineHeadings(outlineText);
    const trimmedSnap = section
      ? snapshotText.split('\n').filter(l => l.toLowerCase().includes(String(section).toLowerCase())).join('\n').slice(0, maxChars)
      : snapshotText.slice(0, maxChars);

    return {
      ok: true,
      status: 'OK',
      action,
      grantStatus: state.grant.status,
      controlledTab: state.grant.controlledTab,
      title: currentTitle,
      url: sanitizeUrl(currentUrl),
      headings: headings.map(h => h.text),
      snapshot: trimmedSnap,
      snapshotChars: snapshotText.length,
      tables,
      links: linksData.links,
      untrustedContent: true
    };
  }

  async function close({ closeBrowser = false } = {}) {
    if (state.grant && state.grant.status !== 'revoked') {
      await revokeControlFromHost('Session closed');
    }
    if (mcpClient) {
      try { await mcpClient.callTool('agent_browser_close', { session: sessionId }); } catch {}
      try { await mcpClient.close(); } catch {}
      mcpClient = null;
    }
    if (controlServer) {
      await new Promise(r => controlServer.close(r));
      controlServer = null;
    }
    if (closeBrowser && chromeProc && chromeProc.pid && chromeProc.exitCode === null) {
      try {
        spawnSync('taskkill', ['/PID', String(chromeProc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
      } catch {}
      chromeProc = null;
    }
    state.started = false;
  }

  // Host-only methods intentionally separated from MCP schema so an AI caller cannot self-approve.
  const hostHandle = {
    getControlUrlWithToken: () => controlPort ? `http://127.0.0.1:${controlPort}/control?uiToken=${uiToken}` : null,
    getUiTokenForHost: () => uiToken,
    grantTab: grantTabControlFromHost,
    pause: pauseControlFromHost,
    resume: resumeControlFromHost,
    revoke: revokeControlFromHost
  };

  return {
    start,
    status,
    act,
    close,
    hostHandle,
    getControlPort: () => controlPort
  };
}
