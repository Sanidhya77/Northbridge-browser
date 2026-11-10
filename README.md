# Northbridge University Browser Demo · Windows Browser Tools for Coding Agents

A fictional university admissions portal and local browser automation setup designed for AI coding agents on Windows. This project demonstrates how coding agents can interact with modern web applications through structured accessibility trees and stable element references (`@ref`), using both the Model Context Protocol (MCP) over `stdio` and a direct PowerShell CLI fallback.

The portal serves exclusively on loopback (`http://127.0.0.1:4317/`), stores a single synthetic draft in isolated browser storage, and halts at the **Review saved draft** page—the human review checkpoint before any real-world submission.

> [!NOTE]
> **Evaluation Scope & Local Preview**: The admissions demo is documented as a **local preview** of single-session browser interaction through structured accessibility trees and stable element references, not an end-to-end multi-agent evaluation. Desktop browser traces are retained as evidence of a working local connection. Lower token cost compared to visual coordinate clicking is treated strictly as a **hypothesis pending a matched `@Chrome` benchmark run** with an LLM in the loop.

---

## Windows Quick Start for Tomorrow

Use this path on Windows to install dependencies, connect your client, and ask plain-language **“Use Northbridge ...”** questions using the 6-step read, navigate, and verify workflow (**Discover -> Orient -> Read -> Reveal -> Verify -> Compact Output**).

### 1. One-Time Local Setup (PowerShell in `university-browser-demo`)

```powershell
npm.cmd ci
.\node_modules\.bin\agent-browser.cmd install
```

*(If Google Chrome is already installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`, approved-tab modes connect to a dedicated debugging profile launched from that binary as well.)*

### 2. Copy-Ready Plain-Language Prompts in Chat

- **Professor / Topic Research Prompt** *(Discovery + Public Page Verification)*:
  > "Use Northbridge to research Prof. [Full Name]'s main research areas and summarize one open-access paper with exact source URLs and any blocks or limits."

  - **How it runs**: The chat client uses its own search tool (**Discover**) to find candidate URLs, then calls `northbridge_summarize_page` (**Orient -> Read -> Reveal -> Verify -> Compact Output**) on public URLs whose hosts are pre-authorized in `NORTHBRIDGE_APPROVED_DOMAINS` (for example `cs.ox.ac.uk,arxiv.org`).
  - **Default `.vscode/mcp.json` boundary**: `NORTHBRIDGE_APPROVED_DOMAINS` ships as `""` by default so public URLs halt with `[APPROVAL REQUIRED]` unless explicitly allowlisted by you in MCP configuration (or opened in an approved Chrome tab).

- **Current-Page / Open-Tab Summary Prompt** *(Approved Read-Only Chrome Tab)*:
  > "Use Northbridge to summarize this page"
  > "Use Northbridge to summarize the Abstract and Discussion sections of this page, including tables"

  - **CLI Equivalent**:
    ```powershell
    # Approved open tab (zero screenshots by default; add --reveal to expand tabs/accordions/pagination):
    node bin/northbridge-summarize.mjs --auto-connect --approved --tab "Docs" --max-chars 2200
    ```

- **Scopus Results CSV Export Prompt** *(Approved Dedicated-Profile Results Tab, Records 1–20)*:
  > "Use Northbridge to export the first 20 Scopus results"

  - **CLI Equivalent** *(requires a dedicated Chrome profile directory such as `ScopusProfile`)*:
    ```powershell
    node bin/northbridge-scopus.mjs export --auto-connect --approved --profile-dir "$env:LOCALAPPDATA\Google\Chrome\ScopusProfile" --tab "Scopus" --from 1 --to 20
    ```

### 3. Honest Verification Separation (As of November 10, 2026)

| Verification Bucket | What Passed / Happened | Scope & Evidence |
|---|---|---|
| **Worked in Real Chat** | Loopback admissions demo (`MSc Applied Data Science` deadline `21 May 2027` & draft flow in Antigravity / VS Code / Codex); Fresh Antigravity plain-language subagent (`e32f48a4`) | Subagent `e32f48a4` ran `search_web` Discovery for Prof. Shimon Whiteson + QMIX (`arXiv:2003.08839` / JMLR `20-081`), refused to self-approve or edit config, and verified `[APPROVAL REQUIRED]` / loopback enforcement under unmodified config. |
| **Passed in Local Scripted / Fixture Tests** | `test:scopus` (**28/28**), `test:summary` (**11/11**), `test:research` (**9/9**), `test:lookup`, `test:mcp`, `test:cli`; plus live unauthenticated public reads | Verified 4-widget interactive reveal (`5,869 ms`, `11,797` obs bytes, `0` screenshots), Shadow DOM/iframe fallback, `tables`/`links`, dedicated-profile CDP download isolation, and live public reads across Oxford CS, `agent-browser.dev`, `w3.org`, `arxiv.org` HTML/abs/PDF, `plos.org`, `pmc`, `pubmed`, `nature.com`, and `mdpi.com`. |
| **Needs Approved Live Browser Test** | Authenticated **IEEE Xplore** full-text summary & live **Scopus RTU ORTUS/EZproxy** `1–20` CSV export | Requires an active institutional login + MFA in a dedicated Chrome profile; unauthenticated runs stopped cleanly without bypassing login or WAF gates. |

---

## Research from Chat

You can ask your AI coding agent plain-language research questions directly in chat without supplying starting URLs, CSS selectors, element refs, or browser commands:

> "Use Northbridge Browser to research AI master’s programmes for Fall 2027. Focus on one university with official admissions information. Find the application deadline, entry requirements, English-language requirements, and funding options for international students. Cite the pages you used and flag anything you couldn’t verify."

The agent discovers candidate sources using its search capability, opens official pages through Northbridge Browser, reads their accessibility trees via text snapshots, and returns verified findings with source links.

### How the Workflow Operates

1. **Source Discovery**: The desktop agent uses its built-in search tool (or user guidance) to locate official university admissions portals.
2. **Page Reading & Verification**: The agent calls Northbridge Browser (`agent_browser_open`, `agent_browser_snapshot`, `agent_browser_read`) to inspect structured accessibility trees with element references (`@ref`).
3. **Safety & Read-Only Confinement**: Public research mode exposes a safe, read-only profile. Form inputs, submissions, cookies, and script evaluation are disabled.
4. **Answer with Citations**: The agent verifies each finding against the observed page text, cites the exact URLs read, and explicitly flags any unverified or missing details.

### Security & Isolation Architecture

Northbridge Browser enforces multiple defense layers during public research:

1. **Cryptographic Session Isolation**: Each research server instance generates an unguessable cryptographic session namespace (`nbr_${instanceSecret}_${callerSession}`) and tracks authorized sessions in-process. Any tool call (`snapshot`, `read`, `click`, `scroll`, `close`, `tab_*`) targeting a session not created by that instance is rejected immediately with `[SESSION ISOLATION VIOLATION]`, preventing cross-session data leaks or unauthorized teardown.
2. **Pre-Navigation & Pre-Request Filtering**: Direct navigations and `agent_browser_read` calls validate target schemes, hostnames, and IP literals before any browser request is initiated. Target domain allowlists are passed to the engine's `allowedDomains` filter (CDP `Fetch.enable`), blocking unapproved redirects and subresources to private/loopback addresses with zero requests emitted.
3. **Authentic User-Configured Domain Approval**: Domains must be explicitly authorized by the human user via `NORTHBRIDGE_APPROVED_DOMAINS` in environment settings or `--approved-domains` CLI arguments. Synthetic in-chat self-approval tools (`northbridge_approve_domain`) were removed because standard desktop coding agent hosts execute tool calls autonomously without verifying human consent out-of-band. User approval **never** overrides the private network or loopback boundary.
4. **Truthful Anti-Bot & WAF Reporting**: When external sites deploy Web Application Firewalls or anti-bot verification (such as MBZUAI's WAF returning `title: "WAF | MBZUAI"` and `heading: "You can’t access this page right now"`), Northbridge Browser respects website protections, does not attempt bypasses or CAPTCHA-solving, and reports the block message directly to the user.

> [!WARNING]
> ### Release Status: Public Research is BLOCKED; Loopback Demo is READY
> - **Loopback Admissions Demo (`northbridge-browser`)**: **Ready for independent review**. All automated checks (`npm.cmd run test:lookup`, `npm.cmd run test:mcp`, `npm.cmd run test:cli`) pass cleanly with 0 failures and 0 retries.
> - **Public Web Research (`northbridge-browser-research`)**: **Blocked**. While pre-request allowlisting stops unapproved destinations, the pinned engine (`agent-browser: 0.41.2`) performs hostname string matching in CDP `Fetch.requestPaused` without connection-time IP verification. If an approved hostname points to a private IP at connection time (e.g. via DNS rebinding or internal redirect), the engine allows the socket connection. Wrapping through an internal forward proxy resolves connection-time IPs but causes TLS/SNI handshake aborts (`read ECONNRESET`, `10060`) on modern production CDNs (such as Cloudflare and Pantheon). Public research is withheld pending connection-time IP verification support in the upstream engine.

### Domain Authorization Workflow and Limitations

In compatible desktop agents (VS Code Copilot, Google Antigravity, Cursor, OpenAI Codex), users can configure preapproved research domains in their workspace MCP configuration (such as `.vscode/mcp.json`):

```json
{
  "servers": {
    "northbridge-browser-research": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/bin/northbridge-research.js"
      ],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": "study.ed.ac.uk,*.ed.ac.uk"
      }
    }
  }
}
```

- **Daily Use within Preset**: Once configured, everyday research proceeds naturally from chat without URLs or browser commands.
- **Discovering New Sites Outside Preset**: Because desktop coding agent hosts do not support interactive confirmation prompts during tool calls, discovering a new institution outside the preapproved list requires the user to add the domain to `NORTHBRIDGE_APPROVED_DOMAINS` in their MCP configuration. Navigating to an unapproved site halts with `[APPROVAL REQUIRED]`. Broad wildcards (`*`) and agent self-approval tools are deliberately disallowed to preserve human authorization integrity.

### Permission & Security Boundary Separation

Northbridge Browser provides separate MCP servers so loopback testing, public URL research, read-only page summarization, and approved Scopus CSV export remain strictly compartmentalized:

| Server Name | Entry Point | Policy & Scope | Primary Use Case | Default Status |
|---|---|---|---|---|
| `northbridge-browser` | `bin/northbridge-browser.js` | Loopback only (`127.0.0.1:4317`) | Local mock admissions portal tests | **Active in default setup** |
| `northbridge-scopus` | `bin/northbridge-scopus-mcp.mjs` | Export-only (`northbridge_export_scopus_results`); requires `approved: true` + unique `--tab` + `--pin-tab` + dedicated Chrome profile (`--profile-dir` / `ScopusProfile`, refusing shared default Chrome User Data); `targetId`-scoped CDP download attribution into `.gitignore`d `pilot-exports/`; zero credential/MFA/CAPTCHA bypasses | Plain-language Scopus results CSV export (`1–20`) | **Active in default setup** |
| `northbridge-summarize` | `bin/northbridge-summarize-mcp.mjs` | Read-only 6-step summary (`northbridge_summarize_page`); zero screenshots unless explicitly requested with `screenshotReason`; `--reveal` verification; structured `tables` & redacted `links`; `url` mode routes through `northbridge-research` with `NORTHBRIDGE_APPROVED_DOMAINS` (default `""`) while `tab` mode requires `approved: true` + `--pin-tab` (cannot mix `url` and `tab`/`cdp`) | Plain-language page/article/PDF summary | **Active in default setup** (`NORTHBRIDGE_APPROVED_DOMAINS=""`) |
| `northbridge-browser-research` | `bin/northbridge-research.js` | Safe public research (read-only; pre-request network filter; session-isolated; blocks loopback, private networks, and `file:`) | Raw multi-step public web browsing | **Kept out of default setup** (blocked on connection-time IP gap) |

> [!IMPORTANT]
> **Default Setup Policy**: The raw public research server (`northbridge-browser-research`) is kept **out of the default setup** (`.vscode/mcp.json`) while the upstream connection-time private-network IP gap remains open. `.vscode/mcp.json` enables `northbridge-browser` (loopback `127.0.0.1`), `northbridge-scopus` (`northbridge_export_scopus_results`), and `northbridge-summarize` (`northbridge_summarize_page` with `NORTHBRIDGE_APPROVED_DOMAINS=""` by default so public URLs require explicit domain configuration and approved Chrome tabs require `approved: true`). If opting in to raw research tools locally, add `northbridge-browser-research` manually:

```json
{
  "servers": {
    "northbridge-browser-research": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/bin/northbridge-research.js"
      ],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": "study.ed.ac.uk,*.ed.ac.uk"
      }
    }
  }
}
```

---

## Plain-Language Chat Experience (MCP Clients)

Connected MCP clients (VS Code, Google Antigravity, Cursor, Codex, Claude Desktop) expose high-level tools in `.vscode/mcp.json` so users can speak in plain English without naming browser engines, CSS selectors, or `@ref` tokens:

- **Summarize a page or section**:
  > "Use Northbridge to summarize this page"
  > "Use Northbridge to summarize the Discussion section of this page"
- **Export the first 20 Scopus results**:
  > "Use Northbridge to export the first 20 Scopus results"

### Quick CLI Equivalents

```powershell
# Read-only page summary (approved already-open Chrome tab, paginated to first focused sections):
node bin/northbridge-summarize.mjs --auto-connect --approved --tab "IEEE" --max-chars 2200

