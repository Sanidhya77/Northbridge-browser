# Project Handoff · Windows Browser Tools for Coding Agents

- **Prepared for**: Project Owner & Codex Reviewers
- **Project**: `university-browser-demo`
- **Date**: November 10, 2026
- **Final Release & Verification Status**:
- **Local Demo Preview (`northbridge-browser`)**: **Ready for independent review** (verified across MCP and PowerShell CLI; `test:lookup`, `test:mcp`, `test:cli` re-verified November 10)
- **Scopus Local Fixture, Attachment, & Repeatable Export (`scopus-fixture.mjs` / `scopus-workflow.mjs` / `northbridge-scopus-mcp.mjs`)**: **Verified (28/28 Checks Pass)** — includes repeatable `export` subcommand / `northbridge_export_scopus_results` starting from an approved dedicated-profile results tab (`1–20` live-like fixture export), multi-attribute `@ref` matching (`[expanded=false, ref=e330]`), dedicated-profile guard (`DEDICATED_PROFILE_REQUIRED` rejecting shared default Chrome User Data and bare `--cdp`), `targetId`-scoped CDP download attribution rejecting decoy competing-tab downloads (Test 28), and UTF-8 BOM CSV header vs. blank-cell validation
- **Read-Only Page Summary & 6-Step Read/Navigate/Verify UX (`page-summary.mjs` / `northbridge-summarize-mcp.mjs`)**: **Verified (11/11 Automated + Live Public Validation)** — implements **Discover -> Orient -> Read -> Reveal -> Verify -> Compact Output** across 8 explicit statuses (`normal`, `partial-body`, `abstract-only`, `metadata-only`, `outline-only`, `blocked`, `pdf-readable`, `pdf-unreadable`), structured `tables` pagination (`maxTableRows`), redacted `links`, Shadow DOM/iframe fallback with `inaccessibleSections` reporting, 4-widget interactive `--reveal` verification (`5,869 ms`, `obsBytes=11,797`, `0` screenshots), and strict mode separation
- **Fresh Plain-Language Antigravity Chat Test (`e32f48a4`)**: **Verified Clean Boundary Enforcement** — Discovery via `search_web` succeeded (`Prof. Shimon Whiteson`, Oxford CS, QMIX `arXiv:2003.08839` / JMLR `20-081`), while unmodified `~/.gemini/config/mcp_config.json` (`agent-browser` locked to `127.0.0.1` only) and `northbridge-summarize` blocked external reads (`[APPROVAL REQUIRED]`) with zero bypasses or config edits
- **Live Authenticated Scopus 1–20 & Authenticated IEEE Xplore**: **Needs Approved Live Browser Test / Skipped** — owner is on regular Wi-Fi without institutional login access and requested skipping authenticated IEEE/Scopus runs while verifying freely visible public articles and PDFs instead (approved open IEEE homepage tab `https://ieeexplore.ieee.org/Xplore/home.jsp` verified read-only in `3,649 ms`)
- **Public Distribution (`northbridge-browser-research` & VS Code 1-Click)**: **Blocked / Pending** — `northbridge-browser-research` stays excluded from `.vscode/mcp.json` due to upstream CDP `Fetch.enable` connection-time IP gap (`test:research` 9/9 PASS); VS Code install link pending npm registry release

---

## 1. Executive Summary & Component Status

This handoff documents Milestones 1–3 on `pilot-live-scopus-validation` (on top of `289ccc3` baseline), covering the verified Scopus systematic literature search and CSV export capability, repeatable Scopus 1–20 CSV export, read-only page summarization, plain-language MCP/CLI tools (`northbridge-scopus` and `northbridge-summarize`), live public academic/PDF validation, and the Agent Browser vs. Playwright CDP benchmark.

### Scope & Evaluation Clarifications
- **Local Demo Preview**: Documented as a **local preview** of single-session browser interaction through structured accessibility trees and stable element references (`@ref`), not an end-to-end multi-agent evaluation.
- **Desktop Browser Traces**: Full browser tool traces and session metrics are retained as concrete evidence of working local and CDP connections.
- **Token Cost Clarification**: Lower token cost compared to visual coordinate clicking remains a **hypothesis pending a matched `@Chrome` benchmark run** with an LLM in the loop; normalized UTF-8 byte counts (`obsBytes`) measure observation payload size only, and headless programmatic runs report `modelTokens: null`.
- **Default Setup Policy**: `.vscode/mcp.json` enables `northbridge-browser` (loopback `127.0.0.1`), `northbridge-scopus` (`northbridge_export_scopus_results`), and `northbridge-summarize` (`northbridge_summarize_page` with `NORTHBRIDGE_APPROVED_DOMAINS=""`). Raw public research server `northbridge-browser-research` remains **excluded from default configuration** while the upstream connection-time IP gap remains open.

### Status Matrix

| Component | Status | Verification Summary |
|---|---|---|
| **Local Demo Preview** (`northbridge-browser`) | **Ready for independent review** | Verified across MCP stdio (`test:lookup`, `test:mcp`) and PowerShell CLI (`test:cli`) with 0 failures, 0 retries, and exact value `"Draft"`. Mock portal (`portal.html`, `server.mjs`) and baseline benchmarks (`BENCHMARK.md`) are preserved intact. |
| **Scopus Search, Attachment & Repeatable Export** (`scopus-workflow.mjs` / `northbridge-scopus-mcp.mjs`) | **Verified (28/28)** | All **28/28** tests pass (`npm.cmd run test:scopus`). Covers fixture search/export, dynamic Chrome auto-connect (`--approved`, `--pin-tab`), dedicated-profile enforcement (`DEDICATED_PROFILE_REQUIRED` rejecting shared User Data & bare `--cdp`), multi-attribute `@ref` matching (`[expanded=false, ref=e330]`), `targetId`-scoped CDP download attribution (`Browser.setDownloadBehavior allowAndName`) rejecting decoy competing-tab downloads + strict `EXPORT AMBIGUOUS` rejection, UTF-8 BOM CSV header validation vs. blank cells, query mismatch halts, and repeatable `1–20` CSV export via CLI (`export`) and MCP (`northbridge_export_scopus_results`). |
| **Read-Only Page Summary & 6-Step Read/Navigate/Verify UX** (`page-summary.mjs` / `northbridge-summarize-mcp.mjs`) | **Verified (11/11 + Live Public Checks)** | All **11/11** tests pass (`npm.cmd run test:summary`). Verified URL token redaction, `[UNTRUSTED EXTERNAL DATA]` framing, zero screenshots by default, focused section pagination, 8 classifications (`normal`, `partial-body`, `abstract-only`, `metadata-only`, `outline-only`, `blocked`, `pdf-readable`, `pdf-unreadable`), structured `tables` pagination (`maxTableRows`), Shadow DOM/iframe fallback + `inaccessibleSections` reporting, 4-widget interactive `--reveal` (`5,869 ms`, `obsBytes=11,797`, `0` screenshots), and mode separation. Live-tested on Oxford CS (`shimon.whiteson`), `agent-browser.dev/commands`, W3C Disclosure APG (`--reveal`, `0` retries), `arxiv.org` HTML/abs/PDF (`2311.10090` & `2510.10666`), PLOS ONE, PMC, PubMed, Nature preview, MDPI WAF, and unauthenticated IEEE. |
| **Agent Browser Schema Inventory** (`agent-browser: 0.41.2`) | **Verified** | Direct `mcp tools/list` confirms `--tools core` = **29 tools**, `--tools all` = **64 tools** (README corrected from `156`). `agent_browser_frame` and `scrollintoview` are CLI-only (absent from MCP `core` and `all`); `agent_browser_scroll` is in `--tools core`. |
| **Fresh Plain-Language Antigravity Chat Test** (`e32f48a4`) | **Verified Boundary** | Under unmodified `~/.gemini/config/mcp_config.json` (`agent-browser` locked to `127.0.0.1` only), `search_web` Discovery worked while external URLs and unapproved tab reads halted cleanly (`Domain ... is not in the allowed domains list`, `[APPROVAL_REQUIRED]`) with zero bypasses. |
| **Live Authenticated Scopus & IEEE Xplore** (`northbridge-scopus` / `northbridge-summarize`) | **Needs Approved Live Test / Skipped** | Owner skipped authenticated live runs on current Wi-Fi without institutional login access. Protocol, `--auto-connect --approved --tab`, dedicated `--profile-dir` guard, and pre-flight `--verify-attachment` are ready for RTU ORTUS/EZproxy, other institutions, or direct accounts when authenticated access is available. Approved IEEE portal homepage (`ieeexplore.ieee.org/Xplore/home.jsp`) verified read-only (`3,649 ms`). |
| **Public Distribution** (`northbridge-browser-research` & VS Code 1-Click) | **Blocked / Pending** | **`northbridge-browser-research` is BLOCKED** (`test:research` **9/9** reproduces connection-time gap on approved hostnames during redirects). Kept out of `.vscode/mcp.json`. **VS Code 1-Click Link is PENDING** npm publication. |

