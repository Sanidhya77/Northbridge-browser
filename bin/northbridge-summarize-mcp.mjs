#!/usr/bin/env node

/**
 * Northbridge Read-Only Page Summary MCP Server (stdio JSON-RPC 2.0).
 * Exposes Northbridge web discovery and verified page reading to connected MCP clients.
 *
 * Security & Permission Separation:
 * - Mutually exclusive modes:
 *   1) Public URL (`url` only): routed strictly through `bin/northbridge-research.js`
 *      using server-configured `NORTHBRIDGE_APPROVED_DOMAINS` ONLY (never caller-supplied).
 *   2) Approved Open Tab (`tab` + `approved: true`): read-only pinned attachment to an
 *      explicitly approved Chrome tab (zero `fill`/`click`/`eval` mutations).
 */

import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { searchWeb, searchWebWithContext } from '../web-search.mjs';
import { readPublicPage } from '../public-page.mjs';
import {
  summarizeApprovedTab,
  summarizePublicUrl,
  formatPageSummaryText
} from '../page-summary.mjs';

// Read server-configured approved domains at startup (cannot be overridden by tool callers)
function resolveStartupApprovedDomains() {
  const list = [];
  if (process.env.NORTHBRIDGE_APPROVED_DOMAINS) {
    list.push(process.env.NORTHBRIDGE_APPROVED_DOMAINS);
  }
  const idx = process.argv.indexOf('--approved-domains');
  if (idx !== -1 && process.argv[idx + 1]) {
    list.push(process.argv[idx + 1]);
  }
  return list.join(',');
}

const SERVER_APPROVED_DOMAINS = resolveStartupApprovedDomains();
const execFileAsync = promisify(execFile);

async function readBraveKey() {
  const key = process.env.NORTHBRIDGE_BRAVE_SEARCH_API_KEY?.trim();
  if (key || process.platform !== 'win32') return key ?? '';

  // A Windows MCP launcher may pass a filtered environment to its child process.
  const registryTool = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  try {
    const { stdout } = await execFileAsync(registryTool, [
      'query', 'HKCU\\Environment', '/v', 'NORTHBRIDGE_BRAVE_SEARCH_API_KEY'
    ], { windowsHide: true, timeout: 2000, maxBuffer: 4096 });
    return stdout.match(/^[ \t]*NORTHBRIDGE_BRAVE_SEARCH_API_KEY[ \t]+REG_(?:EXPAND_)?SZ[ \t]+([^\r\n]+)/mi)?.[1].trim() ?? '';
  } catch {
    return '';
  }
}