# Read-only page summary with safe reveal of hidden tabs/accordions/pagination:
node bin/northbridge-summarize.mjs --auto-connect --approved --tab "PLOS ONE" --reveal --max-chars 2200

# Read specific section or paginate long prose by char offset without pulling the full page:
node bin/northbridge-summarize.mjs --auto-connect --approved --tab "PLOS ONE" --section "Discussion" --offset 2000

# Read public documentation URL via northbridge-research security boundary (domain allowlist required):
$env:NORTHBRIDGE_APPROVED_DOMAINS = "agent-browser.dev"
node bin/northbridge-summarize.mjs --url "https://agent-browser.dev/commands" --section "Read agent-friendly text"

# Repeatable Scopus results-tab -> CSV export (requires dedicated Chrome profile; writes to gitignored pilot-exports/):
node bin/northbridge-scopus.mjs export --auto-connect --approved --profile-dir "$env:LOCALAPPDATA\Google\Chrome\ScopusProfile" --tab "Scopus" --from 1 --to 20
```

---

## Read-Only Page Summary Pilot (`northbridge-summarize`)

The read-only summary engine ([`page-summary.mjs`](page-summary.mjs), [`bin/northbridge-summarize.mjs`](bin/northbridge-summarize.mjs), [`bin/northbridge-summarize-mcp.mjs`](bin/northbridge-summarize-mcp.mjs)) implements the 6-step **Discover -> Orient -> Read -> Reveal -> Verify -> Compact Output** workflow with zero screenshots unless `--screenshot-reason` / `screenshotReason` is explicitly supplied for a chart, image, or layout. All extracted content is framed strictly inside `[UNTRUSTED EXTERNAL DATA - BEGIN]` / `[UNTRUSTED EXTERNAL DATA - END]` with credential/token query redaction (`sanitizeUrl`).

### 6-Step Read, Navigate & Verify Loop

1. **Discover** *(outside the browser verifier)*: Use the client's search tool when the user gives a topic without a URL, or ask for a starting page; keep search discovery distinct from live page verification.
2. **Orient**: Read page title, redacted URL, full headings outline, compact accessibility snapshot, interactive controls (`tabs`, `accordions`, `pagination`, `load-more`), and `inaccessibleSections` (canvas/`application` widgets or `<iframe>` controls where `agent_browser_frame` is CLI-only).
3. **Read**: Extract focused paginated prose (`--section`, `--section-index`, `--max-chars`, `--offset`), structured `tables` bounded by `--max-table-rows` (default `20`), redacted `links`, and automatic Shadow DOM / accessible iframe fallback whenever `agent_browser_read` omits visible DOM text.
4. **Reveal** *(`--reveal` / `reveal`)*: Safely activates non-utility tabs, `<details>`/`[aria-expanded=false]` accordions (skipping utility toggles such as `Skip To Content` or `Open ... menu`), `Next` pagination, or `Load more` (scrolling off-viewport targets once if needed) within bounded settle polling.
5. **Verify**: Confirms hidden panel/lazy content was absent before activation and verified changed afterward (`verifiedChanged`), never attempts form inputs/eval mutations, and separates observation payload bytes (`obsBytes`) from runtime token counts (`modelTokens: null` when unexposed).
6. **Compact Output**: Returns bounded sections with explicit status, pagination hints (`nextSectionHint`, `omittedChars`, `omittedRows`), and metrics.

### Eight Explicit Content Classifications (`contentStatus`)

| `contentStatus` | `fullTextAvailable` | Observed Meaning & Behavior |
|---|---|---|
| `normal` | `true` | Complete unfiltered article or documentation body verified (`fullTextAvailable: true`). |
| `partial-body` | `false` | Filtered `--section` / `--section-index` single-section extraction, truncated preview, or partial excerpt (never marks `fullTextAvailable: true`). |
| `abstract-only` | `false` | Paywalled preview (`This is a preview of subscription content`, `Access via your institution`) or open abstract-landing record (`arxiv.org/abs/...`, `pubmed.ncbi.nlm.nih.gov/...`). |
| `metadata-only` | `false` | Bibliographic/catalog stub without abstract or article body prose (`narrativeWords < 90` / `< 35` depending on stub vs. scholarly cues; technical docs mentioning `"metadata only"` do not misclassify). |
| `outline-only` | `false` | Headings outline extracted with zero readable prose or table content behind the headings (`fullTextAvailable: false`). |
| `blocked` | `false` | WAF/anti-bot block (`Access Denied`, Cloudflare/Akamai), authentication gate without abstract, or empty script-blocked shell (`0` body words). Reported truthfully with zero bypasses. |
| `pdf-readable` | `!filteredSectionOnly` | Text-layer PDF readable through standard browser reading primitives. |
| `pdf-unreadable` | `false` | Browser displays Chrome's PDF viewer/stream (`Toggle sidebar`, `Page number`, `Zoom out`) with no extractable text layer; reported accurately with **zero** third-party PDF parser dependencies added. |

### Observed Live Public Validation & Known Limitations

Following owner direction to skip authenticated institutional IEEE Xplore/Scopus runs (public Wi-Fi without institutional login) and test freely visible public pages, the live summary module (`page-summary.mjs`) was exercised across public university, documentation, scholarly, and WAF-protected pages (0 screenshots across all runs; `modelTokens: null`):

| Category | Verified Live Target(s) | Observed Result (with Metrics) |
|---|---|---|
| **University Professor Profiles** | `https://www.cs.ox.ac.uk/people/shimon.whiteson/` (discovered via `search_web`) *(note: `https://nlp.stanford.edu/~manning/` timed out at `25,295 ms` `ERR_CONNECTION_TIMED_OUT`)* | **Unfiltered**: `normal` (`fullTextAvailable: true`, `8` headings, `62` links, `7,740 ms` wall / `7,567 ms` action, `6` calls, `0` retries, `obsBytes: 17,958`). **`--section "Selected Publications"`**: `partial-body` (`fullTextAvailable: false`, `usedFilteredRead: true`, `8,553 ms` wall, `obsBytes: 16,061`). |
| **Open-Access Public Docs** | `https://agent-browser.dev/commands`, `https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/` | `NORTHBRIDGE_APPROVED_DOMAINS=""` halts `[APPROVAL REQUIRED]`. On `agent-browser.dev/commands` (`--section "snapshot"` -> `partial-body`, `5,857 ms`, `obsBytes: 174,658`; unfiltered -> `normal`, `66` headings, `1` table, `168` links, `5,798 ms`, `obsBytes: 135,111`). On `w3.org/.../disclosure/` with `--reveal`: `normal`, `4,956 ms` wall / `4,800 ms` action, `10` calls, `0` retries, `obsBytes: 17,975` *(note: live page utility toggles like `Skip To Content` were safely skipped; full 4-widget reveal proof ran in `test:summary` Test 9)*. |
| **Open-Access Full Articles** | `https://arxiv.org/html/2311.10090v1` (*JaxMARL*), `https://arxiv.org/html/2510.10666` (*BrowserAgent*), `https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0317084`, `https://pmc.ncbi.nlm.nih.gov/articles/PMC11405275/` | **JaxMARL HTML**: `--section "Abstract"` -> `partial-body` (`6,785 ms`, `9` tables parsed, `obsBytes: 162,860`); unfiltered -> `normal` (`usedFallback: true` `snapshot-tree`, `53` headings, `7,252 ms`, `obsBytes: 195,706`). Prior runs on *BrowserAgent*, PLOS ONE, and PMC also verified `normal` and study limitations. |
| **Abstract-Only Landing & Paywalls** | `https://arxiv.org/abs/2311.10090`, `https://arxiv.org/abs/2510.10666`, `https://www.nature.com/articles/s42254-023-00581-4`, `https://pubmed.ncbi.nlm.nih.gov/38961264/` | **JaxMARL abs**: `abstract-only` (`fullTextAvailable: false`, `5,404 ms` wall / `5,262 ms` action, `7` calls, `0` retries, `obsBytes: 24,096`). Nature preview paywall (`idp.nature.com` redirect gate respected) and PubMed `##\nAbstract` also classified `abstract-only`. |
| **WAF / Unauthenticated Shell Blocks** | `https://www.mdpi.com/2076-3417/14/5/2074`, `https://ieeexplore.ieee.org/document/11364183/` | **MDPI**: `blocked` (`Access Denied` Akamai WAF, `3,897 ms`, `6` calls, `0` retries, `obsBytes: 661`). **IEEE unauthenticated doc**: `blocked` (empty SPA shell, `97` obs bytes, `4,001 ms`). *(Approved open IEEE portal homepage tab `https://ieeexplore.ieee.org/Xplore/home.jsp` also verified read-only in `3,649 ms`.)* |
| **Live PDFs** | `https://arxiv.org/pdf/2311.10090`, `https://arxiv.org/pdf/2510.10666`, `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf` | **Approved-tab Chrome mode**: `2311.10090` PDF verified `isPdf: true`, `pdfTextReadable: false`, `contentStatus: "pdf-unreadable"`, `fullTextAvailable: false` (`3,942 ms` wall / `3,902 ms` action, `9` calls, `0` retries, `obsBytes: 259`). **Public-research URL mode** (`--url`) on `.pdf` links hits Chrome's internal `chrome-extension://` PDFium viewer frame under CDP `Fetch.enable` and exits `FETCH_ERROR` cleanly at `25 s` timeout, advising approved-tab mode or companion HTML/abstract. |