---

## 2. Changed and Created Files

| File | Status | Purpose |
|---|---|---|
| `scopus-fixture.mjs` | **Updated** | Dedicated Scopus fixture server (`4318`) with Advanced search, live-like 25-record results view (`/scopus/results-live-like` with `drop_download` / `delay_ms` / `compete_token`), competing unrelated download tab (`/scopus/competing-download`, `/scopus/competing-csv`), preprints counter, Export -> CSV menu/dialog, omitted-column test fixtures, auth/bot gates, and `/scopus/harmless`. |
| `scopus-workflow.mjs` | **Updated** | Adds `exportScopusResultsTab` alongside `executeScopusBlock`, `inspectChromeProfileSafety` / `isSharedDefaultChromeProfileDir` (`DEDICATED_PROFILE_REQUIRED`), multi-attribute `findRef`, `identifyFreshDownload` (ambiguous rejection), `createCdpDownloadSession` (`targetId`-scoped CDP download attribution & `TARGET_ID_REQUIRED`), `validateScopusCsvContent` (BOM + missing header vs. blank cell counts), `discoverChromeEndpoint`, and `verifyCdpAttachment`. |
| `bin/northbridge-scopus.mjs` | **Updated** | Adds repeatable `export` subcommand (`--auto-connect`, `--approved`, `--profile-dir`, `--tab`, `--from`/`--to`/`--count`/`--range`, `--expected-query`, `--output pilot-exports`) and preserves fixture CLI & `--verify-attachment`. |
| `bin/northbridge-scopus-mcp.mjs` | **Created** | Stdio MCP server exposing `northbridge_export_scopus_results` (requires `approved: true` and dedicated `--profile-dir` / `ScopusProfile`, defaults output to `.gitignore`d `pilot-exports/`). |
| `page-summary.mjs` | **Created & Fixed** | Implements 6-step read/navigate/verify workflow (**Discover -> Orient -> Read -> Reveal -> Verify -> Compact Output**) via `sanitizeUrl`, `parseOutlineHeadings`, `classifyAndStructurePage`, `summarizeApprovedTab`, `summarizePublicUrl`, and `formatPageSummaryText`: 8 `contentStatus` values (`normal`, `partial-body`, `abstract-only`, `metadata-only`, `outline-only`, `blocked`, `pdf-readable`, `pdf-unreadable`), interactive `--reveal` settle polling, structured `tables` pagination (`maxTableRows`), redacted `links`, Shadow DOM & accessible iframe snapshot fallback, `inaccessibleSections` reporting (`agent_browser_frame` skip), multiline heading normalization, `arxiv.org/abs/` & Nature preview detection, and 25s public PDF timeout note. |
| `bin/northbridge-summarize.mjs` | **Created** | CLI entrypoint for read-only page summarization (`--url` or `--auto-connect --approved --tab`, `--section`, `--max-chars`, `--offset`, `--max-table-rows`, `--reveal`, `--no-links`, `--no-tables`, `--screenshot-reason`). |
| `bin/northbridge-summarize-mcp.mjs` | **Created** | Stdio MCP server exposing `northbridge_summarize_page` (`section`, `maxChars`, `charOffset`, `maxTableRows`, `includeLinks`, `includeTables`, `reveal`, `screenshotReason`) with strict public-URL vs. approved-tab separation and server-only `NORTHBRIDGE_APPROVED_DOMAINS`. |
| `test-scopus-acceptance.mjs` | **Expanded** | Expanded to **28/28** tests adding multi-attribute `@ref` & ambiguous download checks (Test 24), UTF-8 BOM missing-column vs. blank-cell validation (Test 25), repeatable `1–20` live-like export & CLI collision preservation (Test 26), query mismatch + missing Abstract header halt (Test 27), and dedicated-profile guard (`DEDICATED_PROFILE_REQUIRED`, `TARGET_ID_REQUIRED`) + `targetId`-scoped CDP download attribution rejecting decoy competing-tab CSVs (Test 28). |
| `test-page-summary.mjs` | **Created & Expanded** | **11/11** automated test suite covering URL sanitization, pagination, scholarly/technical classification edge cases (arXiv abs, Nature preview paywall, PubMed `##\nAbstract`, IEEE empty shell, technical docs mentioning `"metadata only"`), permission separation, live headless Chrome tab summary/PDF detection, both `northbridge-summarize-mcp` & `northbridge-scopus-mcp` stdio servers, structured `tables`/`links`/Shadow DOM/iframe `inaccessibleSections` (Test 8), and 4-widget interactive `--reveal` verification with 0 screenshots and zero `eval`/`fill` (Test 9). |
| `.vscode/mcp.json` | **Updated** | Configures `northbridge-browser`, `northbridge-scopus`, and `northbridge-summarize` (`NORTHBRIDGE_APPROVED_DOMAINS=""`); omits `northbridge-browser-research`. |
| `.gitignore` | **Updated** | Ignores `pilot-exports/` and `.agent-browser-runtime/` so real exports and browser runtime state stay out of Git. |
| `package.json` | **Updated** | Adds `northbridge-scopus-mcp`, `northbridge-summarize`, `northbridge-summarize-mcp` bins and `test:summary` script (`agent-browser: 0.41.2` remains sole dependency; zero Playwright/PDF deps added). |
| `exports/Ch3_34_SC_D3.csv` | **Created** | Fixture verification export for Block D3 (4 records + header, 4,258 bytes). |
| `exports/Ch3_34_SC_D3_missed.csv` | **Created** | Fixture verification export for missed-control test case (2 records + header, 2,261 bytes). |
| `bin/northbridge-research.js` | **Maintained** | Session-isolated, read-only public research MCP server reused by `summarizePublicUrl`. |
| `test-research-policy.mjs` | **Maintained** | 9-check automated regression suite covering session isolation and connection-time gap. |
| `README.md` / `HANDOFF.md` | **Updated** | Document **Windows Quick Start for Tomorrow**, 6-step read/navigate/verify UX, `agent-browser: 0.41.2` schema inventory (`29` core / `64` all MCP tools), permission & dedicated-profile boundaries, **28/28** Scopus + **11/11** summary suites, Nov 10 live public + Antigravity fresh-chat tests (`e32f48a4`), honest verification separation, and Milestone 3 benchmark. |
| `portal.html` / `server.mjs` / `package-lock.json` | **Unchanged** | Shipped admissions portal, loopback server, and lockfile preserved untouched. |

---

## 3. Scopus Paper Search & CSV Export Workflow (Fixture Verified)

### Workflow Specification: Block D3
- **BLOCK**: `D3`
- **CLAIM**: `Weights can be derived from a rank order.`
- **QUERY**: `TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )`
- **CONTROL**: `Decision quality using ranked attribute weights`
- **EXPORT FILE**: `Ch3_34_SC_D3.csv`
- **DEDICATED OUTPUT FOLDER**: `./exports`