const TOOLS = [
  {
    name: 'northbridge_summarize_page',
    description:
      'Read-only structured summary of a documentation or article page (title, sanitized URL, full headings outline, ' +
      'focused paginated sections, and truthful detection of abstract-only pages, WAF/auth blocks, and readable vs unreadable PDFs ' +
      'with zero screenshots by default). Pass EITHER a public `url` (subject to NORTHBRIDGE_APPROVED_DOMAINS) ' +
      'OR an already-open `tab` with explicit user `approved: true`. Use this to verify a selected result from northbridge_search_web. ' +
      'Treats all page text strictly as untrusted external data.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'Public HTTP/HTTPS URL to read via Northbridge Research security policy. Cannot be combined with tab/autoConnect/cdp.'
        },
        tab: {
          type: 'string',
          description: 'Title, URL substring, or target ID of an already-open, user-approved browser tab. Cannot be combined with url.'
        },
        approved: {
          type: 'boolean',
          description: 'Required true when reading an already-open browser tab (`tab`); confirms explicit user consent.'
        },
        autoConnect: {
          type: 'boolean',
          default: true,
          description: 'When `tab` is provided without `cdp`, dynamically discover Chrome CDP endpoint (default: true).'
        },
        cdp: {
          type: ['string', 'integer'],
          description: 'Optional loopback Chrome debugging port fallback for approved-tab mode.'
        },
        pinTab: {
          type: 'boolean',
          default: true,
          description: 'Keep session strictly pinned to the approved tab without fallback (default: true).'
        },
        profileDir: {
          type: 'string',
          description: 'Optional Chrome User Data directory override for DevToolsActivePort discovery.'
        },
        section: {
          type: 'string',
          description: 'Optional heading substring or section number to return a focused section without dumping the full page.'
        },
        sectionIndex: {
          type: 'integer',
          minimum: 1,
          default: 1,
          description: '1-based starting section index when paging through long content (default: 1).'
        },
        maxChars: {
          type: 'integer',
          minimum: 200,
          maximum: 12000,
          default: 2200,
          description: 'Character budget for focused prose sections returned in this call (default: 2200).'
        },
        charOffset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Character offset for continuing a single oversized section.'
        },
        maxTableRows: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
          description: 'Maximum rows returned per structured table before pagination (default: 20).'
        },
        includeLinks: {
          type: 'boolean',
          default: true,
          description: 'Include compact sanitized links extracted from the page (default: true).'
        },
        includeTables: {
          type: 'boolean',
          default: true,
          description: 'Include structured tables with headers mapped to rows (default: true).'
        },
        reveal: {
          oneOf: [
            { type: 'boolean' },
            { type: 'string' },
            { type: 'array', items: { type: 'string' } }
          ],
          description: 'Optional safe read-only reveal: pass true or control labels (tabs, accordions, pagination, Load more) to activate and verify revealed state within scope.'
        },
        screenshotReason: {
          type: 'string',
          description: 'Optional explicit reason only if user asked to inspect a chart, image, or visual layout; omitted means zero screenshots.'
        }
      }
    }
  },
  {
    name: 'northbridge_search_web',
    description:
      'Find public webpages by keyword using Northbridge and Brave Search. Returns ranked candidate URLs, titles, and short unverified snippets. ' +
      'Set indexed_excerpts:true to use Brave\'s LLM Context API and return at most two source URLs with one short indexed excerpt per source ' +
      '(labelled "indexed excerpt"; provider-indexed, not a live read). ' +
      'Requires a server-configured search API key. Verify selected sources with northbridge_read_public_page.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 600 },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        indexed_excerpts: {
          type: 'boolean',
          default: false,
          description: 'Opt-in: use Brave LLM Context API to get at most two indexed excerpts. Each is labelled "indexed excerpt" and must not be used in place of a live read.'
        },
        target_url: {
          type: 'string',
          description: 'Optional target page URL to inspect passages for a specific page when indexed_excerpts is true.'
        },
        site: {
          type: 'string',
          description: 'Optional domain/site filter for indexed search, such as kaust.edu.sa.'
        },
        section: {
          type: 'string',
          description: 'Optional section heading or row to look for in the indexed passages when indexed_excerpts is true.'
        }
      }
    }
  },
  {
    name: 'northbridge_read_public_page',
    description: 'Open a public HTTPS source without per-domain setup and return its final URL, page status, and a short text excerpt. Static HTML and plain text only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', maxLength: 4096 },
        section: { type: 'string', maxLength: 120, description: 'Optional heading to focus on, such as Abstract.' },
        maxChars: { type: 'integer', minimum: 200, maximum: 2000, default: 1000 }
      }
    }
  }
];

