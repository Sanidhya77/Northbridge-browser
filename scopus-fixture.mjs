import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Synthetic peer-reviewed documents in fixture
const SYNTHETIC_DOCUMENTS = [
  {
    id: 'doc-1',
    authors: 'Butler, J., Jia, J., Dyer, J.',
    title: 'Decision quality using ranked attribute weights',
    year: '1997',
    source: 'Management Science',
    volume: '43',
    issue: '9',
    pages: '1279-1289',
    citations: '184',
    doi: '10.1287/mnsc.43.9.1279',
    abstract: 'Examines the quality of decisions made using ranked attribute weights in multiattribute decision analysis. Compares rank order centroid (ROC) weights with other surrogate weighting methods across simulated multi-attribute decision contexts.',
    keywords: 'Decision analysis; Multiattribute utility; Ranked attribute weights; Rank order centroid; Surrogate weights; Weight elicitation',
    tags: ['rank order centroid', 'surrogate weight', 'ranked attribute weight', 'rank-based weight']
  },
  {
    id: 'doc-2',
    authors: 'Barron, F.H., Barrett, B.E.',
    title: 'Surrogate weights in multiattribute decision making',
    year: '1996',
    source: 'Acta Psychologica',
    volume: '93',
    issue: '1-3',
    pages: '122-136',
    citations: '320',
    doi: '10.1016/0001-6918(96)00024-X',
    abstract: 'Evaluates the decision quality of surrogate weights including rank order centroid (ROC), rank-sum (RS), and equal weights (EW) in multiattribute decision choice problems.',
    keywords: 'Surrogate weights; Multiattribute decision making; Rank order centroid; Attribute weights; Decision quality',
    tags: ['rank order centroid', 'surrogate weight']
  },
  {
    id: 'doc-3',
    authors: 'Roberts, R., Goodwin, P.',
    title: 'Evaluation of rank order centroid weights',
    year: '2002',
    source: 'Decision Support Systems',
    volume: '33',
    issue: '3',
    pages: '223-233',
    citations: '95',
    doi: '10.1016/S0167-9236(01)00155-8',
    abstract: 'Assesses the performance of rank order centroid (ROC) weights in multiattribute decision models when attribute rank orders are subject to assessment uncertainty or incomplete preference data.',
    keywords: 'Multi-attribute decision models; Rank order centroid; Weight approximation; Surrogate weights; Rank-based weighting',
    tags: ['rank order centroid', 'surrogate weight', 'rank-based weight']
  },
  {
    id: 'doc-4',
    authors: 'Danielson, M., Ekenberg, L.',
    title: 'Multi-criteria evaluation using ranked attribute weights',
    year: '2014',
    source: 'Decision Support Systems',
    volume: '64',
    issue: '',
    pages: '87-96',
    citations: '72',
    doi: '10.1016/j.dss.2014.04.010',
    abstract: 'Proposes a generalised framework for multi-criteria evaluation with ranked attribute weights, incorporating ordinal ranking methods, surrogate weights, and imprecise cardinal scores.',
    keywords: 'Decision analysis; Ranked attribute weights; Surrogate weights; Weight elicitation; Multi-criteria evaluation',
    tags: ['ranked attribute weight', 'surrogate weight', 'rank-based weight']
  }
];

// Multiline abstract for doc-1 (testing RFC 4180 multiline parser)
const MULTILINE_ABSTRACT = `Examines the quality of decisions made using ranked attribute weights in multiattribute decision analysis.
Compares rank order centroid (ROC) weights with other surrogate weighting methods, including "rank-sum" and "equal weighting", across simulated decision contexts.

Findings confirm that ROC weights achieve superior decision quality (often >98% efficiency) without requiring precise trade-off elicitation.`;

