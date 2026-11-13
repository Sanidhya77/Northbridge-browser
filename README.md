# Northbridge Browser

Northbridge is a local Model Context Protocol (MCP) server for web research on Windows. It lets an agent find public sources, read them as text, and follow links to Word attachments. Browser-assisted reads use accessibility snapshots, and the default research workflow uses zero screenshots.

This is a Windows pilot. The source and setup below are on [`pilot-live-scopus-validation`](https://github.com/Sanidhya77/Northbridge-browser/tree/pilot-live-scopus-validation).

## What it can do

| Task | MCP tool | What to expect |
| --- | --- | --- |
| Find sources | `northbridge_search_web` | Ranked links and short Brave Search snippets. Optional indexed excerpts are labelled as provider evidence. Requires a Brave Search API key. |
| Read a public URL | `northbridge_read_public_page` | Focused text from public HTTPS HTML and plain text. Set `attachment` to find matching links or `extract_docx: true` to read a Word document. |
| Inspect a rendered page or an approved tab | `northbridge_summarize_page` | Read-only page outline, focused sections, links, and tables. The tool can also report PDF text when it is accessible through this route. |
| Try browser actions locally | `northbridge-browser` server | Agent Browser tools for the loopback demo. The workspace config restricts the server to `127.0.0.1`. |
| Export a Scopus results range | `northbridge_export_scopus_results` | CSV export from a user-approved results tab in a dedicated Chrome profile. This is an optional pilot workflow. |

## Install

### From npm

Install the package into your project or workspace:

```powershell
npm.cmd install @sanidhya77/northbridge-browser
```

### From GitHub

Use PowerShell with Git, Node.js 24 or newer, npm, and a desktop MCP client that can launch a local stdio server.

```powershell
git clone --branch pilot-live-scopus-validation https://github.com/Sanidhya77/Northbridge-browser.git
Set-Location Northbridge-browser
npm.cmd ci
```

For browser-assisted tools, have Chrome available or use Agent Browser's installer from the checkout:

```powershell
.\node_modules\.bin\agent-browser.cmd install
```

The direct public-page reader and DOCX extraction do not launch Chrome. You can start with a known public URL and add search later.

## Connect a client

### VS Code with GitHub Copilot

VS Code defines MCP servers under `"servers"` in `.vscode/mcp.json`.

**Option A: Running from a GitHub clone**
1. Open the cloned **Northbridge-browser** folder in VS Code. It includes [`.vscode/mcp.json`](.vscode/mcp.json).
2. Start **northbridge-summarize** via the Command Palette (**MCP: Show Installed Servers**) or directly in `.vscode/mcp.json`:

```json
{
  "servers": {
    "northbridge-summarize": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/bin/northbridge-summarize-mcp.mjs"
      ],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": ""
      }
    }
  }
}
```
*(If adding Northbridge from another VS Code workspace, replace `${workspaceFolder}` with the absolute checkout path).*

**Option B: Running from an installed npm package**
If installed into a workspace (`node_modules/@sanidhya77/northbridge-browser`):

```json
{
  "servers": {
    "northbridge-summarize": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/node_modules/@sanidhya77/northbridge-browser/bin/northbridge-summarize-mcp.mjs"
      ],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": ""
      }
    }
  }
}
```

### Codex CLI

Run this from the checkout, then restart the active Codex session so it discovers the server.

```powershell
$entry = Join-Path (Get-Location).Path 'bin/northbridge-summarize-mcp.mjs'
codex mcp add northbridge-summarize -- node $entry
codex mcp list
```

### Google Antigravity or Cursor

Open the client's MCP configuration (`mcpServers` object). In Antigravity, use the raw MCP configuration editor. In Cursor, the workspace file is `.cursor/mcp.json`.

On Windows, invoking `"command": "node"` with the script path in `"args"` is the verified launch pattern that avoids `.cmd` batch wrapper spawning restrictions (`EINVAL`/`ENOENT`):

**Option A: Running from a GitHub clone**
```json
{
  "mcpServers": {
    "northbridge-summarize": {
      "command": "node",
      "args": [
        "C:/path/to/Northbridge-browser/bin/northbridge-summarize-mcp.mjs"
      ],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": ""
      }
    }
  }
}
```

**Option B: Running from an installed npm package**
```json
{
  "mcpServers": {
    "northbridge-summarize": {
      "command": "node",
      "args": [
        "C:/path/to/node_modules/@sanidhya77/northbridge-browser/bin/northbridge-summarize-mcp.mjs"
      ],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": ""
      }
    }
  }
}
```

### Optional Brave Search

Set `NORTHBRIDGE_BRAVE_SEARCH_API_KEY` in the server's local environment and restart the server. In VS Code, you can add an `env` entry with `"NORTHBRIDGE_BRAVE_SEARCH_API_KEY": "${input:northbridge-brave-key}"` and declare the following top-level `inputs` in the same MCP configuration:

```json
"inputs": [
  {
    "id": "northbridge-brave-key",
    "type": "promptString",
    "description": "Brave Search API key",
    "password": true
  }
]
```

Keep the actual key out of Git. Northbridge sends search queries to Brave when you use its search tool. Indexed excerpts use Brave's LLM Context API and depend on your API access. Known-URL reads work without a key.

## Try it

**Read an official attachment**

> Use Northbridge to open https://cse.sustech.edu.cn/en/graduate/3796.html and find Annex 2. Open the returned DOCX with Northbridge and give me its section headings, minimum length, and signature fields. Include the final source URL.

This workflow was verified in two MCP calls. The arguments are:

```json
{"url":"https://cse.sustech.edu.cn/en/graduate/3796.html","attachment":"Annex 2"}
```

Use the URL returned in `attachments` for the second call:

```json
{"url":"https://gs.sustech.edu.cn/static/upload/file/20261102/17935877682607.docx","extract_docx":true,"maxChars":3000}
```

**Search and verify a source**

> Use Northbridge to find the FlexInfer paper. Read the abstract from the original page and report the final URL and what you could verify.

A search result or indexed excerpt is useful for discovery. For a live check, read the original source with `northbridge_read_public_page`. Pass `section` to focus on a heading and `maxChars` to limit the returned excerpt.

## Access and troubleshooting

- **Direct public reads** use HTTPS on port 443 and check public IPv4 destinations, including redirects. They send no cookies or authentication headers. HTML and plain text are supported by default. DOCX reads require explicit opt-in and have download and decompression limits.
- **Rendered fallback** is opt-in with `rendered_fallback: true` when the direct read yields unsupported content or no text. Set approved domains in the server environment first. The fallback checks `AGENT_BROWSER_ALLOWED_DOMAINS`, then `NORTHBRIDGE_APPROVED_DOMAINS`, and defaults to loopback. A blocked HTTP response remains blocked.
- **Browser summaries** of public URLs require server-side `NORTHBRIDGE_APPROVED_DOMAINS`. Reading an already-open tab requires explicit user approval. Keep authenticated browser work in a dedicated Chrome profile.
- **Server missing or failed to start** means checking that the client can find Node on PATH, the absolute entry point exists, and `npm.cmd ci` succeeded. Launch `node` with the entry point in the MCP config. Use the client's MCP logs for startup errors.
- **`SEARCH_NOT_CONFIGURED`** means the search server did not receive the Brave key. Update its environment and restart it.
- **`blocked` or `policy_blocked`** means the website or the local browser policy prevented access. Read the tool status before relying on an excerpt.

## Optional browser and Scopus demos

For the mock admissions portal, run `npm.cmd start` and ask the `northbridge-browser` server to inspect `http://127.0.0.1:4317/`.

For the standalone Scopus fixture, run `node bin/northbridge-scopus.mjs --block D3`. For an approved live results tab, use the `northbridge-scopus` server with a dedicated profile. See [HANDOFF.md](HANDOFF.md) for workflow details and verification limits, [BENCHMARK.md](BENCHMARK.md) for the browser benchmark, and the [previous pilot guide](https://github.com/Sanidhya77/Northbridge-browser/blob/87ecdfbed4bfcb9598fe9158ac553fa5357995f6/README.md) for the detailed Chrome and Scopus walkthrough.

## Verify locally

Verification is performed via MCP stdio testing and unit test suites:

```powershell
npm.cmd test
npm.cmd run test:summary
npm.cmd run test:scopus
```

## Distribution status

Northbridge Browser is published as `@sanidhya77/northbridge-browser` on npm, requiring Node.js >= 24.0.0. Clients connect via standard stdio JSON-RPC using the verified configurations above. Verification is conducted via MCP stdio testing. See the official [VS Code MCP guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).