### 5-Step Execution Trace via Browser Tools

1. **Step 1 · Navigation & Exact Query Execution**:
   - `agent_browser_open` -> Opened `http://127.0.0.1:4318/`.
   - `agent_browser_snapshot` -> Located navigation link/tab `Advanced document search` (`@ref`).
   - `agent_browser_click` -> Navigated to Advanced Search.
   - `agent_browser_snapshot` -> Located query input `textbox "Enter query string:"` and search button `button "Search"`.
   - `agent_browser_fill` -> Entered query exactly as supplied without filters or sort changes: `TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )`.
   - `agent_browser_click` -> Executed search.
   - `agent_browser_snapshot` -> Observed results header: `4 document results`, date of search `6 Nov 2026`, and executed query string.
2. **Step 2 · Preprints Isolation**:
   - `agent_browser_snapshot` -> Observed preprints tab `button "Preprints (1)"`.
   - Recorded `totalPreprints = 1`. Preprints are kept strictly separate from the main count (`4`) and excluded from the CSV export.
3. **Step 3 · Control Paper Verification**:
   - In results view, located `textbox "Search within results (e.g. control title)..."` and `button "Search within"`.
   - `agent_browser_fill` -> Entered exact control title: `"Decision quality using ranked attribute weights"`.
   - `agent_browser_click` -> Filtered results.
   - `agent_browser_snapshot` -> Heading confirmed `1 document results` and observed title matching control paper.
   - Status marked: `FOUND in block` and `INDEXED`.
4. **Step 4 · Fresh Download, Non-Destructive Collision Placement, & Disk Verification**:
   - Navigated back to full block results (4 documents).
   - `agent_browser_click` on `button "Export"`.
   - `agent_browser_snapshot` of Export dialog modal -> Verified format `CSV (Excel)`, checkbox `Citation information` (checked), checkbox `Abstract & keywords` (checked).
   - Filled target filename: `Ch3_34_SC_D3.csv`.
   - `agent_browser_click` on `button "Confirm Export"`.
   - **Strict Attempt Download Capture**: Identifies fresh download strictly by attempt-specific filename (`${baseName}.attempt-${attemptId}.csv`) or exact attempt ID. Loose prefix matching (`file.startsWith('scopus')`) is eliminated.
   - **Pre-Placement CSV Validation**: Parses CSV using RFC 4180 state machine. Verifies required columns (`Authors`, `Title`, `Year`, `Source title`, `DOI`, `Abstract`, `Author Keywords`) and verifies document row count matches observed results count (4 records + header) *before* touching `exports/`.
   - **Atomic Non-Destructive Collision Placement**: If the target filename already exists in `exports/`, Northbridge never overwrites it. Using `fs.copyFileSync(..., fs.constants.COPYFILE_EXCL)`, it places the verified file under an incremental unique candidate filename (`${base} (${counter})${ext}`). Existing files are preserved byte-for-byte, and both the actual placed path and confirmation of preservation are reported in the search log and last line.
5. **Step 5 · Reproducible Search Log**:
   - Clean session teardown (`agent_browser_close`).
   - Formatted and returned reproducible search log.

### Observed Search Execution Log (Block D3)

```text
SEARCH ROWS
SITE | BLOCK | ROW TYPE | STRING AS EXECUTED | FILTERS | TOTAL | DATE | FILE | MESSAGES
Scopus | D3 | MAIN | TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" ) | None | 4 | 2026-11-06 | exports/Ch3_34_SC_D3.csv | None
Scopus | D3 | PREPRINTS | TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" ) | None | 1 | 2026-11-06 | None | Excluded from main count and export

CONTROL ROWS
SITE | BLOCK | TITLE | FOUND / NOT FOUND / UNCLEAR | INDEXED / NOT INDEXED / UNCLEAR
Scopus | D3 | Decision quality using ranked attribute weights | FOUND | INDEXED

LAST LINE
OK: 4 main records exported to exports/Ch3_34_SC_D3.csv; control paper confirmed in block; 1 preprint excluded.
```

### Generated CSV Verification & Record Counts

| Metric | Expected | Actual Observed | Status |
|---|:---:|:---:|---|
| **Total Main Document Records** | 4 | 4 | **MATCH** |
| **Total Preprints** | 1 (isolated) | 1 (isolated) | **MATCH** |
| **CSV File Path** | `exports/Ch3_34_SC_D3.csv` | `exports/Ch3_34_SC_D3.csv` | **VERIFIED ON DISK** |
| **CSV File Size** | ~4.2 KB | 4,258 bytes | **VERIFIED** |
| **CSV Total Lines** | 5 lines (1 header + 4 records) | 5 lines | **MATCH** |
| **Control Paper Present in CSV** | Yes (Butler et al., 1997) | Present on Line 2 | **CONFIRMED** |
| **Citation Information Fields** | Authors, Title, Year, Source, Vol, Issue, Pages, DOI | Present | **CONFIRMED** |
| **Abstract & Keywords Fields** | Abstract, Author Keywords, Index Keywords | Present | **CONFIRMED** |

### Institutional & Environmental Compatibility Matrix

| Route / Account Type | Status | Supported Behaviors & Fallbacks |
|---|:---:|---|
| **Local Fixture** (`scopus-fixture.mjs`) | **Verified** | 100% automated regression pass (**28/28** checks). Fresh browser download verified, multiline abstracts parsed via RFC 4180, path traversal blocked, exact query comparison verified, search-within filter clearing proven, live-like `1–20` repeatable export + MCP tool verified, dedicated-profile guard (`DEDICATED_PROFILE_REQUIRED`) verified, and `targetId`-scoped CDP download attribution rejecting decoy competing-tab CSVs proven. |
| **External Chrome Attachment** (CDP Port 9222 / 9223 / Dynamic Auto-Connect) | **Verified** | Tested on external Chrome with isolated dedicated profile, harmless local page (`/scopus/harmless`), and live-like results fixture (`/scopus/results-live-like?count=25`). Enforces loopback endpoints (`validateCdpEndpoint`), pre-flight HTTP probe, strict unique tab matching, dedicated-profile guard for `Browser.setDownloadBehavior`, `targetId`-scoped CDP download attribution, and leaves unrelated tabs untouched. |
| **Riga Technical University (RTU)** | **Needs Approved Live Test / Skipped** | Live 1–20 pilot skipped during owner Wi-Fi testing without institutional access. Full integration protocol, auto-connect/CDP attach, dedicated `--profile-dir` guard, and `export` subcommand ready via EZproxy/ORTUS (`*.scopus.com`, `*.rtu.lv`) with zero credential exposure. |
| **Other Institutions** (e.g. UL, Tartu, Consortium) | **Needs Approved Live Test (Simulated)** | Verified via simulated institutional proxy route (`/scopus/other-institution`). Pauses for institutional login and MFA. Checks and clearly reports if institutional subscription lacks Advanced Search or Export permissions. **Individually unverified until tested live**. |
| **Direct Personal Account** | **Needs Approved Live Test (Simulated)** | Verified via direct login route (`/scopus/direct`). Pauses for user credentials. **Individually unverified until tested live**. |

### Automated Edge Case & Regression Suite (`test-scopus-acceptance.mjs`)

The automated suite executes all **28** required regression checks (`npm.cmd run test:scopus`):