// Synthetic preprint document (must stay excluded from main count & export)
const SYNTHETIC_PREPRINT = {
  id: 'prep-1',
  authors: 'Lindell, K., Vainio, M.',
  title: 'Estimating surrogate weights from ordinal preferences in healthcare MCDA',
  year: '2025',
  source: 'medRxiv Preprint Server',
  doi: '10.1101/2025.01.15.25320501',
  abstract: 'Investigates the application of surrogate weights and rank order centroids in patient preference elicitation for health technology assessment.',
  keywords: 'Healthcare MCDA; Surrogate weights; Rank order centroid; Preprints'
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeCsvField(val) {
  if (val == null) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

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

function getDocumentsForQuery(executedQuery) {
  if (!executedQuery) return [];
  if (
    executedQuery.includes('INVALID_SYNTAX') ||
    executedQuery.includes('missing_paren') ||
    (executedQuery.includes('(') && !executedQuery.includes(')')) ||
    (executedQuery.split('(').length !== executedQuery.split(')').length)
  ) {
    return [];
  }
  if (executedQuery.toLowerCase().includes('surrogate weight') && !executedQuery.toLowerCase().includes('rank order centroid')) {
    // Query that misses the control paper but finds others (Doc 2 & Doc 3)
    return SYNTHETIC_DOCUMENTS.filter(d => d.id === 'doc-2' || d.id === 'doc-3');
  }
  if (executedQuery.includes('TITLE-ABS-KEY') || executedQuery.includes('rank order centroid') || executedQuery.includes('surrogate weight')) {
    // Standard D3 Block query: all 4 documents
    return [...SYNTHETIC_DOCUMENTS];
  }
  if (executedQuery.toLowerCase().includes('decision quality using ranked attribute weights')) {
    // Direct title search for the control paper alone -> confirms indexed
    return SYNTHETIC_DOCUMENTS.filter(d => d.title.toLowerCase().includes('decision quality using ranked attribute weights'));
  }
  if (executedQuery.toLowerCase().includes('nonexistent unindexed mystery paper')) {
    return [];
  }
  // Generic fallback search by substring matching
  const qClean = executedQuery.replace(/TITLE-ABS-KEY|\(|\)|"|\*/gi, ' ').toLowerCase();
  const terms = qClean.split(/\s+/).filter(t => t.length > 2 && t !== 'and' && t !== 'or');
  return SYNTHETIC_DOCUMENTS.filter(doc => {
    const hay = `${doc.title} ${doc.abstract} ${doc.keywords}`.toLowerCase();
    return terms.some(t => hay.includes(t));
  });
}

export function createScopusFixtureServer(options = {}) {
  const port = Number(options.port || process.env.SCOPUS_PORT || 4318);
  const exportsDir = path.resolve(options.exportsDir || path.join(__dirname, 'exports'));

  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = urlObj.pathname;

    // 1. Simulated Sign-In Gate (RTU ORTUS / Institutional / Direct)
    if (pathname === '/scopus/login-required' || pathname === '/scopus/rtu' || pathname === '/scopus/other-institution') {
      const instName = pathname === '/scopus/other-institution' ? 'University of Tartu / Consortium' : 'Riga Technical University ORTUS / EZproxy';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Institutional Sign-In Required | Scopus</title>
  <style>body { font-family: sans-serif; padding: 2rem; background: #f8f9fa; }</style>
</head>
<body>
  <h1>Institutional Sign-In Required (${instName})</h1>
  <p id="auth-message">Please sign in through ${instName} to access Scopus subscription resources.</p>
  <div class="auth-box" style="border: 1px solid #ccc; padding: 1rem; background: #fff; max-width: 400px;">
    <p><strong>Status:</strong> Authentication pending</p>
    <a href="/scopus" id="login-complete-btn" style="display:inline-block; padding: 8px 16px; background: #0073bb; color: #fff; text-decoration:none;">Simulate Sign-In Complete</a>
  </div>
</body>
</html>`);
    }

    // 1b. Unrelated Tab Endpoint (for testing tab selection isolation)
    if (pathname === '/scopus/unrelated') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Unrelated Project Tab</title>
</head>
<body>
  <h1>Unrelated Project Tab</h1>
  <p id="unrelated-msg">This tab must remain open and unaffected during and after search block execution.</p>
</body>
</html>`);
    }

    // 1c. Harmless Target Page Endpoint (for verifying external Chrome CDP attachment)
    if (pathname === '/scopus/harmless') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Harmless Target Page | Scopus Test Fixture</title>
</head>
<body>
  <h1>Harmless Target Document</h1>
  <p id="harmless-text">This is a harmless local test target tab for Chrome attachment verification.</p>
</body>
</html>`);
    }

    // 2. Simulated Bot Challenge / WAF
    if (pathname === '/scopus/bot-challenge') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Unusual Traffic Detected | Elsevier Protection</title>
  <style>body { font-family: sans-serif; padding: 2rem; background: #fff; color: #333; }</style>
</head>
<body>
  <h1>Unusual traffic detected</h1>
  <p id="challenge-message">Our systems have detected unusual traffic from your computer network. Please solve the challenge below to verify you are a human user.</p>
  <div id="captcha-box" style="border: 2px dashed #e74c3c; padding: 2rem; max-width: 400px; text-align: center;">
    <p><strong>Cloudflare / Turnstile Bot Verification</strong></p>
  </div>
</body>
</html>`);
    }

    // 3. Export CSV Endpoint (triggered by browser fetch/download)
    if (pathname === '/scopus/export') {
      const filename = urlObj.searchParams.get('filename') || 'Ch3_34_SC_D3.csv';
      const failExport = urlObj.searchParams.get('fail') === '1';
      const isMultiline = urlObj.searchParams.get('multiline') === '1' || filename.toLowerCase().includes('multiline');
      const isMismatch = urlObj.searchParams.get('mismatch') === '1' || filename.toLowerCase().includes('mismatch');

      // Path traversal check
      const validation = validateExportFilename(filename, exportsDir);
      if (!validation.valid) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`Invalid export filename: ${validation.error}`);
      }

      if (failExport) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Simulated Export Server Error: Unable to generate export file.');
      }

      // Generate standard Scopus CSV content
      const headers = [
        'Authors', 'Title', 'Year', 'Source title', 'Volume', 'Issue', 'Art. No.',
        'Page start', 'Page end', 'Page count', 'Cited by', 'DOI', 'Link',
        'Affiliations', 'Authors with affiliations', 'Abstract', 'Author Keywords',
        'Index Keywords', 'Correspondence Address', 'Publisher', 'ISSN', 'ISBN',
        'CODEN', 'PubMed ID', 'Language of Original Document', 'Abbreviated Source Title',
        'Document Type', 'Publication Stage', 'Open Access', 'Source', 'EID'
      ];

      // Format documents matching query
      const queryForExport = urlObj.searchParams.get('q') || '';
      let docsToExport = queryForExport ? getDocumentsForQuery(queryForExport) : [...SYNTHETIC_DOCUMENTS];

      // Apply simulated mismatch if requested
      if (isMismatch && docsToExport.length > 2) {
        docsToExport = docsToExport.slice(0, 2); // Exclude 2 records to test mismatch detection
      }

      const rows = docsToExport.map(doc => {
        const pages = doc.pages.split('-');
        const pageStart = pages[0] || '';
        const pageEnd = pages[1] || '';
        const abstractText = (isMultiline && doc.id === 'doc-1') ? MULTILINE_ABSTRACT : doc.abstract;

        return [
          escapeCsvField(doc.authors),
          escapeCsvField(doc.title),
          escapeCsvField(doc.year),
          escapeCsvField(doc.source),
          escapeCsvField(doc.volume),
          escapeCsvField(doc.issue),
          '""',
          escapeCsvField(pageStart),
          escapeCsvField(pageEnd),
          escapeCsvField(pageStart && pageEnd ? Number(pageEnd) - Number(pageStart) + 1 : ''),
          escapeCsvField(doc.citations),
          escapeCsvField(doc.doi),
          escapeCsvField(`https://www.scopus.com/inward/record.uri?doi=${doc.doi}`),
          escapeCsvField('Dept. of MSIS, University of Texas, Austin, United States'),
          escapeCsvField(`${doc.authors}, Dept. of MSIS, University of Texas, Austin, United States`),
          escapeCsvField(abstractText),
          escapeCsvField(doc.keywords),
          escapeCsvField(doc.keywords),
          escapeCsvField('Austin, TX, United States'),
          escapeCsvField('INFORMS'),
          escapeCsvField('00251909'),
          '""',
          '""',
          '""',
          escapeCsvField('English'),
          escapeCsvField('Manage. Sci.'),
          escapeCsvField('Article'),
          escapeCsvField('Final'),
          escapeCsvField('All Open Access'),
          escapeCsvField('Scopus'),
          escapeCsvField(`2-s2.0-${doc.id}`)
        ].join(',');
      });

      const csvContent = headers.join(',') + '\r\n' + rows.join('\r\n') + '\r\n';

      // DO NOT write to disk on server! Export must arrive via fresh browser download!
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${validation.filename}"`,
        'Cache-Control': 'no-cache'
      });
      return res.end(csvContent);
    }

    // 4. Main Scopus Interface (Home, Advanced, Results)
    const queryParam = urlObj.searchParams.get('q') || '';
    const searchWithinParam = urlObj.searchParams.get('within') || '';
    const failExportParam = urlObj.searchParams.get('fail_export') || '';
    const multilineParam = urlObj.searchParams.get('multiline') === '1';
    const mismatchParam = urlObj.searchParams.get('mismatch') === '1';
    const rewriteParam = urlObj.searchParams.get('rewrite') === '1';
    const missingQueryParam = urlObj.searchParams.get('missing_query') === '1';

    // Classify query
    const isAdvancedView = pathname === '/scopus/advanced' || pathname === '/advanced';
    let executedQuery = queryParam.trim();
    let isErrorQuery = false;
    let errorMessage = '';
    let results = [];
    let preprintCount = 0;
    let hasSearched = Boolean(executedQuery);

    if (hasSearched) {
      // Check for syntax error simulation
      if (
        executedQuery.includes('INVALID_SYNTAX') ||
        executedQuery.includes('missing_paren') ||
        (executedQuery.includes('(') && !executedQuery.includes(')')) ||
        (executedQuery.split('(').length !== executedQuery.split(')').length)
      ) {
        isErrorQuery = true;
        errorMessage = 'Syntax error in query: Mismatched parentheses or invalid field tag. Search was not executed.';
        results = [];
        preprintCount = 0;
      } else {
        results = getDocumentsForQuery(executedQuery);
        preprintCount = (executedQuery.includes('TITLE-ABS-KEY') || executedQuery.includes('rank order centroid')) && results.length > 2 ? 1 : 0;
      }

      // Apply Search-Within-Results filter if provided
      if (searchWithinParam && !isErrorQuery) {
        const withinClean = searchWithinParam.replace(/"/g, '').toLowerCase().trim();
        results = results.filter(doc => doc.title.toLowerCase().includes(withinClean));
      }
    }

    // Determine displayed query
    let displayedQuery = executedQuery;
    if (rewriteParam || executedQuery.includes('SIMULATE_REWRITE')) {
      displayedQuery = `${executedQuery} AND (LIMIT-TO (DOCTYPE, "ar"))`;
    }
    const shouldOmitQueryDisplay = missingQueryParam || executedQuery.includes('SIMULATE_MISSING_QUERY');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Scopus Document Search | Riga Technical University</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; background: #f0f2f5; color: #1e293b; }
    header { background: #0073bb; color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    header h1 { font-size: 1.25rem; margin: 0; font-weight: 600; }
    .inst-badge { background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 4px; font-size: 0.85rem; }
    nav.subnav { background: #ffffff; border-bottom: 1px solid #cbd5e1; padding: 0 2rem; display: flex; gap: 1.5rem; }
    nav.subnav a { text-decoration: none; color: #475569; padding: 12px 4px; border-bottom: 2px solid transparent; font-size: 0.95rem; font-weight: 500; }
    nav.subnav a.active { color: #0073bb; border-bottom-color: #0073bb; font-weight: 600; }
    main { max-width: 1000px; margin: 2rem auto; padding: 0 1rem; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; font-weight: 600; margin-bottom: 0.5rem; font-size: 0.95rem; }
    textarea { width: 100%; height: 120px; padding: 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace; font-size: 0.95rem; box-sizing: border-box; }
    button { background: #0073bb; color: white; border: none; padding: 8px 18px; border-radius: 4px; font-size: 0.95rem; font-weight: 500; cursor: pointer; }
    button:hover { background: #005a94; }
    button.secondary { background: #e2e8f0; color: #334155; }
    button.secondary:hover { background: #cbd5e1; }
    .alert-error { background: #fee2e2; border-left: 4px solid #ef4444; color: #991b1b; padding: 1rem; margin-bottom: 1.5rem; border-radius: 4px; }
    .results-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; }
    .query-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 4px; font-family: monospace; font-size: 0.9rem; margin-bottom: 1rem; color: #0f172a; }
    .tabs-strip { display: flex; gap: 1rem; border-bottom: 1px solid #e2e8f0; margin-bottom: 1rem; }
    .tab-btn { background: none; border: none; color: #64748b; padding: 8px 12px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 0.95rem; }
    .tab-btn.active { color: #0073bb; border-bottom-color: #0073bb; font-weight: 600; }
    .within-form { display: flex; gap: 8px; margin-bottom: 1.5rem; }
    .within-form input { flex: 1; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem; }
    .doc-item { border-bottom: 1px solid #f1f5f9; padding: 1rem 0; }
    .doc-item:last-child { border-bottom: none; }
    .doc-title { font-size: 1.05rem; font-weight: 600; color: #0073bb; margin-bottom: 4px; }
    .doc-authors { font-size: 0.88rem; color: #334155; margin-bottom: 4px; }
    .doc-source { font-size: 0.85rem; color: #64748b; }
    /* Modal styles */
    .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 1000; }
    .modal-overlay.open { display: flex; }
    .modal-content { background: white; border-radius: 8px; padding: 1.5rem; width: 480px; max-width: 90vw; }
  </style>
</head>
<body>
  <header>
    <h1>Scopus</h1>
    <span class="inst-badge">Access provided by Rīgas Tehniskā universitāte</span>
  </header>

  <nav class="subnav">
    <a href="/scopus" id="tab-documents" class="${!isAdvancedView && !hasSearched ? 'active' : ''}">Documents</a>
    <a href="/scopus/advanced" id="tab-advanced" class="${isAdvancedView || hasSearched ? 'active' : ''}">Advanced document search</a>
  </nav>

  <main>
    ${!hasSearched ? `
      <div class="card">
        <h2>Advanced document search</h2>
        <form method="GET" action="/scopus/advanced">
          ${multilineParam ? `<input type="hidden" name="multiline" value="1">` : ''}
          ${mismatchParam ? `<input type="hidden" name="mismatch" value="1">` : ''}
          ${rewriteParam ? `<input type="hidden" name="rewrite" value="1">` : ''}
          ${missingQueryParam ? `<input type="hidden" name="missing_query" value="1">` : ''}
          <div class="form-group">
            <label for="query-input">Enter query string:</label>
            <textarea id="query-input" name="q" placeholder='TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" )'>${escapeHtml(queryParam)}</textarea>
          </div>
          <div style="display: flex; gap: 10px;">
            <button id="search-btn" type="submit">Search</button>
            <button id="clear-btn" type="button" class="secondary" onclick="document.getElementById('query-input').value=''">Clear</button>
          </div>
        </form>
      </div>
    ` : isErrorQuery ? `
      <div class="card" role="region" aria-label="Query error">
        <h2>Advanced document search</h2>
        <div id="query-error" class="alert-error" role="alert">
          <h3 id="query-error-title" style="color: #991b1b; margin: 0 0 0.5rem 0;">Syntax error in query</h3>
          <p id="query-error-msg" style="margin: 0;">${escapeHtml(errorMessage)}</p>
        </div>
        <form method="GET" action="/scopus/advanced">
          ${multilineParam ? `<input type="hidden" name="multiline" value="1">` : ''}
          ${mismatchParam ? `<input type="hidden" name="mismatch" value="1">` : ''}
          ${rewriteParam ? `<input type="hidden" name="rewrite" value="1">` : ''}
          ${missingQueryParam ? `<input type="hidden" name="missing_query" value="1">` : ''}
          <div class="form-group">
            <label for="query-input">Edit query string:</label>
            <textarea id="query-input" name="q">${escapeHtml(queryParam)}</textarea>
          </div>
          <button id="search-btn" type="submit">Search</button>
        </form>
      </div>
    ` : `
      <div class="card">
        <div class="results-header">
          <div>
            <h1 id="results-heading"><span id="total-results">${results.length}</span> document results</h1>
            <div style="font-size: 0.85rem; color: #64748b; margin-top: 2px;">
              Date of search: <span id="search-date">6 Nov 2026</span>
            </div>
          </div>
          <div>
            <button id="export-btn" type="button" onclick="document.getElementById('export-modal').classList.add('open')">Export</button>
            <a href="/scopus/advanced" id="edit-query-link" style="display:inline-block; margin-left:8px; font-size:0.9rem; color:#0073bb; text-decoration:none;">Edit query</a>
          </div>
        </div>

        ${shouldOmitQueryDisplay ? '' : `<div id="query-executed" class="query-box" aria-label="Query as executed">${escapeHtml(displayedQuery)}</div>`}

        <div class="tabs-strip">
          <button class="tab-btn active" id="tab-main-docs">Documents (${results.length})</button>
          <button class="tab-btn" id="tab-preprints">Preprints (<span id="preprints-count">${preprintCount}</span>)</button>
        </div>

        <form class="within-form" method="GET" action="/scopus/advanced">
          <input type="hidden" name="q" value="${escapeHtml(executedQuery)}">
          ${failExportParam ? `<input type="hidden" name="fail_export" value="${escapeHtml(failExportParam)}">` : ''}
          ${multilineParam ? `<input type="hidden" name="multiline" value="1">` : ''}
          ${mismatchParam ? `<input type="hidden" name="mismatch" value="1">` : ''}
          ${rewriteParam ? `<input type="hidden" name="rewrite" value="1">` : ''}
          ${missingQueryParam ? `<input type="hidden" name="missing_query" value="1">` : ''}
          <input type="text" id="search-within-input" name="within" placeholder="Search within results (e.g. control title)..." value="${escapeHtml(searchWithinParam)}">
          <button type="submit" id="search-within-btn" class="secondary">Search within</button>
          ${searchWithinParam ? `<a href="/scopus/advanced?q=${encodeURIComponent(executedQuery)}${multilineParam ? '&multiline=1' : ''}${mismatchParam ? '&mismatch=1' : ''}" id="clear-filter-link" style="align-self:center; font-size:0.85rem; color:#64748b; text-decoration:none;">Clear filter</a>` : ''}
        </form>

        <div class="results-list" id="results-list">
          ${results.length === 0 ? `
            <div id="no-results-msg" style="padding: 2rem; text-align: center; color: #64748b;">
              No documents found matching the search criteria.
            </div>
          ` : results.map((doc, idx) => `
            <div class="doc-item" id="${doc.id}">
              <div class="doc-title">${idx + 1}. <span class="doc-title-text">${doc.title}</span></div>
              <div class="doc-authors">${doc.authors} (${doc.year})</div>
              <div class="doc-source">${doc.source} ${doc.volume ? doc.volume : ''}${doc.issue ? '(' + doc.issue + ')' : ''}, pp. ${doc.pages} &bull; DOI: ${doc.doi}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `}
  </main>

  <!-- Export Dialog Modal -->
  <div class="modal-overlay" id="export-modal" role="dialog" aria-labelledby="modal-title">
    <div class="modal-content">
      <h2 id="modal-title" style="margin-top:0;">Export document settings</h2>
      <p style="font-size: 0.9rem; color: #475569;">Export <span id="export-count-display">${results.length}</span> documents to a tabular data file.</p>

      <div style="margin-bottom: 1rem;">
        <label>Export format:</label>
        <label style="font-weight: normal; margin-left: 8px;">
          <input type="radio" id="export-format-csv" name="export-format" value="csv" checked> CSV (Excel)
        </label>
      </div>

      <div style="margin-bottom: 1rem;">
        <label>Customize data fields:</label>
        <div>
          <label style="font-weight: normal; font-size: 0.9rem;">
            <input type="checkbox" id="field-citation" checked> <strong>Citation information</strong> (Authors, Title, Year, Source, Volume, Pages, DOI)
          </label>
        </div>
        <div>
          <label style="font-weight: normal; font-size: 0.9rem;">
            <input type="checkbox" id="field-abstract" checked> <strong>Abstract & keywords</strong> (Abstract, Author keywords, Index keywords)
          </label>
        </div>
      </div>

      <div style="margin-bottom: 1.5rem;">
        <label for="export-filename">Target file name:</label>
        <input type="text" id="export-filename" value="Ch3_34_SC_D3.csv" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box;">
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="secondary" id="cancel-export-btn" onclick="document.getElementById('export-modal').classList.remove('open')">Cancel</button>
        <button type="button" id="confirm-export-btn" onclick="triggerExport(false)">Confirm Export</button>
        <button type="button" class="secondary" id="simulate-fail-btn" style="color:#b91c1c; border-color:#fca5a5;" onclick="triggerExport(true)">Simulate Export Failure</button>
      </div>

      <div id="export-status" style="margin-top: 1rem; font-size: 0.85rem; color: #0284c7;"></div>
    </div>
  </div>

  <script>
    function triggerExport(simulateFail) {
      const filename = document.getElementById('export-filename').value.trim() || 'Ch3_34_SC_D3.csv';
      const status = document.getElementById('export-status');
      status.textContent = 'Processing export...';
      const q = ${JSON.stringify(executedQuery)};
      let url = '/scopus/export?filename=' + encodeURIComponent(filename) + '&q=' + encodeURIComponent(q);
      if (simulateFail) url += '&fail=1';
      if (${JSON.stringify(multilineParam || executedQuery.includes('SIMULATE_MULTILINE'))}) url += '&multiline=1';
      if (${JSON.stringify(mismatchParam || executedQuery.includes('SIMULATE_MISMATCH'))}) url += '&mismatch=1';

      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.blob();
        })
        .then(blob => {
          status.textContent = 'Export completed successfully: ' + filename;
          const a = document.createElement('a');
          a.id = 'download-anchor';
          a.href = window.URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.getElementById('export-modal').classList.remove('open');
          }, 500);
        })
        .catch(err => {
          status.style.color = '#dc2626';
          status.textContent = 'Export failed: ' + err.message;
        });
    }
  </script>
</body>
</html>`;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(html);
  });

  return {
    server,
    port,
    exportsDir,
    start() {
      return new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => {
          console.log(`Scopus test fixture listening at http://127.0.0.1:${port}/`);
          resolve({ port, exportsDir });
        }).on('error', reject);
      });
    },
    stop() {
      return new Promise((resolve) => {
        server.close(resolve);
      });
    }
  };
}

// Allow standalone CLI execution: node scopus-fixture.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = createScopusFixtureServer();
  await fixture.start();
}
