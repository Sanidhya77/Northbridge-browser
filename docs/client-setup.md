# Client Setup Guide

Northbridge Browser runs local MCP servers over stdio JSON-RPC on Windows (`Node.js >= 24.0.0`). On Windows, configure clients with `"command": "node"` and the script path in `"args"` to avoid `.cmd` batch-spawning errors (`EINVAL`/`ENOENT`).

## Available MCP Servers & Distribution Status

| Server | Entry point | In npm `@sanidhya77/northbridge-browser@1.0.0`? | In GitHub `feat/chrome-control`? |
| --- | --- | --- | --- |
| `northbridge-summarize` | `bin/northbridge-summarize-mcp.mjs` | Yes | Yes (plus Windows MCP startup/cleanup fixes) |
| `northbridge-control` | `bin/northbridge-control-mcp.mjs` | No (next release) | **Yes — use GitHub source today** |
| `northbridge-scopus` *(optional pilot)* | `bin/northbridge-scopus-mcp.mjs` | No | Yes |
| `northbridge-browser` *(mock demo)* | `bin/northbridge-browser.js` | No | Yes |

For Chrome installation when using browser-assisted tools from a clone:

```powershell
.\node_modules\.bin\agent-browser.cmd install
```

Direct HTTPS page reads (`northbridge_read_public_page` without `rendered_fallback`) and DOCX extraction do not launch Chrome.

---

## VS Code with GitHub Copilot

Add servers under `"servers"` in `.vscode/mcp.json`:

**Option A: GitHub clone (includes `northbridge-control` today)**

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
    },
    "northbridge-control": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/bin/northbridge-control-mcp.mjs"
      ]
    }
  }
}
```

If referencing Northbridge from a different VS Code workspace, replace `${workspaceFolder}` with the absolute path to your `Northbridge-browser` checkout.

**Option B: Published npm package (`1.0.0`, read-only tools only)**

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

Start and manage configured servers in VS Code via Command Palette -> **MCP: Show Installed Servers** or see the [VS Code MCP guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

---

## Codex CLI

Run from your checkout directory (or npm project directory for `northbridge-summarize`), then restart the active Codex session so it reloads tools:

```powershell
$sum = Join-Path (Get-Location).Path 'bin/northbridge-summarize-mcp.mjs'
$ctrl = Join-Path (Get-Location).Path 'bin/northbridge-control-mcp.mjs'
codex mcp add northbridge-summarize -- node $sum
codex mcp add northbridge-control -- node $ctrl
codex mcp list
```

For npm `1.0.0` read-only tools only:

```powershell
$pkg = Join-Path (Get-Location).Path 'node_modules/@sanidhya77/northbridge-browser/bin/northbridge-summarize-mcp.mjs'
codex mcp add northbridge-summarize -- node $pkg
```

---

## Google Antigravity or Cursor

Open the client's MCP configuration (`mcpServers` object; `.cursor/mcp.json` in Cursor or the raw MCP configuration editor in Antigravity). Use forward slashes or escaped backslashes:

**Option A: GitHub clone (includes `northbridge-control` today)**

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
    },
    "northbridge-control": {
      "command": "node",
      "args": [
        "C:/path/to/Northbridge-browser/bin/northbridge-control-mcp.mjs"
      ]
    }
  }
}
```

**Option B: Published npm package (`1.0.0`, read-only tools only)**

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

---

## Optional Brave Search API Key

`northbridge_read_public_page` and `northbridge-control` work without any API keys.

To enable `northbridge_search_web`, set `NORTHBRIDGE_BRAVE_SEARCH_API_KEY` in the `northbridge-summarize` server environment and restart the server. In VS Code, prompt safely without committing keys:

```json
{
  "inputs": [
    {
      "id": "northbridge-brave-key",
      "type": "promptString",
      "description": "Brave Search API key",
      "password": true
    }
  ]
}
```

Then set `"NORTHBRIDGE_BRAVE_SEARCH_API_KEY": "${input:northbridge-brave-key}"` inside `"env"`. Never commit real keys to Git. Search queries are sent to Brave when calling `northbridge_search_web`; `indexed_excerpts: true` uses Brave's LLM Context API depending on your plan.

See also: [README](../README.md) · [Workflows & Troubleshooting](workflows-and-troubleshooting.md) · [MV3 vs. CDP Trade-Offs](chrome-extension-vs-cdp-tradeoffs.md)