| Test Case | Scenario / Condition | Observed Result | Status |
|---|---|---|:---:|
| **1. Valid Block D3 Execution** | Real block query executed against fixture; downloads CSV to user `Downloads`, moves to `exports/Ch3_34_SC_D3.csv`, parses 4 records + header. | Fresh download captured, control confirmed in block, preprints (1) isolated, CSV columns verified. | **PASS** |
| **2. Failed Export Preservation** | Disposable file placed in `Downloads` and `exports/`; export simulated as failing. | Existing files in Downloads and exports folders preserved byte-for-byte; runner exits with bounded timeout error. | **PASS** |
| **3. Download Timeout (Bounded Wait)** | Download never arrives from browser within timeout limit. | Runner polls for bounded duration (1.5s in test) and exits with `EXPORT FAILED`. No unverified file written. | **PASS** |
| **4. Multiline Abstract Parsing** | Abstract in doc-1 contains 3 paragraphs separated by newlines, internal commas, and escaped quotes (`""`). | RFC 4180 state machine parses exactly 5 rows (1 header + 4 records) without phantom rows or split columns. Newlines and quotes preserved. | **PASS** |
| **5. Count Mismatch Detection** | Database results page shows 4 documents, but downloaded CSV only contains 2 records (`mismatch=1`). | Runner parses CSV, compares row count, flags `EXPORT INCOMPLETE: Expected 4 records, but file contains 2`. | **PASS** |
| **6. Path Traversal Protection** | Export filename supplied as `../outside.csv`. | Runner rejects filename with `REJECTED: Target export filename '../outside.csv' rejected`. Fixture endpoint returns HTTP 400 Bad Request. No outside file written. | **PASS** |
| **7. Rejected Query (Syntax Error)** | Query contains unbalanced parenthesis `TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*"`. | Database error alert captured, marked `NOT EXECUTED: Syntax error in query`, halts before export. | **PASS** |
| **8. Rewritten Query Detection** | Database silently appends `AND (LIMIT-TO (DOCTYPE, "ar"))` to query box. | Observed query compared with submitted query; mismatch detected; marked `NOT EXECUTED: Database rewrote query to '...'`. Halts before export. | **PASS** |
| **9. Missing Query Display** | Results page lacks `#query-executed` element (`missing_query=1`). | Runner detects missing query box; marks `UNCLEAR: Query display missing entirely from database results page`. Halts before export. | **PASS** |
| **10. Search-Within Filter Clearing** | Control search filters results down to 1 document; runner clears filter before export. | Search-within filter cleared; document count restored to 4; exported CSV verified to contain all 4 records. | **PASS** |
| **11. Control Missed but Indexed** | Query `TITLE-ABS-KEY ( "surrogate weight*" )` yields 2 results excluding control. | Search within yields `NOT FOUND`. Title search yields 1 result. Marked `NOT FOUND / INDEXED`. Last line reports `DEVIATION`. | **PASS** |
| **12a. Unique Tab Selection** | User approves/selects existing Scopus tab (`tab: 'Scopus'`). | Runner locates tab in running session, switches to it, verifies Scopus interface, executes search block, leaves unrelated tabs open. | **PASS** |
| **12b. Missing Tab Selection Halts** | Nonexistent tab pattern requested. | Runner halts immediately with `TAB ERROR: Tab not found matching pattern...`; opens no fallback tab. | **PASS** |
| **12c. Ambiguous Tab Selection Halts** | Ambiguous tab pattern matching multiple open tabs. | Runner halts immediately with `TAB ERROR: Ambiguous tab selection: Found 2 tabs... Unique match required`. | **PASS** |
| **13. Institutional Sign-In Pause** | User provides link (`/scopus/login-required`). | Runner opens URL, detects auth gate, pauses with `PAUSED: Workflow paused. User must complete institutional sign-in at ...`. | **PASS** |
| **14. Bot Challenge Detection** | Route returns unusual traffic / bot challenge (`/scopus/bot-challenge`). | Runner identifies bot challenge, halts cleanly with `STOPPED: Bot challenge encountered`. No bypass attempted. | **PASS** |
| **15. Download Cleanup** | Verifies attempt temporary files in `Downloads`. | Attempt downloads cleanly unlinked; no orphan attempt files left behind. | **PASS** |
| **16. Disk Persistence** | Verifies baseline export files on disk. | Baseline Block D3 CSV export verified preserved on disk. | **PASS** |
| **17. Collision File Preservation (Byte-for-Byte)** | Pre-existing disposable file placed at requested export path; successful export executed with same name. | Existing file preserved byte-for-byte; new export verified and atomically saved as `(1).csv`; report and last line cite unique path. | **PASS** |
| **18. External Chrome Attachment (Harmless Page)** | External Chrome started on loopback port 9223 with isolated profile and tabs (`/scopus/harmless`, `/scopus/unrelated`). | Attaches via CDP, validates harmless page, leaves unrelated tab and external Chrome process open and untouched. | **PASS** |
| **19. Unavailable & Non-Loopback CDP Rejection** | Tested against unavailable port (9999) and non-loopback host (`192.168.1.5:9222`). | Both rejected upfront with `ATTACHMENT ERROR` via pre-flight HTTP probe; no unrequested replacement browsers launched. | **PASS** |
| **20. Missing/Ambiguous Tabs on External Chrome** | External Chrome tested with nonexistent tab and duplicate tab patterns. | Halts cleanly with `TAB ERROR` without navigating or disrupting other open tabs. | **PASS** |
| **21. Engine Rejection of `--cdp` with `--allowed-domains`** | Engine launched with both `AGENT_BROWSER_CDP` and `AGENT_BROWSER_ALLOWED_DOMAINS`. | Pinned engine hard rejection reproduced: `--allowed-domains is not supported with --cdp because WebRTC containment cannot be installed before existing page scripts run`. | **PASS** |
| **22. Standalone CLI against External Chrome** | Child process execution of `bin/northbridge-scopus.mjs` with `--cdp 9223 --tab harmless`. | Exits cleanly code `0`, exports 4 parsed records, preserves collisions byte-for-byte under `(1).csv`, leaves unrelated tab open, keeps Chrome running. | **PASS** |
| **23. Approval Gate, Tab Pinning (`--pin-tab`), & Profile Isolation** | Verified against running Chrome on port `9223` + isolated empty `profileDir`: 23a explicit denial halts upfront; 23b unapproved `autoConnect` halts with `APPROVAL ERROR`; 23c approved attaches and verifies `/scopus/harmless`; 23d bound tab close reports `tab_gone` without fallback; 23e CLI `--deny` exits `1`; 23f CLI `--approved --verify-attachment` exits `0` with `Status: OK`; 23g unrelated tab untouched; 23h explicit `profileDir` without `DevToolsActivePort` refuses fallback to system Chrome / `9222`. | **PASS** |
| **24. Multi-Attribute `@ref` Parsing & Ambiguous Download Rejection** | Snapshot lines containing `[expanded=false, ref=e330]` / `[checked=false, ref=e444]`; pending `.crdownload` vs. 2 ambiguous CSV files vs. 1 clean CSV in `identifyFreshDownload`. | `@e330`/`@e444`/`@e501` resolved accurately; `.crdownload` marked pending; >1 new CSV fails with `EXPORT AMBIGUOUS`. | **PASS** |
| **25. UTF-8 BOM CSV Header vs. Blank Cell Validation** | Valid CSV with UTF-8 BOM and individual blank `DOI`/`Author Keywords`/`Index Keywords` cells vs. CSV omitting `DOI` column header. | Valid blank-cell rows pass with accurate `blankCells` counts; missing `DOI` header fails with `missingColumns: ['DOI']`. | **PASS** |
| **26. Repeatable Export-Only Workflow (`1–20` of `25`) via `--auto-connect`** | `exportScopusResultsTab` and CLI `export` subcommand run via ephemeral `--remote-debugging-port=0` (`DevToolsActivePort`) on live-like Scopus results tab (`1–20`) with unchecked `Abstract & keywords`. | Unapproved halts (`APPROVAL_REQUIRED`); approved CLI & API discover dynamic port via `DevToolsActivePort`, export 20 verified CSV rows, enable `Abstract & keywords`, preserve collisions byte-for-byte as `(1).csv`, leave unrelated tab untouched. | **PASS** |
| **27. Query Mismatch & Missing Abstract Header Failure** | Results tab with mismatched `--expected-query` and fixture missing `Abstract` CSV column (`omit_cols=abstract`). | Mismatched query halts with `QUERY_MISMATCH`; CSV omitting `Abstract` fails `CSV_VALIDATION_FAILED` before file placement. | **PASS** |
| **28. Dedicated-Profile Guard & `targetId`-Scoped CDP Attribution** | 28a shared default Chrome User Data profile, bare `--cdp`, and missing `targetId`; 28b competing unrelated tab emits valid 20-row decoy CSV while approved tab drops download; 28c competing tab completes decoy CSV 450ms before approved tab real 20-row CSV. | 28a halts upfront (`DEDICATED_PROFILE_REQUIRED` / `TARGET_ID_REQUIRED`); 28b ignores decoy (`ignoredOtherTabCount=1`) and fails `DOWNLOAD_FAILED` without placing decoy; 28c saves exclusively approved Scopus tab CSV while ignoring competing download. | **PASS** |