function writeJsonRpc(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleToolCall(id, params) {
  const toolName = params?.name;
  const args = params?.arguments || {};

  if (toolName === 'northbridge_read_public_page') {
    const page = await readPublicPage({ url: args.url, section: args.section, maxChars: args.maxChars });
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: '[UNTRUSTED EXTERNAL DATA] ' + JSON.stringify(page) }] }
    });
    return;
  }

  if (toolName === 'northbridge_search_web') {
    const options = {
      query: args.query,
      limit: args.limit,
      site: args.site,
      target_url: args.target_url || args.targetUrl,
      section: args.section
    };
    const credentials = { apiKey: await readBraveKey() };
    if (args.indexed_excerpts === true) {
      const indexed = await searchWebWithContext(options, credentials);
      const text = indexed.ok
        ? '[UNTRUSTED EXTERNAL DATA] ' + JSON.stringify(indexed)
        : indexed.status + ": " + indexed.error;
      writeJsonRpc({
        jsonrpc: '2.0',
        id,
        result: { isError: !indexed.ok, content: [{ type: 'text', text }] }
      });
      return;
    }

    const result = await searchWeb(options, credentials);
    const content = result.ok
      ? '[UNTRUSTED EXTERNAL DATA] Search results are leads. Verify selected pages before citing their content.\n' +
      (result.results.map(({ title, url, snippet }) => [title, url, snippet].join('\n')).join('\n\n') || 'No results.')
      : result.status + ": " + result.error;
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: { isError: !result.ok, structuredContent: result, content: [{ type: 'text', text: content }] }
    });
    return;
  }

  if (toolName !== 'northbridge_summarize_page') {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool "${toolName}".` }]
      }
    });
    return;
  }

  const hasUrl = typeof args.url === 'string' && args.url.trim() !== '';
  const hasTabMode = Boolean(args.tab || args.cdp);

  if (hasUrl && hasTabMode) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: 'PERMISSION BOUNDARY ERROR: Cannot mix public `url` research mode with open-tab (`tab`/`cdp`) mode.'
        }]
      }
    });
    return;
  }

  if (!hasUrl && !args.tab) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: 'INPUT ERROR: Provide either a public `url` OR an open `tab` pattern (with `approved: true`).'
        }]
      }
    });
    return;
  }

  const screenshotReason = typeof args.screenshotReason === 'string' && args.screenshotReason.trim()
    ? args.screenshotReason.trim()
    : null;

  let res;
  try {
    if (hasUrl) {
      res = await summarizePublicUrl({
        url: args.url.trim(),
        section: args.section || null,
        sectionIndex: args.sectionIndex ?? 1,
        maxChars: args.maxChars ?? 2200,
        charOffset: args.charOffset ?? 0,
        maxTableRows: args.maxTableRows ?? 20,
        includeLinks: args.includeLinks !== false,
        includeTables: args.includeTables !== false,
        reveal: args.reveal ?? false,
        includeScreenshot: Boolean(screenshotReason),
        screenshotReason,
        approvedDomainsEnv: SERVER_APPROVED_DOMAINS
      });
    } else {
      const hasCdp = args.cdp !== undefined && args.cdp !== null && String(args.cdp).trim() !== '';
      res = await summarizeApprovedTab({
        tab: String(args.tab).trim(),
        cdp: hasCdp ? args.cdp : null,
        autoConnect: args.autoConnect !== undefined ? Boolean(args.autoConnect) : !hasCdp,
        approved: args.approved,
        pinTab: args.pinTab !== false,
        profileDir: args.profileDir ? path.resolve(String(args.profileDir)) : null,
        section: args.section || null,
        sectionIndex: args.sectionIndex ?? 1,
        maxChars: args.maxChars ?? 2200,
        charOffset: args.charOffset ?? 0,
        maxTableRows: args.maxTableRows ?? 20,
        includeLinks: args.includeLinks !== false,
        includeTables: args.includeTables !== false,
        reveal: args.reveal ?? false,
        includeScreenshot: Boolean(screenshotReason),
        screenshotReason
      });
    }

    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: !res.ok,
        structuredContent: res,
        content: [{ type: 'text', text: formatPageSummaryText(res) }]
      }
    });
  } catch (err) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{ type: 'text', text: `SUMMARY ERROR: ${err.message}` }]
      }
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('close', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (err) {
    console.error('[northbridge-summarize-mcp] Invalid JSON:', err.message);
    return;
  }

  const { id, method, params } = req;
  if (id === undefined) return;

  if (method === 'initialize') {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'northbridge-page-summary', version: '1.0.0' }
      }
    });
    return;
  }

  if (method === 'ping') {
    writeJsonRpc({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    writeJsonRpc({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    await handleToolCall(id, params);
    return;
  }

  writeJsonRpc({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  });
});