Run the 11-test read-only summary, interactive reveal & MCP UX regression suite (`npm.cmd run test:summary`):

```powershell
npm.cmd run test:summary
```

---

## Scopus Paper Search & CSV Export Workflow

Northbridge Browser includes a specialized workflow for systematic literature searches and reproducible CSV exports from **Scopus**. From desktop agent chat, users provide a thesis claim, exact Scopus queries, and known control papers. Northbridge executes the searches, checks control paper indexing, verifies CSV exports on disk via fresh browser downloads, and returns reproducible search logs.

### User Experience from Desktop Chat

A user signs in to Scopus through their university library, an organization account, or a personal subscription. Once signed in, they can say in desktop chat:

> "Scopus is open and I’m signed in. Use Northbridge to run the search block below exactly as written. Check the control paper, export the main results as CSV, and give me the search log. Pause if you need me to sign in again."

### Supported Starting Points

Northbridge supports two flexible starting points:

1. **An Already-Open Scopus Tab (Preferred)**:
   - The user opens Scopus, signs in through their institution or provider, and completes MFA in their own browser.
   - The user specifies `--tab "Scopus"` (or selects the tab in chat). Northbridge attaches to that approved tab session without prompting for credentials.
   - Ideal for users whose institutions use complex multi-step portals or VPNs.
2. **User-Provided Library or Scopus Link**:
   - The user supplies an entry link (e.g. `--url "https://www-scopus-com.ezproxy.rtu.lv"` or fixture URL).
   - Northbridge navigates to the link. If institutional authentication or MFA is required, Northbridge immediately pauses with:\
     `PAUSED: Institutional sign-in required. Please complete sign-in in your browser.`
   - Once the user confirms in chat that sign-in is complete and Scopus home is visible, Northbridge resumes and checks subscription capabilities.

### Institutional & Environmental Compatibility Matrix

Northbridge Browser reports **fixture execution**, **external Chrome attachment**, and **live authenticated Scopus** separately to maintain clear verification boundaries:

| Environment / Route | Status | Capability & Verification Notes |
|---|:---:|---|
| **Local Fixture** (`scopus-fixture.mjs`) | **Verified** | 100% automated test coverage (**28/28** regression checks pass in `test:scopus`). Covers exact Block D3 execution, preprint isolation, control confirmation, multiline RFC 4180 parsing, count mismatch detection, path traversal protection, query syntax/rewrite/missing handling, search-within filter restoration, missed control indexing, non-destructive failure preservation, atomic collision preservation byte-for-byte, multi-attribute `@ref` matching (`[expanded=false, ref=e330]`), ambiguous download rejection, missing-column vs blank-cell distinction, repeatable live-like 1–20 CSV export, dedicated-profile enforcement, and `targetId`-scoped CDP download attribution rejecting decoy competing-tab downloads. |
| **External Chrome Attachment, Auto-Connect, & CLI** (CDP / Auto-Discovery) | **Verified** | Verified against external Chrome with dynamic port discovery (`DevToolsActivePort`), loopback enforcement (`validateCdpEndpoint`), empty metadata `{}` rejection, user approval gate (`--approved`), tab pinning (`--pin-tab` / `AGENT_BROWSER_PIN_TAB=1`), harmless local page (`/scopus/harmless`), repeatable `northbridge-scopus export` (`1–20`), and clean code 0 CLI/MCP exits leaving unrelated tabs untouched. |
| **Riga Technical University (RTU)** | **Pending Live Pilot** | Live 1–20 pilot skipped/pending during owner remote Wi-Fi testing without institutional access. Protocol, auto-connect/CDP attach, and repeatable `export` subcommand ready via EZproxy/ORTUS (`*.scopus.com`, `*.rtu.lv`). Zero credential exposure. **Unverified until tested live with institutional login**. |
| **Other Institutions** (e.g. Tartu, UL, consortium) | **Pending Live Pilot (Simulated)** | Route simulated via `/scopus/other-institution` with sign-in pause and subscription permission checks. **Individually unverified until tested live**. |
| **Direct Personal Account** | **Pending Live Pilot (Simulated)** | Route simulated via `/scopus/direct` with sign-in pause. **Individually unverified until tested live**. |

### Tested Query Shape (Block D3)
```text
BLOCK: D3
CLAIM: Weights can be derived from a rank order.
QUERY: TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )
CONTROL: Decision quality using ranked attribute weights
EXPORT: Ch3_34_SC_D3.csv
```

### Verified Automation Sequence
1. **Advanced Document Search & Exact Query Verification**: Enters query string exactly as supplied without filters or sort modifications. Evaluates `#query-executed` on the results page:
   - If the database rejects the query with a syntax error, marks `NOT EXECUTED` and halts before export.
   - If the database silently rewrites the query, records the rewritten string, marks `NOT EXECUTED`, and halts before export.
   - If the query display is missing entirely, marks `UNCLEAR` and halts before export.
2. **Preprints Isolation**: Records preprints count separately (e.g. `Preprints (1)`). Keeps preprints strictly out of the main document count and CSV export.
3. **Control Paper Verification & Filter Clearing**:
   - Searches within results for the control paper title to verify presence in the block.
   - If absent from block results, runs an exact title search in Advanced Search to confirm whether the paper is indexed in Scopus.
   - **Crucial**: Clears the search-within filter and verifies that the full document results count is restored before triggering export.