---

## 4. Live Handoff Architecture & Live Pilot Protocol

### Objective & Constraints
Live execution against Scopus via user-selected institutional access (e.g. Riga Technical University ORTUS / EZproxy, other institutions, or direct personal subscription) requires:
- Explicit, user-initiated authentication
- Protecting user credentials, MFA codes, and session tokens from AI prompts, logs, and exports
- Strict endpoint and process isolation, avoiding both the known private-network gap in the public research server and accidental replacement browser launches

### Transport Layer Separation & Allowlist Boundary

The pinned engine (`agent-browser: 0.41.2`) enforces a hard rejection if `--allowed-domains` is combined with `--cdp`:
```text
--allowed-domains is not supported with --cdp because WebRTC containment cannot be installed before existing page scripts run
```
Because of this engine limitation, `scopus-workflow.mjs` cleanly separates the two modes at the transport layer:
1. **Local Fixtures and Scripted Demos**: When `--cdp` is not passed, `AGENT_BROWSER_ALLOWED_DOMAINS` is set to `127.0.0.1`, enforcing engine-level request allowlisting.
2. **External Chrome Attachment (`--cdp` / `--attach-chrome`)**: When attaching to an externally launched Chrome instance, `AGENT_BROWSER_ALLOWED_DOMAINS` is removed so the engine attaches cleanly.
3. **Containment Enforcement under CDP**: Because engine-level domain allowlisting is disabled under CDP attachment, attachment containment is strictly enforced through:
   - **Pre-flight loopback validation (`validateCdpEndpoint`)**: Rejects non-loopback hosts and verifies port availability via `/json/version`, preventing silent browser launches.
   - **Strict unique tab matching**: Requires `--tab` and halts with `TAB ERROR` if the tab is missing or ambiguous, leaving unrelated tabs completely untouched.
   - **In-workflow URL checks**: Halts if unexpected external navigations occur.
   - **Boundary Disclosure**: Chrome attachment **cannot** be represented as equivalent to engine-level domain allowlisting.

### Protocol Design: Explicit User-Initiated Connection

```
[User on Windows]
   │
   ├─► 1. Launches Chrome with remote debugging port & dedicated profile:
   │      & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"
   │
   ├─► 2. Navigates manually to User-Selected Scopus Route:
   │      - Option A (RTU): https://ortus.rtu.lv -> Library -> Scopus (or https://www-scopus-com.ezproxy.rtu.lv)
   │      - Option B (Other Institution): Institutional library portal / proxy
   │      - Option C (Direct Account): https://www.scopus.com
   │
   ├─► 3. Enters institutional credentials and completes multi-factor authentication (MFA)
   │      (Agent is NOT active; credentials never enter logs, prompts, or tools)
   │
   ├─► 4. User confirms Scopus search home page has loaded in browser:
   │      "Scopus is loaded and signed in. Proceed."
   │
[Northbridge Scopus Runner]
   │
   ├─► 5. Validates loopback endpoint (127.0.0.1:9222) via pre-flight HTTP probe (/json/version)
   │      Attaches to user's existing authenticated browser context via CDP
   │      Locates and switches uniquely to the approved Scopus tab
   │      Leaves all unrelated tabs and the browser process open and untouched
   │      - Enters query exactly as supplied
   │      - Records displayed query, total count, preprints, and date
   │      - Searches within results for control paper
   │      - Initiates native CSV export (Citation info + Abstract & keywords)
   │
   ├─► 6. Pause Condition: Elsevier Personal Sign-In at Export
   │      If Scopus presents an Elsevier account sign-in dialog at export:
   │      - Automation pauses immediately
   │      - Informs user in chat: "PAUSED: Elsevier sign-in required for export. Please complete in browser."
   │      - Resumes once user signs in or dismisses dialog
   │
   ├─► 7. Stop Condition: Bot Challenge / Unusual Traffic Warning
   │      If Scopus presents Cloudflare Turnstile, PerimeterX, or unusual traffic warning:
   │      - Automation halts immediately
   │      - Reports completed findings and stops without attempting bypasses
   │
   └─► 8. Verifies downloaded CSV on disk, places atomically (preserving existing files on collision byte-for-byte), and emits reproducible search log.
```

### What Remains for the Live Pilot
1. **Owner Presence**: The live pilot requires the project owner to be present to log into their institutional portal (such as RTU ORTUS) or direct Scopus account with active credentials and complete MFA.
2. **Individual Unverified Status**: RTU, other institutions, and direct personal accounts remain individually unverified until tested live with the owner.
3. **Single Pilot Block**: The initial live pilot tests one native Scopus CSV export with 1 query and 1 control paper. Alternative export formats (e.g. RIS, BibTeX, or DOM scraping) are separate features requiring separate completeness checks.
4. **Downstream Thesis Steps**: Screening, deduplication, DOI cross-referencing, and PDF full-text retrieval remain strictly in the main thesis chat outside this browser automation milestone.

### Exact Owner Steps & Chat Prompt for Live Pilot

Choose either Option 1 (Use My Open Scopus Tab) or Option 2 (Dedicated Profile Fallback):

#### Option 1: Use My Open Dedicated-Profile Scopus Tab (Preferred · `--auto-connect`)

1. **Sign in to Scopus**: Launch Chrome with a dedicated profile directory (`--user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"` — required by Scopus CSV `export` so browser-wide `Browser.setDownloadBehavior` never alters your primary Chrome profile). Navigate to Scopus through your institutional portal (e.g. RTU ORTUS `https://ortus.rtu.lv` -> Library -> Scopus or `https://www-scopus-com.ezproxy.rtu.lv`), library proxy, or direct account (`https://www.scopus.com`). Complete your institutional sign-in and MFA in the browser. Leave the Scopus tab open.
2. **Pre-flight Verify Attachment (Optional)**:
   ```powershell
   node bin/northbridge-scopus.mjs --auto-connect --approved --profile-dir "$env:LOCALAPPDATA\Google\Chrome\ScopusProfile" --verify-attachment --tab "Scopus"
   ```
   Northbridge discovers the active Chrome endpoint dynamically from `DevToolsActivePort` (without probing port 9222 first), confirms explicit approval, verifies the exact Scopus tab, and confirms connection readiness.
   *(Note: Read-only page summary via `northbridge-summarize` does not mutate download settings and can also attach cleanly to any approved open Chrome tab.)*
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

##### Step 1: Launch Chrome with Remote Debugging & Dedicated Profile
In PowerShell, launch Google Chrome with remote debugging and a dedicated user data directory derived from your Windows environment:
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"
```
*Note*: Modern Chrome requires a dedicated `--user-data-dir` for remote debugging. This isolates the debugging session from your primary Chrome profile, keeping your daily browser, existing tabs, and extensions completely untouched without needing to close your personal browser.

##### Step 2: Confirm Connection Readiness
Before signing in, verify that Chrome is ready and the loopback debugging endpoint is operational. Run in PowerShell:
```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
```
Confirm that `Browser` reports a valid Chrome version (e.g. `"Chrome/..."`) and `webSocketDebuggerUrl` points to loopback (`127.0.0.1:9222`).

##### Step 3: Complete Sign-In (Institution-Neutral)
In the opened dedicated Chrome window:
1. Navigate to your institution's portal or direct Scopus login:
   - **Option A (Riga Technical University)**: Go to RTU ORTUS `https://ortus.rtu.lv` -> Library -> Scopus (or directly to `https://www-scopus-com.ezproxy.rtu.lv`).
   - **Option B (Other Academic / Research Institution)**: Go to your university or organizational library portal / EZproxy / SSO.
   - **Option C (Direct Personal / Corporate Account)**: Go directly to `https://www.scopus.com`.
2. Authenticate manually with your institutional credentials and complete any multi-factor authentication (MFA) prompts.
   - **Zero Credential Exposure**: Passwords, MFA codes, session tokens, and cookies remain exclusively inside your browser. Northbridge never requests, logs, or stores credentials.
3. Confirm that the main Scopus search home page (`https://www.scopus.com/search/form.uri?display=advanced` or basic search) is displayed in the tab.

##### Step 4: Trigger Live Search Block in Desktop Agent Chat
In your desktop agent chat (Antigravity, VS Code Copilot, Codex, etc.), paste the following copy-ready user prompt:

> "Scopus is open and I’m signed in on port 9222. Use Northbridge to run Scopus block D3:
> - Block: D3
> - Claim: Weights can be derived from a rank order.
> - Query: TITLE-ABS-KEY ( \"rank order centroid\" OR \"surrogate weight*\" OR \"ranked attribute weight*\" OR \"rank-based weight*\" )
> - Control: Decision quality using ranked attribute weights
> - Export: Ch3_34_SC_D3.csv
>
> Run the query exactly as supplied, check the control paper, export the main results as CSV, and return the reproducible search log. Pause if you need me to sign in again or re-authenticate."

Northbridge attaches to your authenticated browser session via CDP (port 9222), verifies the selected tab, executes the search without query modification, isolates preprints, verifies control paper indexing, validates the CSV export on disk before placement (preserving existing files on collision byte-for-byte), and outputs the structured search log.

##### Step 5: Disconnection & Teardown
Once the search block is complete and the verified CSV is saved:
1. Northbridge automatically closes its CDP client connection when the command finishes.
2. Close the dedicated Chrome window manually, or terminate it from PowerShell:
   ```powershell
   Get-Process chrome | Where-Object { $_.CommandLine -like "*ScopusProfile*" } | Stop-Process
   ```

---

## 5. Section A: Network Boundary & Enforcement Result (Approved Hostname Analysis)

### Controlled Fixture Request Counts (Port 4399)

| Subtest | Scenario / Action | Tool Tested | Configured / Approved Domains | Expected Private Behavior | Actual Requests to Private Server | Enforcement Layer & Observed Result |
|---|---|---|---|---|:---:|---|
| **6a** | Direct navigation to approved hostname pointing to loopback (`http://sub.localtest.me:4399/target`) | `agent_browser_open` | `sub.localtest.me` | Block connection to private address | **0** | **PASS**: Pre-flight DNS check in `northbridge-research.js` resolves `127.0.0.1` and halts with `[SECURITY POLICY VIOLATION]` before browser launch. |
| **6b** | Direct read fetch to approved hostname pointing to loopback (`http://sub.localtest.me:4399/target`) | `agent_browser_read` | `sub.localtest.me` | Block connection to private address | **0** | **PASS**: Pre-flight DNS check identifies loopback IP and aborts before fetch. |
| **6c** | HTTP 302 Redirect to unapproved private destination (`http://127.0.0.1:4399/leak-via-redirect`) | `agent_browser_open` | `example.com` | Block redirect destination | **0** | **PASS**: Engine CDP `Fetch.enable` allowlist inspects destination URL `127.0.0.1:4399` and halts request before transmission. |
| **6d** | Page-initiated subresources (`fetch`, `img`) to unapproved private destination (`http://127.0.0.1:4399/private-data`) | `agent_browser_open` | `example.com` | Block subresources | **0** | **PASS**: Engine CDP `Fetch.enable` allowlist halts requests before transmission. |
| **6e** | Connection-Time Gap: Approved hostname pointing to loopback during redirect (`example.com` -> `sub.localtest.me:4399`) | `agent_browser_open` | `example.com, sub.localtest.me` | Prevent private connection at socket time | **2** | **FAIL / GAP**: Engine CDP `Fetch.requestPaused` matches hostname `sub.localtest.me`, issues `Fetch.continueRequest`, and Chrome connects to `127.0.0.1:4399` (hits: GET `/leak-via-redirect`, GET `/favicon.ico`). |
| **8** | Legitimate approved public site navigation (`https://example.com/`) | `agent_browser_open`, `agent_browser_snapshot` | `example.com` | Allow public page, verify snapshot | **0** | **PASS**: Public page opens cleanly; text snapshot verified (28 chars); 0 hits on private fixture. |

### Smallest Reproducible Case for Connection-Time Gap
When `NORTHBRIDGE_APPROVED_DOMAINS="example.com,sub.localtest.me"` is supplied to `agent-browser: 0.41.2`, the engine configures CDP `Fetch.enable` with patterns `*://example.com/*` and `*://sub.localtest.me/*`. When a page redirects to `http://sub.localtest.me:4399/...`, the engine's `Fetch.requestPaused` handler only checks if `url.hostname` matches an approved pattern. Because `sub.localtest.me` is approved, the engine calls `Fetch.continueRequest`. Chrome resolves `sub.localtest.me` to `127.0.0.1` at socket connection time and connects, recording 2 hits on the private server. An internal forward proxy workaround cannot be used because it triggers TLS/SNI reset errors (`read ECONNRESET`, `10060`) on modern production CDNs. Public research is therefore **Blocked**.

---

## 6. Read-Only Page Summary, 6-Step Read/Navigate/Verify UX, & Benchmark

### Plain-Language MCP, Dedicated-Profile Fix, & 6-Step Workflow
- **`northbridge-scopus` (`bin/northbridge-scopus-mcp.mjs`) · Fix #1 (`28/28`)**: Exposes `northbridge_export_scopus_results` so plain-language requests like `"Use Northbridge to export the first 20 Scopus results"` run cleanly with `approved: true`, unique tab matching, `--pin-tab`, dedicated-profile enforcement (`inspectChromeProfileSafety` refusing shared default Chrome User Data and bare `--cdp` with `DEDICATED_PROFILE_REQUIRED` before calling `Browser.setDownloadBehavior`), `targetId`-scoped CDP download attribution rejecting decoy competing-tab CSVs (`TARGET_ID_REQUIRED` / Test 28), pre-placement header vs. blank-cell validation, and gitignored output into `pilot-exports/`.
- **`northbridge-summarize` (`bin/northbridge-summarize-mcp.mjs`) · Fix #2 (`11/11`)**: Implements the 6-step **Discover -> Orient -> Read -> Reveal -> Verify -> Compact Output** workflow behind `northbridge_summarize_page`:
  1. **Discover** *(outside the verifier)*: Client uses its built-in search tool (`search_web`) or asks for one starting URL; discovery stays strictly separate from verified page reading.
  2. **Orient**: Extracts title, redacted URL (`sanitizeUrl`), full headings outline, compact interactive controls (`tabs`, `accordions`, `pagination`, `load-more`), and `inaccessibleSections` (canvas/`application` widgets or `<iframe>` controls where `agent_browser_frame` is CLI-only).
  3. **Read**: Extracts focused paginated prose (`--section`, `--section-index`, `--max-chars`, `--offset`), structured `tables` bounded by `--max-table-rows`, redacted `links`, and automatic Shadow DOM / accessible iframe snapshot fallback (`usedFallback`) across 8 explicit statuses (`normal`, `partial-body`, `abstract-only`, `metadata-only`, `outline-only`, `blocked`, `pdf-readable`, `pdf-unreadable`). Technical/software docs mentioning `"metadata only"` no longer misclassify, and filtered single-section reads report `partial-body` with `fullTextAvailable: false`.
  4. **Reveal** *(`--reveal` / `reveal`)*: Safely activates non-utility tabs, `<details>`/`[aria-expanded=false]` accordions (skipping utility controls like `Skip To Content` or `Open ... menu`), `Next` pagination, or async `Load more` (scrolling off-viewport targets once via `scroll` if needed; skipping `insideIframe` controls cleanly mentioning `agent_browser_frame`) with zero `eval`/`fill` mutations and zero screenshots by default. Test 9 verified all 4 widgets absent before click and revealed afterward (`5,869 ms` `browserActionMs`, `obsBytes: 11,797`, `0` screenshots).
  5. **Verify**: Confirms DOM changes via `verifiedChanged` and reports UTF-8 observation bytes (`obsBytes`) separately from runtime token counts (`modelTokens: null`).
  6. **Compact Output**: Returns bounded output inside `[UNTRUSTED EXTERNAL DATA - BEGIN/END]` with `nextSectionHint`, `omittedChars`, and `omittedRows`. Mutually exclusive modes prevent mixing public `url` (bounded by server-only `NORTHBRIDGE_APPROVED_DOMAINS` via `bin/northbridge-research.js`) with approved Chrome `tab` (`approved: true`, strictly read-only).

### Agent Browser (`0.41.2`) Tool Schema & CLI Inventory
Verified directly against `node bin/northbridge-browser.js mcp` (`tools/list`):
- **`--tools core`**: **29 tools** (includes `agent_browser_open`, `agent_browser_snapshot`, `agent_browser_read`, `agent_browser_click`, `agent_browser_scroll`, `agent_browser_get_title`, `agent_browser_get_url`, `agent_browser_get_text`, `agent_browser_tab_*`, `agent_browser_close`, etc.).
- **`--tools all`**: **64 tools** *(README corrected from earlier `156` figure)*.
- **CLI-only actions**: `agent_browser_frame` and `scrollintoview` are absent from MCP both in `core` and `all`; `page-summary.mjs` therefore surfaces blocked iframe controls explicitly via `inaccessibleSections` while using in-MCP `agent_browser_scroll` when revealing off-viewport targets.

### Fresh Plain-Language Antigravity Chat Test (`e32f48a4`)
Ran a standalone Antigravity subagent test (`e32f48a4-caea-4edb-977c-2571a3e0c5c0`) using only plain-language instructions against unmodified global `~/.gemini/config/mcp_config.json` (`agent-browser` locked to `AGENT_BROWSER_ALLOWED_DOMAINS="127.0.0.1"`):
- **Worked in real chat**: `search_web` Discovery located Prof. Shimon Whiteson (Oxford CS) and QMIX (`arXiv:2003.08839` / JMLR `20-081`).
- **Clean boundary enforcement**: External browser verification via `agent-browser` and `northbridge-summarize` refused bypasses, left configs/files untouched, and halted cleanly on `Domain '...' is not in the allowed domains list` and `[APPROVAL REQUIRED]`.
- **Client setup note**: `.vscode/mcp.json` pre-configures `northbridge-browser`, `northbridge-scopus`, and `northbridge-summarize`; Antigravity requires adding those server blocks explicitly to `~/.gemini/config/mcp_config.json` (documented in `README.md`).

### Codex Follow-Up Check (November 10, 2026)

- `npm.cmd run test:summary` passed 11/11. The duplicate-label fixture places the second matching tab beyond the control list shown to the model. Reveal checks every observed control and records zero clicks for the ambiguous request.
- A temporary noninteractive Codex CLI run discovered and selected `northbridge_summarize_page` but stopped at `MCP tool call requires approval, but approval policy is never`.
- The owner then completed an interactive Codex CLI read of two already-open Chrome tabs with expansion off and zero screenshots. Northbridge reported the role and leaving date on the [Oxford profile](https://www.cs.ox.ac.uk/people/shimon.whiteson/). Initial paper tab guesses failed. Matching the exact URL fragment `2003.08839` succeeded, and the response cited the [QMIX paper](https://arxiv.org/html/2003.08839) and grounded a result and a limitation in sections 9 and 4.1. This verifies approved-tab reading from chat. Discovery from a topic without starting URLs is still pending end-to-end verification.

### Live Public Validation & Authenticated Skip Status (Updated November 10, 2026)
Owner requested skipping authenticated IEEE Xplore / Scopus runs (regular Wi-Fi without institutional login access) and testing freely visible public pages instead:

- **Authenticated Institutional Status**: Live Scopus `1–20` CSV export & authenticated IEEE Xplore full text **Need Approved Live Browser Test / Skipped** on regular Wi-Fi. Previously verified approved read-only attachment to `https://ieeexplore.ieee.org/Xplore/home.jsp` (`3,649 ms`, portal homepage).
- **Nov 10 Live Public Verification Runs (`page-summary.mjs`, `0` screenshots, `0` retries except timeout check, `modelTokens: null`)**:
  - **University Profile (`https://www.cs.ox.ac.uk/people/shimon.whiteson/`)**: Unfiltered -> `normal` (`fullTextAvailable: true`, `8` headings, `62` links, `7,740 ms` wall / `7,567 ms` action, `6` calls, `obsBytes: 17,958`); `--section "Selected Publications"` -> `partial-body` (`fullTextAvailable: false`, `usedFilteredRead: true`, `8,553 ms` wall, `obsBytes: 16,061`). *(Note: `https://nlp.stanford.edu/~manning/` timed out cleanly with `FETCH_ERROR` `ERR_CONNECTION_TIMED_OUT` after `25,295 ms`.)*
  - **Public Technical Docs**:
    - `https://agent-browser.dev/commands` (`NORTHBRIDGE_APPROVED_DOMAINS=""` halts `[APPROVAL REQUIRED]`; with domain allowlisted: `--section "snapshot"` -> `partial-body`, `5,857 ms`, `obsBytes: 174,658`; unfiltered -> `normal`, `66` headings, `1` table, `168` links, `5,798 ms`, `obsBytes: 135,111`).
    - `https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/` (`--reveal`): `normal` (`4,956 ms` wall / `4,800 ms` action, `10` calls, `0` retries, `obsBytes: 17,975`; utility `Skip To Content` toggle safely skipped).
  - **Live Open-Access Full Articles (`normal`)**:
    - `https://arxiv.org/html/2311.10090v1` (*JaxMARL*): `--section "Abstract"` -> `partial-body` (`6,785 ms`, `9` tables parsed, `obsBytes: 162,860`); unfiltered -> `normal` (`usedFallback: true` `snapshot-tree`, `53` headings, `7,252 ms`, `obsBytes: 195,706`).
    - Prior verified public runs (`normal`, `fullTextAvailable: true`): `https://arxiv.org/html/2510.10666` (*BrowserAgent*), `https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0317084` (`mergen`), `https://pmc.ncbi.nlm.nih.gov/articles/PMC11405275/` (clinical LLM limitations).
  - **Live Abstract-Only & Paywall Previews (`abstract-only`, `fullTextAvailable: false`)**:
    - `https://arxiv.org/abs/2311.10090` (`5,404 ms` wall / `5,262 ms` action, `7` calls, `0` retries, `obsBytes: 24,096`).
    - Prior verified runs: `https://arxiv.org/abs/2510.10666` (`4,039 ms`), `https://www.nature.com/articles/s42254-023-00581-4` (`6,571 ms`), `https://pubmed.ncbi.nlm.nih.gov/38961264/` (`4,428 ms`, multiline `##\nAbstract` normalized).
  - **Live WAF / Unauthenticated Shells (`blocked`, `fullTextAvailable: false`, zero bypasses)**:
    - `https://www.mdpi.com/2076-3417/14/5/2074` (Akamai `Access Denied`, `3,897 ms`, `6` calls, `0` retries, `obsBytes: 661`).
    - `https://ieeexplore.ieee.org/document/11364183/` (empty SPA shell on public Wi-Fi, `97` obs bytes, `4,001 ms`).
  - **Live PDFs (`pdf-unreadable` vs. public URL CDP `Fetch.enable` limitation)**:
    - **Approved-tab Chrome mode**: `https://arxiv.org/pdf/2311.10090` (`3,942 ms` wall / `3,902 ms` action, `9` calls, `0` retries, `obsBytes: 259`), `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf` (`10,025 ms`), and `https://arxiv.org/pdf/2510.10666` (`4,475 ms`) all accurately classified `isPdf: true`, `pdfTextReadable: false`, `contentStatus: "pdf-unreadable"`, `fullTextAvailable: false` with zero added PDF dependencies.
    - **Public-research URL mode** (`--url`) on `.pdf` links hits Chrome's internal `chrome-extension://` PDFium viewer frame under CDP `Fetch.enable` (`allowedDomains`) and exits `FETCH_ERROR` cleanly at `25 s` timeout, advising approved-tab mode or companion HTML/abstract.

### Milestone 3 Engine Benchmark (`Agent Browser` vs. `Playwright CDP` Prototype)

Executed $N = 3$ runs per engine exporting records `1–20` on `/scopus/results-live-like?count=25` from the same external Chrome instance (`unrelated` tab verified untouched across all runs; Playwright kept strictly in isolated brain scratch folder with **zero** additions to `package.json` or `package-lock.json`):

| Measure (N = 3 Average) | Agent Browser (`exportScopusResultsTab`) | Playwright CDP Prototype (`scratch/pw-proto`) |
|---|:---:|:---:|
| Completion Rate | `3 / 3` | `3 / 3` |
| Retries | `0` | `0` |
| `browserActionMs` | `6,755 ms` | `814 ms` |
| `totalWallMs` | `6,788 ms` | `937 ms` |
| Browser Operations / Run | `21` MCP tool calls | `8` direct ops |
| Normalized UTF-8 `obsBytes` (Proxy) | `10,520 bytes` (`10,518 chars`) | `200 bytes` (`200 chars`) |
| `modelTokens` | `null` *(not exposed by headless runner)* | `null` *(not exposed by headless runner)* |

**Decision**: Keep **Agent Browser** (`0.41.2`) as default for MCP uniformity, compact accessibility-tree exploration on arbitrary pages, and zero extra dependencies (Playwright also needed `{ exact: true }` strict locator disambiguation between `"Abstract"` and `"Abstract & keywords"`).

---

## 7. Full Regression Verification Commands

All 6 project suites passed on the final code (`README.md` / `HANDOFF.md` edits only thereafter):

```powershell
# 1. Scopus Search, Attachment, Dedicated-Profile Guard & Repeatable 1-20 CSV Export Suite (28/28 checks):
npm.cmd run test:scopus

# 2. Read-Only Page Summary, 8 Classifications, Shadow DOM/Iframe & 4-Widget Interactive Reveal Suite (11/11 checks):
npm.cmd run test:summary

# 3. Repeatable Export CLI on Open Approved Dedicated-Profile Scopus Tab (outputs to gitignored pilot-exports/):
node bin/northbridge-scopus.mjs export --auto-connect --approved --profile-dir "$env:LOCALAPPDATA\Google\Chrome\ScopusProfile" --tab "Scopus" --range 1-20

# 4. Read-Only Page Summary CLI (approved open Chrome tab, paginated; add --reveal to expand dynamic widgets):
node bin/northbridge-summarize.mjs --auto-connect --approved --tab "Docs" --max-chars 2200

# 5. Admissions Demo Suites (requires local portal server `npm.cmd start` on port 4317):
npm.cmd run test:lookup
npm.cmd run test:mcp
npm.cmd run test:cli

# 6. Research Access Policy & Isolation Suite (9/9 checks, reproduces connection-time IP gap):
npm.cmd run test:research
```

---

## 8. Stop Condition, Honest Verification Separation & Final Status

See [`README.md` (`## Windows Quick Start for Tomorrow`)](README.md#windows-quick-start-for-tomorrow) for 2-command installation (`npm.cmd ci`, `.\node_modules\.bin\agent-browser.cmd install`), copy-ready plain-language prompts, client configs, and per-client verification status.

### Honest Verification Separation
- **Worked in real chat**: Loopback admissions demo (`MSc Applied Data Science` deadline `21 May 2027` & draft flow in Antigravity / VS Code / Codex); fresh plain-language Antigravity subagent test (`e32f48a4`) using `search_web` Discovery and refusing bypasses under unmodified `~/.gemini/config/mcp_config.json`.
- **Passed in local scripted/fixture tests**: `test:scopus` (**28/28**), `test:summary` (**11/11**), `test:research` (**9/9**), `test:lookup`, `test:mcp`, `test:cli`; plus live unauthenticated public reads (`cs.ox.ac.uk`, `agent-browser.dev`, `w3.org`, `arxiv.org` HTML/abs/PDF, `plos.org`, `pmc`, `pubmed`, `nature.com`, `mdpi.com`).
- **Needs approved live browser test**: Authenticated **IEEE Xplore** full-text summary and live **Scopus RTU ORTUS/EZproxy** `1–20` CSV export (skipped on current public Wi-Fi without institutional login).

| Component | Release Status | Actionable Summary |
|---|---|---|
| **Local Demo Preview** (`northbridge-browser`) | **Ready for independent review** | Verified across MCP stdio (`test:lookup`, `test:mcp`) and PowerShell CLI (`test:cli`). Deterministic single-session preview; browser traces retained; token reduction remains hypothesis pending matched `@Chrome` benchmark. |
| **Scopus Search, Attachment & Repeatable Export** (`scopus-workflow.mjs` / `northbridge-scopus-mcp.mjs`) | **Fixture & Attachment Verified (28/28)** | Verified across 28 regression checks including repeatable `export` / `northbridge_export_scopus_results`, dedicated-profile guard (`DEDICATED_PROFILE_REQUIRED`), `targetId`-scoped CDP download attribution ignoring competing-tab decoy CSVs, multi-attribute `@ref` matching, BOM header vs. blank-cell validation, and atomic collision preservation (`COPYFILE_EXCL`). |
| **Read-Only Page Summary & 6-Step UX** (`page-summary.mjs` / `northbridge-summarize-mcp.mjs`) | **Verified (11/11 + Live Public Checks)** | Verified **Discover -> Orient -> Read -> Reveal -> Verify -> Compact Output**, 8 `contentStatus` values, 4-widget `--reveal` (`5,869 ms`, `0` screenshots), structured `tables` + redacted `links`, Shadow DOM/iframe fallback + `inaccessibleSections`, zero screenshots by default, and strict mode separation. |
| **Live Authenticated Scopus & IEEE Xplore** (`northbridge-scopus` / `northbridge-summarize`) | **Needs Approved Live Test / Skipped** | Skipped during owner Wi-Fi session without institutional login. Protocols and `--auto-connect --approved --tab` ready (with dedicated `--profile-dir` for Scopus export) once signed in via RTU ORTUS/EZproxy, other institutions, or direct account. |
| **Public Distribution** (`northbridge-browser-research` & VS Code 1-Click) | **Blocked / Pending** | `northbridge-browser-research` stays excluded from default `.vscode/mcp.json` due to upstream CDP connection-time IP gap. VS Code 1-click link marked pending npm publication. |

---

### Single Next Action for the Owner

When on institutional network/login access, open Chrome with a dedicated profile directory (`--user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"`) and sign in via your institutional route (e.g. RTU ORTUS -> Scopus or IEEE Xplore), then verify or run from chat using plain language:
- Pre-flight check: `node bin/northbridge-scopus.mjs --auto-connect --approved --profile-dir "$env:LOCALAPPDATA\Google\Chrome\ScopusProfile" --verify-attachment --tab "Scopus"`
- Plain-language chat prompts (no engine names, selectors, or `@ref`s required):
  - `"Use Northbridge to summarize this page"`
  - `"Use Northbridge to export the first 20 Scopus results"`