4. **Fresh Browser Download & Atomic Collision-Proof Verification**:
   - Triggers CSV export with Citation information and Abstract & keywords fields.
   - **Strict Attempt-Specific Download Capture**: Rather than loose prefix matching (e.g. `file.startsWith('scopus')`), downloads are identified strictly by attempt-specific filenames (`${baseName}.attempt-${attemptId}.csv`) or exact attempt IDs. Pre-existing stale files in `exports/` or Downloads never mask download failures.
   - Validates target filename against path traversal (rejects `/`, `\`, `..`, and absolute paths).
   - Parses CSV using an RFC 4180-compliant parser that preserves multiline abstracts, internal commas, and escaped quotes (`""`).
   - Verifies required columns (`Authors`, `Title`, `Year`, `Source title`, `DOI`, `Abstract`, `Author Keywords`).
   - Verifies that parsed document row count matches observed main results count.
   - **Atomic Unique File Placement**: The downloaded CSV is validated *before* placement at its final destination. If the requested target file already exists in `exports/`, Northbridge never overwrites it. Instead, it places the verified file atomically under a unique candidate filename (`${base} (${counter})${ext}`) using `fs.copyFileSync(..., fs.constants.COPYFILE_EXCL)`. The existing file is preserved byte-for-byte, and both the actual placed path and confirmation of preservation are reported in the search log and last line.
5. **Reproducible Search Log**: Returns structured report:
   ```text
   SEARCH ROWS
   SITE | BLOCK | ROW TYPE | STRING AS EXECUTED | FILTERS | TOTAL | DATE | FILE | MESSAGES

   CONTROL ROWS
   SITE | BLOCK | TITLE | FOUND / NOT FOUND / UNCLEAR | INDEXED / NOT INDEXED / UNCLEAR

   LAST LINE
   Any deviation, access block, export collision note, or issue.
   ```

### Repeatable Results-Tab Export (`export` / `northbridge_export_scopus_results`)

In addition to the mock full-search runner (`executeScopusBlock`), Northbridge provides a dedicated, repeatable **Export → CSV** command starting directly from an already-open, user-approved Scopus results tab (`exportScopusResultsTab` via `node bin/northbridge-scopus.mjs export` or MCP tool `northbridge_export_scopus_results`):

- **Multi-Attribute Snapshot Refs**: Matches `@ref` across attributes such as `[expanded=false, ref=e330]` (`findRef`) and always captures fresh snapshots after opening menus or dialogs.
- **Pre-Click Verification**: Confirms displayed query (`--expected-query`) and visible result count, opens **Export → CSV**, sets the requested range (`--from`/`--to`, `--count`, or `--range 1-20`), checks **Abstract & keywords** and required column checkboxes, and verifies format, range, count, columns, and enabled state before clicking final Export **once**.
- **Isolated Download Attribution & Dedicated-Profile Guard**: Enforces a dedicated Chrome profile before issuing browser-wide `Browser.setDownloadBehavior allowAndName` (rejecting shared default User Data profiles and unverified bare `--cdp` calls with `DEDICATED_PROFILE_REQUIRED`), binds CDP `Page.downloadWillBegin` / `Page.downloadProgress` strictly to the approved tab's `targetId` so competing-tab downloads never hijack or poison an export (Test 28), and falls back to strict folder diff (`identifyFreshDownload`) failing loudly with `EXPORT AMBIGUOUS` if multiple candidates appear.
- **Missing Column vs. Valid Blank Cell Distinction**: Validates UTF-8 BOM CSV headers (`Title`, `DOI`, `Abstract`, and keywords) separately from counting valid blank DOI/keyword cells on individual papers (`validateScopusCsvContent`), saving verified CSVs atomically into `.gitignore`d `pilot-exports/` without overwriting existing files.

### Running the Acceptance Suite & CLI Runner

```powershell
# Run the 28-test Scopus acceptance suite:
npm.cmd run test:scopus

# Run the repeatable Export-only CLI on an explicitly approved dedicated-profile Scopus results tab (saves to pilot-exports/):
node bin/northbridge-scopus.mjs export --auto-connect --approved --profile-dir "$env:LOCALAPPDATA\Google\Chrome\ScopusProfile" --tab "Scopus" --range 1-20

# Run the standalone Scopus Block D3 fixture runner (auto-starts local fixture on port 4318):
node bin/northbridge-scopus.mjs --block D3

# Pre-flight verify attachment to open tab without executing search:
node bin/northbridge-scopus.mjs --auto-connect --approved --verify-attachment --tab "Scopus"

# Run against an externally launched Chrome instance on port 9222 with dedicated profile (fallback):
node bin/northbridge-scopus.mjs --cdp 9222 --profile-dir "$env:LOCALAPPDATA\Google\Chrome\ScopusProfile" --tab "Scopus" --block D3

# Run against an institutional library link:
node bin/northbridge-scopus.mjs --url "https://www-scopus-com.ezproxy.rtu.lv" --block D3
```

### External Chrome Attachment Architecture & Allowlist Boundary

Northbridge Browser supports attaching to an externally running Google Chrome instance via the Chrome DevTools Protocol (CDP):

1. **CLI Options**: Supply `--cdp <port|url>` or `--attach-chrome <port|url>` along with a required `--tab <pattern>` to select the target tab.
2. **Loopback-Only Endpoint & Metadata Validation (`validateCdpEndpoint`)**: Enforces that the CDP host resolves to a loopback address (`127.0.0.1`, `localhost`, or `::1`). Performs a pre-flight HTTP probe to `http://${host}:${port}/json/version` with a 1500ms timeout.
   - **Rejection of Invalid / Empty Metadata**: Strictly validates the debugger JSON metadata. If an endpoint returns empty `{}` or lacks a valid `Browser` string matching `/chrome|chromium/i`, or if `webSocketDebuggerUrl` points outside loopback or to a mismatched port, Northbridge halts immediately with `ATTACHMENT ERROR`, preventing `agent-browser` from silently launching an unrequested fallback browser (`about:blank`).
3. **Strict Unique Tab Selection & Active Tab Verification**: When attaching via CDP, `--tab` is strictly required. The runner matches existing tabs by title and URL substrings. If the tab is missing or matches multiple open tabs ambiguously, Northbridge halts immediately with `TAB ERROR` without navigating or disrupting other open tabs.
   - **Post-Switch Verification**: Checks the `agent_browser_tab_switch` response for tool errors. Immediately re-reads the active tab list (`agent_browser_tab_list`) and verifies that the focused tab's `targetId` and `url` match the selected target before any form inputs or clicks occur.
4. **Dedicated Attachment Verification (`verifyCdpAttachment`)**: Attachment verification is decoupled from search execution. The `verifyCdpAttachment` helper probes loopback readiness, inspects debugger metadata, confirms unique tab selection, switches to the approved tab, and captures snapshot evidence without using search or export shortcuts. Production search blocks always require an executed query, verified control paper, and validated disk export.
5. **Engine Allowlist Incompatibility Boundary**:
   The pinned browser engine (`agent-browser: 0.41.2`) enforces a hard rejection if `--allowed-domains` is combined with `--cdp`:
   ```text
   --allowed-domains is not supported with --cdp because WebRTC containment cannot be installed before existing page scripts run
   ```
   To resolve this engine conflict, `scopus-workflow.mjs` separates the two transports:
   - When `--cdp` is passed, `AGENT_BROWSER_ALLOWED_DOMAINS` is deleted from the MCP environment so the engine attaches cleanly.
   - When running against local fixtures or loopback demos without CDP, `AGENT_BROWSER_ALLOWED_DOMAINS` is maintained.
   - **Boundary Disclosure**: Because the engine's network allowlist is disabled under CDP attachment, attachment containment is enforced via pre-flight loopback validation, strict unique tab targeting, and workflow URL checks. Attachment **cannot** be represented as equivalent to engine-level domain allowlisting.
6. **Automated Attachment & Standalone CLI Verification (Tests 18-22)**:
   - **Test 18**: Verified on an external Chrome process on loopback port 9223 with an isolated profile (`--headless=new`). Successfully executes `verifyCdpAttachment` on a harmless page (`/scopus/harmless`), executes search block D3 exporting 4 records with control confirmed, and leaves unrelated tabs and Chrome running untouched.
   - **Test 19**: Negative tests prove that empty `{}` metadata, unavailable ports (`9999`), and non-loopback IPs (`192.168.1.5`) are cleanly rejected with `ATTACHMENT ERROR` before search.
   - **Test 20**: Tab failure tests prove that missing tabs, ambiguous tabs, failed tab switches, and active tab target ID mismatches cleanly halt with `TAB ERROR` before search.
   - **Test 21**: Proves pinned engine rejection of `--cdp` combined with `--allowed-domains`.
   - **Test 22**: Proves standalone CLI execution (`bin/northbridge-scopus.mjs`) against external Chrome: exits cleanly with code `0`, exports 4 parsed CSV records, preserves pre-existing same-name files byte-for-byte under unique candidate names (`(1).csv`), leaves unrelated tabs untouched, and keeps external Chrome running.
7. **Automatic Discovery (`--auto-connect`), Approval Gate, Tab Pinning (`--pin-tab`), & Dedicated-Profile Guard (Tests 23 & 28)**:
   - **Dynamic Port Discovery**: Automatically locates running Chrome instances by reading `DevToolsActivePort` in dedicated candidate directories (`--profile-dir`, `NORTHBRIDGE_CHROME_PROFILE_DIR`, `CHROME_USER_DATA_DIR`, `%LOCALAPPDATA%\Google\Chrome\ScopusProfile`, `%LOCALAPPDATA%\Northbridge\ChromeProfile`) before checking default directories. Validates the dynamic loopback port without probing fixed port 9222 first.
   - **Explicit User Approval Gate**: Connecting to an open browser requires explicit user consent (`--approved` / `approved: true`). When denied (`--deny`) or left unapproved, the runner halts immediately with `APPROVAL ERROR: approval required` and exit code 1 before issuing any commands to the browser.
   - **Strict Tab Pinning (`AGENT_BROWSER_PIN_TAB=1`) & `targetId`-Scoped Download Attribution**: Session actions stay bound to the selected tab (`tab_gone` if closed/redirected away), and Scopus CSV exports validate a dedicated profile (`DEDICATED_PROFILE_REQUIRED` if shared default User Data or unverified bare `--cdp` is passed) while attributing CDP download events strictly by `targetId` (Test 28).
   - **Unrelated Tab Isolation**: Unrelated tabs in the same or other windows are confirmed open and untouched.
   - **Security Boundary Disclosure**: Chrome remote debugging exposes debugger control over the browser profile at the transport layer, while tab pinning restricts Northbridge strictly to the selected tab. Users should only connect to browser instances they approve, and Scopus export (`Browser.setDownloadBehavior`) requires a dedicated profile directory.
   - **Dedicated Profile Fallback**: Users who prefer explicit port control can use `--cdp <port> --profile-dir <dir>` with a dedicated user data directory.

### Live Pilot Guide (Owner Setup & Chat Prompt)

The automated search and CSV export currently target the local Scopus fixture. On an authenticated Scopus tab, use `--verify-attachment` to check the connection and tab selection. Live search and export still require a read-only inspection of the real page controls before running a pilot.

To execute a live search block through your chosen institutional or direct access route (e.g. Riga Technical University, other universities, or a direct personal account), choose either Option 1 (Use My Open Scopus Tab) or Option 2 (Dedicated Profile Fallback):

#### Option 1: Use My Open Scopus Tab (Preferred · `--auto-connect`)

1. **Sign in to Scopus**: Open Google Chrome as you normally do. Navigate to Scopus through your institutional portal (e.g. RTU ORTUS `https://ortus.rtu.lv` -> Library -> Scopus or `https://www-scopus-com.ezproxy.rtu.lv`), library proxy, or direct account (`https://www.scopus.com`). Complete your institutional sign-in and MFA in the browser. Leave the Scopus tab open.
2. **Pre-flight Verify Attachment (Optional)**:
   ```powershell
   node bin/northbridge-scopus.mjs --auto-connect --approved --verify-attachment --tab "Scopus"
   ```
   Northbridge discovers the active Chrome endpoint dynamically (without probing port 9222 first), confirms explicit approval, verifies the exact Scopus tab, and confirms connection readiness.
3. **Trigger Live Search Block from Desktop Agent Chat**:
   In your desktop agent chat (Antigravity, VS Code Copilot, Codex), paste the copy-ready user prompt:

   > "Scopus is open in my browser and I’m signed in. Use Northbridge with --auto-connect and --approved to run Scopus block D3:
   > - Block: D3
   > - Claim: Weights can be derived from a rank order.
   > - Query: TITLE-ABS-KEY ( \"rank order centroid\" OR \"surrogate weight*\" OR \"ranked attribute weight*\" OR \"rank-based weight*\" )
   > - Control paper: Decision quality using ranked attribute weights
   > - Export file: Ch3_34_SC_D3.csv
   > - Tab: Scopus
   >
   > Run the query exactly as supplied, check the control paper, export the main results as CSV, and return the reproducible search log. Pause if you need me to sign in again or re-authenticate."

---

#### Option 2: Dedicated Chrome Profile Fallback (Explicit `--cdp 9222`)

If you prefer running in a completely separate, dedicated Chrome profile:

##### 1. Launch Chrome with Remote Debugging & Dedicated Profile
In a PowerShell terminal on Windows, run the following command to launch a **visible Chrome window with a dedicated profile and loopback debugging endpoint**:
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"
```

> [!NOTE]
> **Why `--user-data-dir` is required**: Modern Google Chrome requires a dedicated profile path when `--remote-debugging-port` is enabled (see [Chrome Remote Debugging Port Guide](https://developer.chrome.com/blog/remote-debugging-port)). Deriving the directory from `$env:LOCALAPPDATA\Google\Chrome\ScopusProfile` ensures your usual default Chrome profile, open tabs, personal bookmarks, and extensions remain completely separate and untouched. You do **not** need to close your daily browser.

##### 2. Confirm Connection Readiness
Before logging in, verify that Chrome is running and the loopback debugging endpoint is operational. Open `http://127.0.0.1:9222/json/version` in your browser or run in PowerShell:
```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
```
Confirm that:
- `Browser` reports a valid Chrome version (e.g. `"Chrome/131.0.6778.86"` or similar).
- `webSocketDebuggerUrl` is present and points to loopback (`ws://127.0.0.1:9222/...`).

##### 3. Sign In to Scopus via Your Institution or Direct Account (Institution-Neutral)
In the opened dedicated Chrome window:
1. Navigate to your institution's portal or direct Scopus login:
   - **Option A (Riga Technical University)**: Go to RTU ORTUS `https://ortus.rtu.lv` -> Library -> Scopus (or directly to `https://www-scopus-com.ezproxy.rtu.lv`).
   - **Option B (Other Academic / Research Institution)**: Go to your university or organizational library portal / EZproxy / SSO.
   - **Option C (Direct Personal / Corporate Account)**: Go directly to `https://www.scopus.com`.
2. Authenticate manually with your institutional credentials and complete any multi-factor authentication (MFA) prompts.
   - **Zero Credential Exposure**: Passwords, MFA codes, session tokens, and cookies remain exclusively inside your browser. Northbridge never requests, logs, or stores credentials.
3. Confirm that the main Scopus search home page (`https://www.scopus.com/search/form.uri?display=advanced` or basic search) is fully loaded in the tab.

##### 4. Trigger the Live Block from Desktop Chat
In your desktop agent chat (Antigravity, VS Code Copilot, Codex, etc.), paste the following copy-ready user prompt:

> "Scopus is open and I’m signed in on port 9222. Use Northbridge to run Scopus block D3:
> - Block: D3
> - Claim: Weights can be derived from a rank order.
> - Query: TITLE-ABS-KEY ( \"rank order centroid\" OR \"surrogate weight*\" OR \"ranked attribute weight*\" OR \"rank-based weight*\" )
> - Control paper: Decision quality using ranked attribute weights
> - Export file: Ch3_34_SC_D3.csv
>
> Run the query exactly as supplied, check the control paper, export the main results as CSV, and return the reproducible search log. Pause if you need me to sign in again or re-authenticate."

Northbridge attaches to your authenticated browser session via CDP (port 9222), verifies the selected tab, executes the search without query modification, isolates preprints, verifies control paper indexing, validates the CSV export on disk before placement (preserving existing files on collision byte-for-byte), and outputs the structured search log.

##### 5. Disconnection & Teardown
Once the search block is complete and the verified CSV is saved:
1. Northbridge automatically closes its CDP client connection when the command finishes.
2. Close the dedicated Chrome window manually, or terminate it from PowerShell:
   ```powershell
   Get-Process chrome | Where-Object { $_.CommandLine -like "*ScopusProfile*" } | Stop-Process
   ```
3. Your default personal Chrome profile remains untouched throughout.

### Safety & Protection Policies
- **Zero Credential Exposure**: Passwords, MFA codes, and session cookies are never handled by agents, logged, or stored in exports.
- **Bot Challenge Handling**: If Scopus presents a CAPTCHA or unusual-traffic warning, Northbridge halts cleanly with `STOPPED: Bot challenge encountered` and reports progress. It never attempts bypasses or automated solving.
- **Research Server Separation**: The Scopus workflow operates on an approved session with explicit user handoff. It is kept completely separate from `northbridge-browser-research`, which enforces unauthenticated public research isolation.
- **Thesis Chat Scope**: Screening, deduplication, DOI selection, and full-text PDF retrieval remain in the main thesis chat.

---

## Engine Benchmark Comparison (`Agent Browser` vs. `Playwright CDP` Prototype)

A controlled benchmark (`N = 3` runs per engine) compared the project's default `exportScopusResultsTab` workflow (`agent-browser: 0.41.2` over stdio MCP) against an isolated `playwright-core` CDP prototype on the `/scopus/results-live-like?count=25` fixture exporting records `1–20` from the same external headless Chrome instance (with an unrelated tab verified untouched throughout):

| Metric (N = 3 Runs per Engine) | Agent Browser (`exportScopusResultsTab`) | Playwright CDP Prototype (`scratch/pw-proto`) |
|---|:---:|:---:|
| **Completion Rate** | **3 / 3 (100%)** | **3 / 3 (100%)** |
| **Retries** | `0` | `0` |
| **Avg `browserActionMs`** | `6,755 ms` | `814 ms` |
| **Avg `totalWallMs`** | `6,788 ms` | `937 ms` |
| **Browser Operations per Run** | `21` MCP tool calls | `8` direct Playwright/CDP ops |
| **Avg Observation Payload (Normalized UTF-8 Proxy)** | `10,520 bytes` (`10,518 chars`) | `200 bytes` (`200 chars`) |
| **Model Tokens** | `null` *(not exposed by headless programmatic runner)* | `null` *(not exposed by headless programmatic runner)* |
| **Unrelated Tab Untouched** | Verified (`true`) | Verified (`true`) |

- **Metric Distinctions**: `browserActionMs` measures active browser automation through verified CSV placement; `totalWallMs` includes client setup; `obsBytes` measures normalized UTF-8 observation text returned during browser steps (`null` for `modelTokens` indicates runtime non-exposure rather than zero tokens).
- **Engineering Decision**: Keep **Agent Browser** as the project default. Agent Browser preserves compact accessibility-tree exploration on arbitrary or unfamiliar pages, matches our existing `northbridge-research` and `northbridge-browser` architecture, and requires **zero new dependencies** in `package.json` or `package-lock.json` (Playwright required `{ exact: true }` strict locator disambiguation on checkboxes such as `"Abstract"` vs `"Abstract & keywords"`, and `playwright-core` was never added to repo dependencies). Direct CDP scripting via Playwright remains an optional future optimization strictly for high-volume fixed-DOM batch loops if latency becomes material.

---

## Visual Studio Code Installation (One-Click)

Visual Studio Code natively supports Model Context Protocol (MCP) servers in AI agent chat (such as GitHub Copilot in Agent Mode).

### 1. One-Click Install Link (Status: Pending Registry Publication)

> [!WARNING]
> **Pending Verification Status**: The one-click install link below is marked **Pending** until the `northbridge-browser` npm package is published to the public registry or the deep-link registration is independently verified in a clean Windows setup without prior local dependencies. For current local development and evaluation, use the verified [Workspace Configuration (Local Clone)](#4-workspace-configuration-fallback-local-clone) below.

Click the link below to configure Northbridge Browser directly in VS Code (once published):

👉 **[Install Northbridge Browser in VS Code (Pending Publication)](vscode:mcp/install?%7B%22name%22%3A%22northbridge-browser%22%2C%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22northbridge-browser%22%5D%2C%22env%22%3A%7B%22AGENT_BROWSER_ALLOWED_DOMAINS%22%3A%22127.0.0.1%22%7D%7D)**\
*(Web browser redirect: [Open in VS Code via Web](https://vscode.dev/redirect/mcp?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522northbridge-browser%2522%252C%2522type%2522%253A%2522stdio%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522northbridge-browser%2522%255D%252C%2522env%2522%253A%257B%2522AGENT_BROWSER_ALLOWED_DOMAINS%2522%253A%2522127.0.0.1%2522%257D%257D))*

### 2. User Review & Approval Dialog
When clicked, VS Code opens a confirmation modal displaying the server details for your review before connecting:
- **Server Name**: `northbridge-browser`
- **Transport**: `stdio`
- **Command**: `npx`
- **Arguments**: `["-y", "northbridge-browser"]`
- **Environment**: `AGENT_BROWSER_ALLOWED_DOMAINS = 127.0.0.1`

Click **Install** (or **Install for Workspace**) to approve and register the server.

### 3. Prerequisites the Link Cannot Install
The VS Code install link registers the MCP configuration, but you must ensure the following local prerequisites are ready:
1. **Node.js**: Installed on Windows and available on PATH (`node -v`).
2. **Browser Engine**: Run `.\node_modules\.bin\agent-browser.cmd install` (or `npx agent-browser install`) once to download Chrome for Testing, or have Google Chrome installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
3. **Local Mock Portal**: In a PowerShell terminal, start the admissions portal server:
   ```powershell
   npm.cmd start
   ```
   Leave this running at `http://127.0.0.1:4317/`.

### 4. Workspace Configuration Fallback (Local Clone)
If working directly inside a clone of this repository, VS Code automatically reads `.vscode/mcp.json` from the workspace root:

```json
{
  "servers": {
    "northbridge-browser": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/bin/northbridge-browser.js"
      ],
      "env": {
        "AGENT_BROWSER_ALLOWED_DOMAINS": "127.0.0.1"
      }
    },
    "northbridge-scopus": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/bin/northbridge-scopus-mcp.mjs"
      ]
    },
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
Using `${workspaceFolder}/bin/*.js|mjs` provides stable package entry points that launch cleanly without developer-specific absolute paths on Windows across directories containing spaces and Unicode, while keeping `northbridge-browser-research` excluded by default.

### 5. Asking for Northbridge in VS Code Agent Chat
In VS Code, open the Chat view (`Ctrl+Alt+I`), ensure **Agent Mode** is selected, and ask in plain language:

> "Use Northbridge Browser to find the application deadline for MSc Applied Data Science at http://127.0.0.1:4317/. Tell me the deadline and the page you used."
> "Use Northbridge to summarize this page"
> "Use Northbridge to export the first 20 Scopus results"

The agent routes automatically to the appropriate tool (`agent_browser_*`, `northbridge_summarize_page`, or `northbridge_export_scopus_results`) without requiring browser engine names, selectors, or element refs.

### Why No VS Code Extension is Required
VS Code provides native MCP support via `.vscode/mcp.json` and the `vscode:mcp/install` URI handler. Custom VS Code extensions are only needed when accessing editor-internal APIs (such as text editor selections or language servers). Because Northbridge Browser operates strictly over local stdio MCP, the native install link and workspace configuration deliver the full user experience without the complexity of an extension.

*Note: VS Code MCP registration applies strictly to VS Code. If you also use desktop chat applications (such as ChatGPT Desktop or Claude Desktop), see their respective sections below.*

---

---

## Start Here · Quickest Path for Windows

Follow these four steps from Windows PowerShell to install, start, connect, and run your first browser task.

### Step 1: Install Prerequisites and Dependencies
Run `npm.cmd ci` to install project dependencies from the pinned lockfile (`agent-browser: 0.41.2`), then install or register the browser engine:

```powershell
# In the cloned project directory:
npm.cmd ci
.\node_modules\.bin\agent-browser.cmd install
```
*(If Google Chrome is already installed at its standard location, Agent Browser detects and uses it automatically.)*

### Step 2: Start the Local Portal
In a separate PowerShell window, start the mock admissions portal:

```powershell
npm.cmd start
```
The server listens exclusively at `http://127.0.0.1:4317/` with strict loopback binding. Leave this window open.

### Step 3: Connect Your Agent to the Local MCP Server
Register the local MCP server in your coding agent. Run the following snippet in PowerShell to resolve paths automatically without manual editing:

```powershell
$checkout = (Get-Location).Path
$entrypoint = Join-Path $checkout 'bin/northbridge-browser.js'

# For OpenAI Codex CLI:
codex mcp add agent-browser --env AGENT_BROWSER_ALLOWED_DOMAINS=127.0.0.1 -- node $entrypoint mcp --tools core
```

For **Cursor** or **Google Antigravity**, generate the JSON configuration with resolved paths:

```powershell
$checkout = (Get-Location).Path.Replace('\', '/')
$config = @"
{
  "mcpServers": {
    "agent-browser": {
      "command": "node",
      "args": ["$checkout/bin/northbridge-browser.js"],
      "env": {
        "AGENT_BROWSER_ALLOWED_DOMAINS": "127.0.0.1"
      }
    }
  }
}
"@

# For Cursor: Save to .cursor/mcp.json in your workspace root
New-Item -ItemType Directory -Force -Path '.cursor' | Out-Null
$config | Out-File -FilePath '.cursor/mcp.json' -Encoding utf8

# For Antigravity: Save to mcp_config.json in your workspace root
$config | Out-File -FilePath 'mcp_config.json' -Encoding utf8
```

*(See [Generic Local MCP Configuration](#generic-local-mcp-configuration-stdio) and [Client-Specific Guides](#client-specific-guides) below for more details.)*

### Step 4: Try Your First Browser Task in Plain Language
Once connected, prompt your agent in plain English without providing selectors or CLI commands.

#### Prompt 1 · First Search (Deadline Lookup)
> "Use my browser MCP to find the application deadline for MSc Applied Data Science on the local demo portal. Tell me what you found and which page you used."

**Expected Agent Behavior**: The agent discovers the browser tools, opens `http://127.0.0.1:4317/`, inspects the page accessibility structure, follows the link to **MSc Applied Data Science**, reads the deadline (**21 May 2027**), and cites the source page.

#### Prompt 2 · Complete Draft Workflow (Stopping at Human Review Checkpoint)
> "Use my browser MCP to find MSc Applied Data Science and create a draft application for Avery Example, avery@example.test, BSc Statistics. Verify the saved record by reopening it and stop at the review page."

**Expected Agent Behavior**: The agent navigates to the programme, clicks **Start a draft application**, fills the three fields, inspects the populated form snapshot to verify the values, clicks **Save draft**, follows the record link from **My drafts**, verifies the `Draft` status and persisted applicant details on **Review saved draft**, and halts.

#### Prompt 3 · Real-World Public Website Lookup (Opt-in Domain Allowlisting)
> "Use my browser MCP to find the latest LTS release date on nodejs.org. Tell me the answer and link to the source page."

To allow your agent to navigate beyond the local demo portal to a public website, update `AGENT_BROWSER_ALLOWED_DOMAINS` in your MCP server configuration:
```powershell
# Allow nodejs.org and its CDN:
$env:AGENT_BROWSER_ALLOWED_DOMAINS = 'nodejs.org,www.nodejs.org'
```
*(See [Opt-In Public Configuration and Redirect Diagnosis](#opt-in-public-configuration-and-redirect-diagnosis) below.)*

---

---

## Architecture and Security Boundary

### Zero Model Credentials Required by Tool
The local browser tool requires **no model API keys or provider credentials**. Language model authentication is handled entirely by your agent host:
- **Subscription users** use the sign-in provided by their coding agent (e.g., ChatGPT Plus/Team for Codex, Cursor subscription, Google account for Antigravity, GitHub Copilot for VS Code).
- **API-key users** configure their model keys in their agent environment (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.).
- The local browser tool operates identically in both cases because the agent host executes the local tool over `stdio` or shell on your Windows machine.

### Loopback-Only Isolation
The mock admissions portal and demo browser operate under strict isolation controls:
1. **Loopback Server**: `server.mjs` binds strictly to `127.0.0.1:${PORT:-4317}` with restrictive `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`.
2. **Domain Boundary Enforcement**: All browser instances run with `AGENT_BROWSER_ALLOWED_DOMAINS=127.0.0.1` (MCP) or `--allowed-domains 127.0.0.1` (CLI). Any navigation outside `127.0.0.1` is blocked at the browser core.
3. **Isolated Named Sessions**: Each run uses a fresh, random named session (e.g., `northbridge-<id>`). Sessions do not share cookies, `localStorage`, or history with your personal browser or other concurrent agent sessions.
4. **Content as Data & Human Checkpoint**: All page text and fields are treated as untrusted data. The task intentionally concludes at the **Review saved draft** checkpoint to allow human review before submission.

---

---

## Generic Local MCP Configuration (Stdio)

Coding agents that support Model Context Protocol (MCP) over `stdio` can launch the project-local `northbridge-browser` server.

### Why `--tools core`?
Agent Browser `0.41.2` exposes **64 typed tools** under `--tools all` (measured directly via `mcp tools/list`). Note that `frame` and `scrollintoview` are CLI-only subcommands (`.\node_modules\.bin\agent-browser.cmd frame <selector|main>`, absent from both `--tools core` and `--tools all` MCP surfaces), whereas `agent_browser_scroll` is exposed in `--tools core`. Launching with `--tools core` (the default in `bin/northbridge-browser.js`) limits MCP discovery to **29 essential tools** (navigation, accessibility snapshots, clicking, filling, waiting, reading, scrolling, screenshots, eval, tab basics, and closing). This cuts prompt token overhead while keeping every core interactive browser action available.

### Windows Subprocess Batch Hardening (CVE-2024-27980)
> [!IMPORTANT]
> On Windows, configuring `command: "agent-browser.cmd"` or `command: "npx"` directly in Node-based MCP hosts can fail with `Error: spawn EINVAL` due to Windows batch file execution restrictions (CVE-2024-27980).
> Always configure the host to launch **`node`** targeting the package entrypoint (`bin/northbridge-browser.js`), or launch the **native `.exe` binary** directly.

### Standard Configuration (`node` Entrypoint)
Where `<CHECKOUT_PATH>` is the absolute path to your cloned repository:

```json
{
  "mcpServers": {
    "northbridge-browser": {
      "command": "node",
      "args": [
        "<CHECKOUT_PATH>/bin/northbridge-browser.js"
      ],
      "env": {
        "AGENT_BROWSER_ALLOWED_DOMAINS": "127.0.0.1"
      }
    },
    "northbridge-scopus": {
      "command": "node",
      "args": [
        "<CHECKOUT_PATH>/bin/northbridge-scopus-mcp.mjs"
      ]
    },
    "northbridge-summarize": {
      "command": "node",
      "args": [
        "<CHECKOUT_PATH>/bin/northbridge-summarize-mcp.mjs"
      ],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": ""
      }
    }
  }
}
```

### Alternative Configuration (Native x64 Binary)
```json
{
  "mcpServers": {
    "northbridge-browser": {
      "command": "<CHECKOUT_PATH>\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe",
      "args": [
        "mcp",
        "--tools",
        "core"
      ],
      "env": {
        "AGENT_BROWSER_ALLOWED_DOMAINS": "127.0.0.1"
      }
    }
  }
}
```

---

---

## Client-Specific Guides

### Client Setup & Honest Verification Status

| Client | Configuration Path & Servers | Discovery Tooling | Honest Verification Status on Windows |
|---|---|---|---|
| **VS Code (Agent Mode)** | `.vscode/mcp.json` (workspace auto-discovered: `northbridge-browser`, `northbridge-scopus`, `northbridge-summarize` with `NORTHBRIDGE_APPROVED_DOMAINS=""`) | Built-in web/repo context or user-provided URL | **Workspace config verified in local tests**; 1-click npm install link **Pending** npm publication. |
| **Google Antigravity** | `~/.gemini/config/mcp_config.json` (global) | Built-in `search_web` | **Fresh plain-language chat tested (`e32f48a4`)**: under unmodified global config (`agent-browser` locked to `127.0.0.1` only), `search_web` Discovery succeeded while external reads blocked cleanly (`[APPROVAL REQUIRED]` / loopback domain allowlist). Loopback local demo verified in real Antigravity chat. |
| **Cursor** | `.cursor/mcp.json` | Cursor Web / Search | Configuration documented; **Unverified live on Cursor** (needs owner live test if used). |
| **OpenAI Codex (CLI)** | `.codex/config.toml` / `~/.codex/config.toml` (`codex mcp add ...`) | Codex web search / shell | Verified local loopback demo in Codex chat & CLI (`BENCHMARK.md`, local preview); plain-language `northbridge-summarize` / `northbridge-scopus` MCP registration **Unverified live in Codex**. |
| **Claude Desktop** | `%APPDATA%\Claude\claude_desktop_config.json` | Host search / fetch (if enabled) | Configuration documented; **Unverified live on Claude Desktop** on Windows. |
| **ChatGPT Desktop** | Settings > Developer > MCP Servers (`stdio`) | Host search / web UI (local stdio on Windows Desktop) | Configuration documented; **Unverified live on ChatGPT Desktop** on Windows. |

---

### Visual Studio Code
See [Visual Studio Code Installation](#visual-studio-code-installation-one-click) above for the 1-click install link and `.vscode/mcp.json` workspace configuration.

---

---

### Claude Desktop (Windows)
To connect Northbridge Browser, Scopus Export, and Page Summary to Claude Desktop on Windows:
1. Open `%APPDATA%\Claude\claude_desktop_config.json` in your editor.
2. Add the three server entries:
   ```json
   {
     "mcpServers": {
       "northbridge-browser": {
         "command": "node",
         "args": [
           "C:/path/to/university-browser-demo/bin/northbridge-browser.js"
         ],
         "env": {
           "AGENT_BROWSER_ALLOWED_DOMAINS": "127.0.0.1"
         }
       },
       "northbridge-scopus": {
         "command": "node",
         "args": [
           "C:/path/to/university-browser-demo/bin/northbridge-scopus-mcp.mjs"
         ]
       },
       "northbridge-summarize": {
         "command": "node",
         "args": [
           "C:/path/to/university-browser-demo/bin/northbridge-summarize-mcp.mjs"
         ],
         "env": {
           "NORTHBRIDGE_APPROVED_DOMAINS": ""
         }
       }
     }
   }
   ```
3. Restart Claude Desktop. The hammer icon will expose the 29 loopback browser tools plus `northbridge_export_scopus_results` and `northbridge_summarize_page`.

---

---

### ChatGPT Desktop (Windows)
In ChatGPT Desktop:
1. Navigate to **Settings > Developer > MCP Servers > Add New Server**.
2. Configure `northbridge-browser` (and optionally `northbridge-scopus` / `northbridge-summarize`):
   - **Name**: `northbridge-browser`
   - **Transport**: `stdio`
   - **Command**: `node`
   - **Arguments**: `C:/path/to/university-browser-demo/bin/northbridge-browser.js`
   - **Environment**: `AGENT_BROWSER_ALLOWED_DOMAINS=127.0.0.1`

---

---

### OpenAI Codex (CLI)

#### 1. Adding the MCP Servers
The Codex CLI uses POSIX-style argument parsing. Environment flags must precede the `--` separator, followed by the command and arguments:

```powershell
$checkout = (Get-Location).Path
codex mcp add northbridge-browser --env AGENT_BROWSER_ALLOWED_DOMAINS=127.0.0.1 -- node (Join-Path $checkout 'bin/northbridge-browser.js')
codex mcp add northbridge-scopus -- node (Join-Path $checkout 'bin/northbridge-scopus-mcp.mjs')
codex mcp add northbridge-summarize --env NORTHBRIDGE_APPROVED_DOMAINS= -- node (Join-Path $checkout 'bin/northbridge-summarize-mcp.mjs')
```

**Using `config.toml` (`.codex/config.toml` or `~/.codex/config.toml`):**
```toml
[mcp_servers.northbridge-browser]
command = "node"
args = ["C:/path/to/university-browser-demo/bin/northbridge-browser.js"]

[mcp_servers.northbridge-browser.env]
AGENT_BROWSER_ALLOWED_DOMAINS = "127.0.0.1"

[mcp_servers.northbridge-scopus]
command = "node"
args = ["C:/path/to/university-browser-demo/bin/northbridge-scopus-mcp.mjs"]

[mcp_servers.northbridge-summarize]
command = "node"
args = ["C:/path/to/university-browser-demo/bin/northbridge-summarize-mcp.mjs"]

[mcp_servers.northbridge-summarize.env]
NORTHBRIDGE_APPROVED_DOMAINS = ""
```

#### 2. Authentication Modes
- **ChatGPT Subscription Mode**: Run `codex login` to authenticate using your ChatGPT Plus, Pro, Team, or Enterprise account via your browser, or run `codex login --device-auth` for headless environments.
- **OpenAI Platform API-Key Mode**: Set `$env:OPENAI_API_KEY = "sk-..."` or pipe your key: `Get-Content my-key.txt | codex login --with-api-key`.

---

---

### Cursor

#### 1. Configuration
Create `.cursor/mcp.json` in your workspace root:

```json
{
  "mcpServers": {
    "northbridge-browser": {
      "command": "node",
      "args": ["C:/path/to/university-browser-demo/bin/northbridge-browser.js"],
      "env": {
        "AGENT_BROWSER_ALLOWED_DOMAINS": "127.0.0.1"
      }
    },
    "northbridge-scopus": {
      "command": "node",
      "args": ["C:/path/to/university-browser-demo/bin/northbridge-scopus-mcp.mjs"]
    },
    "northbridge-summarize": {
      "command": "node",
      "args": ["C:/path/to/university-browser-demo/bin/northbridge-summarize-mcp.mjs"],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": ""
      }
    }
  }
}
```
Or add them via **Cursor Settings > Features > MCP > Add New MCP Server**.

#### 2. Authentication Modes
- **Cursor Subscription Mode**: Sign in to your Cursor account in the IDE.
- **Custom API Key Mode**: Enter your personal API key in **Cursor Settings > Models**.

---

---

### Google Antigravity

#### 1. Configuration & Default State Note
In this workspace environment, global `~/.gemini/config/mcp_config.json` registers only `agent-browser` (`AGENT_BROWSER_ALLOWED_DOMAINS="127.0.0.1"`), without auto-registering `.vscode/mcp.json`'s `northbridge-summarize` or `northbridge-scopus`. A fresh plain-language Antigravity subagent test (`e32f48a4`) under unmodified global configuration confirmed that Discovery (`search_web`) works immediately, while external browsing via `agent-browser` and `northbridge-summarize` halts cleanly at `Domain '...' is not in the allowed domains list` and `[APPROVAL REQUIRED]`.

To expose the workspace servers directly inside Antigravity, add the entries below to `~/.gemini/config/mcp_config.json` (setting `NORTHBRIDGE_APPROVED_DOMAINS` explicitly to any public domains you approve for URL summarization):

```json
{
  "mcpServers": {
    "northbridge-browser": {
      "command": "node",
      "args": ["C:/path/to/university-browser-demo/bin/northbridge-browser.js"],
      "env": {
        "AGENT_BROWSER_ALLOWED_DOMAINS": "127.0.0.1"
      }
    },
    "northbridge-scopus": {
      "command": "node",
      "args": ["C:/path/to/university-browser-demo/bin/northbridge-scopus-mcp.mjs"]
    },
    "northbridge-summarize": {
      "command": "node",
      "args": ["C:/path/to/university-browser-demo/bin/northbridge-summarize-mcp.mjs"],
      "env": {
        "NORTHBRIDGE_APPROVED_DOMAINS": ""
      }
    }
  }
}
```

#### 2. Authentication Modes
- **Workspace Sign-In**: Authenticate using your Google account inside Antigravity.
- **API-Key Mode**: Configure `$env:GEMINI_API_KEY = "..."` or set your key in IDE settings.

---

---

### Web-Only and Cloud Agents
Cloud-hosted chat interfaces (such as web-based ChatGPT or remote web IDEs) cannot spawn local Windows processes directly. To automate a local browser from a cloud agent, connect through a supported local agent runner, bridge, or gateway running on your Windows machine that can execute tools over `stdio` or shell.

---

---

## PowerShell CLI Fallback

For coding agents that lack MCP support but can invoke shell commands (or for manual debugging), use the project-local CLI fallback.

```powershell
$browser = '.\node_modules\.bin\agent-browser.cmd'
$session = 'northbridge-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$browserArgs = @('--session', $session, '--allowed-domains', '127.0.0.1')

# 1. Open catalogue and observe main region
& $browser @browserArgs open http://127.0.0.1:4317/
& $browser @browserArgs snapshot -c -s '#main'

# 2. Click link using observed ref (e.g., @e3) and refresh snapshot
& $browser @browserArgs click '@e3'
& $browser @browserArgs snapshot -c -s '#main'

# 3. Click 'Start a draft application' (e.g., @e6)
& $browser @browserArgs click '@e6'
& $browser @browserArgs snapshot -c -s '#main'

# 4. Fill form fields
& $browser @browserArgs fill '@e9' 'Avery Example'
& $browser @browserArgs fill '@e10' 'avery@example.test'
& $browser @browserArgs fill '@e11' 'BSc Statistics'

# 5. Scoped snapshot of populated form (verifying labels and values)
& $browser @browserArgs snapshot -c -s 'form'

# 6. Click 'Save draft' button (e.g., @e12)
& $browser @browserArgs click '@e12'
& $browser @browserArgs snapshot -c -s '#main'

# 7. Follow record link to review page (e.g., @e14)
& $browser @browserArgs click '@e14'
& $browser @browserArgs snapshot -c -s '#main'

# 8. Close session
& $browser --session $session close
```

### Reference Management Best Practices
- **Always quote refs**: Quote refs like `'@e1'` in PowerShell to prevent special character interpretation.
- **Fresh refs after navigation**: Element references (`@eN`) update on page changes. Always refresh the snapshot after navigation before interacting with new elements.
- **Visible text inclusion**: In MCP tool calls, pass `"interactive": false` when capturing snapshots to inspect static text (such as deadlines, headings, and labels).

---

---

## Automated Verification Scripts

Six automated acceptance & regression test suites are included in the repository:

```powershell
# Self-contained suites (auto-manage local fixture / headless Chrome):
# 1. Scopus Search, Attachment & Repeatable 1-20 CSV Export Suite (28/28 checks)
npm.cmd run test:scopus

# 2. Read-Only Page Summary, Interactive Reveal & MCP UX Suite (11/11 checks)
npm.cmd run test:summary

# Suites expecting the local portal server running (`npm.cmd start` on port 4317):
# 3. Admissions Demo MCP Acceptance Test (15 tool calls over stdio)
npm.cmd run test:mcp

# 4. Admissions Demo PowerShell CLI Acceptance Test (15 CLI process spawns)
npm.cmd run test:cli

# 5. Admissions Demo Scripted MCP Deadline Lookup Test (stdio)
npm.cmd run test:lookup

# 6. Research Access Policy & Isolation Suite (9/9 checks; reproduces upstream connection-time IP gap)
npm.cmd run test:research
```

---

---

## Opt-In Public Configuration and Redirect Diagnosis

By default, this repository enforces strict loopback confinement (`127.0.0.1`). When automating public websites:

### 1. Enabling Public Domains
Update `AGENT_BROWSER_ALLOWED_DOMAINS` (MCP) or `--allowed-domains` (CLI) with comma-separated hostnames:

```powershell
# In MCP environment:
"env": {
  "AGENT_BROWSER_ALLOWED_DOMAINS": "example.com,www.example.com"
}

# In CLI fallback:
& $browser --allowed-domains "example.com,www.example.com" open https://example.com/
```

### 2. Diagnosing Blocked Navigations and Redirects
When a website redirects (e.g. from `http://` to `https://`, or from apex `example.com` to `www.example.com` or an OAuth provider):
- **Observed Error**: `Domain 'target.com' is not in the allowed domains list` with exit code `1` (CLI) or `isError: true` (MCP).
- **Diagnosis**: Check the requested URL and the final destination hostname. If the site uses an external CDN or authentication domain (e.g. `auth0.com`), add the destination hostname to the allowlist.
- **Security Check**: Never set wildcard allowlists (`*`) unless intentionally operating in an unrestricted environment.

---

---

## Scope and Agent Desktop Integration Trigger

### Browser Automation Boundary
This release is strictly dedicated to web browser automation within web pages and web applications. Agent Browser handles all DOM interactions, navigation, scoped accessibility snapshots, cookies, local storage, and synthetic data input.

### Trigger for Agent Desktop
**Agent Desktop** becomes relevant **only when a workflow encounters an identified native Windows OS control that cannot be manipulated via the browser engine**.

Examples of valid triggers:
1. Native Windows authentication or smartcard credential dialogs.
2. Interacting with third-party desktop applications (e.g. Excel, legacy Windows forms, local PDF editors).
3. Native OS file dialogs where web standards are bypassed.

### Testing Web File Inputs First
Before considering Agent Desktop for file operations, always test standard HTML file inputs (`<input type="file">`) using Agent Browser's built-in file upload tool:
- **CLI**: `& $browser @browserArgs upload <selector-or-ref> <file-path>`
- **MCP**: `agent_browser_upload` with `selector` and `paths`

Agent Browser sets the file input directly through Chrome DevTools Protocol (CDP) without opening a native Windows file picker dialog.

### Protocol for Future Native Integrations
If native Windows controls must be automated in a future project:
1. Use Agent Desktop's own dedicated CLI or MCP server.
2. Verify the target application process and window handle explicitly.
3. Scope the desktop UI snapshot to the relevant window.
4. Use fresh element references.
5. Independently verify the result after interaction.
*Note: Agent Desktop installation and dependencies are separate from this browser demo.*

---

---

## Teardown and Integration Removal

To remove the integration cleanly without affecting other browser sessions, personal browser profiles, or global agent configuration:

### 1. Close Demo Browser Session
Close only the specific demo session (preserving any unrelated browser sessions):
- **CLI**:
  ```powershell
  .\node_modules\.bin\agent-browser.cmd --session <session-name> close
  ```
- **MCP**:
  ```powershell
  @{ session = "<session-name>" } | ConvertTo-Json -Compress | node bin/northbridge-browser.js mcp call agent_browser_close -
  ```

### 2. Stop the Mock Server
Press `Ctrl+C` in the terminal running `npm.cmd start`.

### 3. Remove Project MCP Registration
Remove only this project's server entries (`northbridge-browser`, `northbridge-scopus`, `northbridge-summarize`):
- **VS Code**: Run Command Palette (`Ctrl+Shift+P`) -> `MCP: Remove Server` or edit `.vscode/mcp.json` / User `mcp.json`.
- **Codex**:
  ```powershell
  codex mcp remove northbridge-browser
  codex mcp remove northbridge-scopus
  codex mcp remove northbridge-summarize
  ```
- **Cursor**: In `.cursor/mcp.json`, remove the `northbridge-browser`, `northbridge-scopus`, and `northbridge-summarize` entries, preserving any other MCP servers.
- **Antigravity**: In `mcp_config.json`, remove the `northbridge-browser`, `northbridge-scopus`, and `northbridge-summarize` entries, preserving any other MCP servers.
- **Claude Desktop**: In `%APPDATA%\Claude\claude_desktop_config.json`, remove only the project's `northbridge-*` blocks.
- **ChatGPT Desktop**: In Settings > Developer > MCP Servers, remove the project's `northbridge-*` server entries.

*(Existing client logins, accounts, and other MCP servers remain completely untouched.)*

### 4. Remove Project Dependencies and Cache (Optional)
```powershell
# Remove node_modules
Remove-Item -Recurse -Force .\node_modules

# Remove downloaded browser runtime (does not affect personal Google Chrome)
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\agent-browser" -ErrorAction SilentlyContinue
```

---

---

## Troubleshooting for Windows

### 1. Server Not Found or Failed to Spawn (`spawn EINVAL`)
- **Symptom**: Agent throws `Error: spawn EINVAL` or `spawn agent-browser.cmd ENOENT` when launching the MCP server.
- **Cause**: Windows batch file execution restriction (CVE-2024-27980). Node subprocesses cannot spawn `.cmd` or `.bat` files without a shell wrapper.
- **Fix**: Launch `node` directly with the entrypoint (`bin/northbridge-browser.js`), or launch the native binary `.exe` directly.

### 2. Portal Unreachable
- **Symptom**: Browser navigation fails with `net::ERR_CONNECTION_REFUSED` or timeout.
- **Check**: Verify the server is running on port 4317 in PowerShell:
  ```powershell
  Get-NetTCPConnection -LocalPort 4317 -ErrorAction SilentlyContinue
  ```
- **Fix**: Run `npm.cmd start` in a separate terminal. If port 4317 is already in use by another application, specify an alternate port:
  ```powershell
  $env:PORT = '4318'
  npm.cmd start
  ```
  And update your prompt or tool calls to target `http://127.0.0.1:4318/`.

### 3. Domain Blocked / Allowlist Rejection
- **Symptom**: Tool returns `isError: true` with `Domain '...' is not in the allowed domains list` or JSON-RPC error `-32602`.
- **Cause**: The server is configured with `AGENT_BROWSER_ALLOWED_DOMAINS=127.0.0.1`, which prevents navigation to external sites. Also, passing `allowedDomains` in individual MCP tool calls when the environment already sets it triggers `-32602`.
- **Fix**: Set allowed domains in the server's environment block (e.g. `AGENT_BROWSER_ALLOWED_DOMAINS=127.0.0.1,example.com`) and omit `allowedDomains` from individual tool arguments.

### 4. Advanced: Testing MCP Tool Calls Manually via PowerShell
To verify MCP tool dispatch directly without an agent host, pipe PowerShell hashtables via `ConvertTo-Json -Compress` into `node bin/northbridge-browser.js mcp call <tool> -`:

```powershell
$session = 'test-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
$env:AGENT_BROWSER_ALLOWED_DOMAINS = '127.0.0.1'

# Open portal
@{ url = 'http://127.0.0.1:4317/'; session = $session } | ConvertTo-Json -Compress | node bin/northbridge-browser.js mcp call agent_browser_open -

# Scoped snapshot
@{ selector = '#main'; compact = $true; interactive = $false; session = $session } | ConvertTo-Json -Compress | node bin/northbridge-browser.js mcp call agent_browser_snapshot -

# Close session
@{ session = $session } | ConvertTo-Json -Compress | node bin/northbridge-browser.js mcp call agent_browser_close -
```
