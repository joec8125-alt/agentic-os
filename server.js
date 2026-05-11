// AOS dashboard server — pure Node, no dependencies.
// Auto-adapts to either AOS layout:
//   - .claude/skills/<name>/SKILL.md   (Anthropic-canonical)
//   - skills/<name>/SKILL.md (or skill.md)   (Joe's flat layout)
// And to either context location:
//   - context/   (canonical)
//   - brain/     (Joe's container)
// Both can coexist; both will be surfaced.
//
// AOS root = process.env.AOS_ROOT || parent dir of this file.
// Server binds to 127.0.0.1 only.

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const url = require('url');

// Tiny .env loader (no dotenv dependency). Reads <dashboard>/.env if present.
function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadDotEnv();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4321;
const DASHBOARD_DIR = __dirname;
const PUBLIC_DIR = path.join(DASHBOARD_DIR, 'public');
const AOS_ROOT = path.resolve(process.env.AOS_ROOT || path.resolve(DASHBOARD_DIR, '..'));
const CACHE_DIR = path.join(DASHBOARD_DIR, '.cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// --- helpers ---------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const sendJson = (res, s, p) => send(res, s, p);
const sendErr = (res, s, m) => send(res, s, { error: m });

// Path traversal-safe resolve under AOS_ROOT.
function safeResolve(relPath) {
  if (!relPath || typeof relPath !== 'string') throw new Error('path missing');
  const normalized = path.normalize(relPath).replace(/^[\\/]+/, '');
  const resolved = path.resolve(AOS_ROOT, normalized);
  if (!resolved.startsWith(AOS_ROOT + path.sep) && resolved !== AOS_ROOT) {
    throw new Error('path escapes AOS root');
  }
  return resolved;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.vscode', '.idea']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);

async function readTree(absPath, relPath = '', depth = 0, maxDepth = 4) {
  // Cap depth so the dashboard doesn't drown in deeply nested marketplaces.
  if (depth >= maxDepth) return null;
  const stat = await fsp.stat(absPath);
  if (!stat.isDirectory()) return null;
  const entries = await fsp.readdir(absPath, { withFileTypes: true });
  const children = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    if (!entry.isDirectory() && SKIP_FILES.has(entry.name)) continue;
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    const childAbs = path.join(absPath, entry.name);
    if (entry.isDirectory()) {
      children.push({
        name: entry.name,
        path: childRel,
        type: 'dir',
        children: await readTree(childAbs, childRel, depth + 1, maxDepth),
      });
    } else {
      const fstat = await fsp.stat(childAbs).catch(() => null);
      children.push({
        name: entry.name,
        path: childRel,
        type: 'file',
        size: fstat ? fstat.size : 0,
        mtime: fstat ? fstat.mtime.toISOString() : null,
      });
    }
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: text };
  const fmText = m[1];
  const body = text.slice(m[0].length);
  const frontmatter = {};
  let key = null;
  let buffer = '';
  for (const line of fmText.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      if (key !== null) frontmatter[key] = buffer.trim();
      key = kv[1];
      buffer = kv[2];
    } else if (key !== null) {
      buffer += '\n' + line;
    }
  }
  if (key !== null) frontmatter[key] = buffer.trim();
  return { frontmatter, body };
}

// Find the skills root: .claude/skills first, then skills/.
function findSkillsRoot() {
  const candidates = [
    path.join(AOS_ROOT, '.claude', 'skills'),
    path.join(AOS_ROOT, 'skills'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  return null;
}

// Inside <skillDir>, find the SKILL.md / skill.md file (case-insensitive).
function findSkillFile(skillDir) {
  if (!fs.existsSync(skillDir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(skillDir);
  } catch {
    return null;
  }
  const match = entries.find((f) => /^skill\.md$/i.test(f));
  return match ? path.join(skillDir, match) : null;
}

// Find the context dirs: context/ and/or brain/.
function findContextDirs() {
  const out = [];
  for (const name of ['context', 'brain']) {
    const p = path.join(AOS_ROOT, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) out.push(name);
  }
  return out;
}

async function listSkills() {
  const skillsRoot = findSkillsRoot();
  if (!skillsRoot) return [];
  const skillsRootRel = path.relative(AOS_ROOT, skillsRoot).replace(/\\/g, '/');
  const dirs = await fsp.readdir(skillsRoot, { withFileTypes: true });
  const skills = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const skillDir = path.join(skillsRoot, d.name);
    const skillFile = findSkillFile(skillDir);
    if (!skillFile) continue;
    let text;
    try {
      text = await fsp.readFile(skillFile, 'utf-8');
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(text);
    const fileRel = `${skillsRootRel}/${d.name}/${path.basename(skillFile)}`;
    skills.push({
      name: frontmatter.name || d.name,
      folder: d.name,
      path: fileRel,
      frontmatter,
      bodyPreview: body.slice(0, 240).trim(),
      bodyLength: body.length,
    });
  }
  skills.sort((a, b) => a.folder.localeCompare(b.folder));
  return skills;
}

async function listAudits() {
  const auditsRoot = path.join(AOS_ROOT, 'audits');
  if (!fs.existsSync(auditsRoot)) return [];
  const files = await fsp.readdir(auditsRoot);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const stat = await fsp.stat(path.join(auditsRoot, f));
    out.push({
      name: f,
      path: `audits/${f}`,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
    });
  }
  out.sort((a, b) => b.name.localeCompare(a.name));
  return out;
}

async function listDirFiles(dirRel) {
  const abs = path.join(AOS_ROOT, dirRel);
  if (!fs.existsSync(abs)) return [];
  const items = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const it of items) {
    if (it.isDirectory()) continue;
    if (it.name.startsWith('.')) continue;
    out.push({ name: it.name, path: `${dirRel}/${it.name}` });
  }
  return out;
}

// --- usage tracking ---------------------------------------------------------

const USER_HOME = process.env.USERPROFILE || process.env.HOME || '';
const CLAUDE_HOME = path.join(USER_HOME, '.claude');
const PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects');
const HISTORY_FILE = path.join(CLAUDE_HOME, 'history.jsonl');

function dateKey(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC-ish; good enough for daily buckets)
}

// Normalize project identifiers: history.jsonl stores raw paths ("C:\\CV"),
// the projects/ directory uses slugs ("C--CV"). Collapse both to a lowercase
// slug ("c--cv") so they aggregate cleanly.
function normalizeProject(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/\\/g, '/')              // backslash -> forward slash
    .replace(/[/]+/g, '--')           // / -> --
    .replace(/^([a-z]):--/, '$1--');  // drop the drive-letter colon ("c:--cv" -> "c--cv")
}

function startOfWeek(dateStr) {
  // ISO-ish week: anchor to the most recent Monday in UTC
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0 = Sun
  const offset = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(dateStr) {
  return dateStr.slice(0, 7) + '-01';
}

async function* walkUsageEvents() {
  if (!fs.existsSync(PROJECTS_DIR)) return;
  const projectDirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  for (const pd of projectDirs) {
    if (!pd.isDirectory()) continue;
    const slug = pd.name;
    const dirPath = path.join(PROJECTS_DIR, slug);
    let files;
    try {
      files = await fsp.readdir(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, f);
      const sessionId = f.replace(/\.jsonl$/, '');
      let raw;
      try {
        raw = await fsp.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        const usage = obj.message && obj.message.usage;
        if (!usage) continue;
        // Timestamp resolution: prefer line.timestamp (ISO string), fall back to message id, then to file mtime.
        let ts = null;
        if (obj.timestamp) {
          const t = Date.parse(obj.timestamp);
          if (!Number.isNaN(t)) ts = t;
        }
        if (!ts && obj.message && obj.message.id) {
          // msg_ ids don't encode time; fall through
        }
        if (!ts) {
          // Use file mtime as a coarse fallback
          try {
            const stat = fs.statSync(filePath);
            ts = stat.mtimeMs;
          } catch {
            continue;
          }
        }
        yield {
          ts,
          project: normalizeProject(slug),
          sessionId,
          model: (obj.message && obj.message.model) || 'unknown',
          input: usage.input_tokens || 0,
          cacheCreate: usage.cache_creation_input_tokens || 0,
          cacheRead: usage.cache_read_input_tokens || 0,
          output: usage.output_tokens || 0,
        };
      }
    }
  }
}

async function readHistoryActivity() {
  // history.jsonl: one user-message entry per line { display, timestamp, project, sessionId }
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const raw = await fsp.readFile(HISTORY_FILE, 'utf-8');
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.timestamp) entries.push(obj);
    } catch {}
  }
  return entries;
}

// --- Anthropic Admin API fetcher --------------------------------------------

// Cache the upstream response on disk so we don't hammer Anthropic on every
// dashboard refresh. Default TTL: 10 minutes.
const ADMIN_CACHE_FILE = path.join(CACHE_DIR, 'anthropic-usage.json');
const ADMIN_CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchAnthropicUsage({ days = 60 } = {}) {
  const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!apiKey) return { source: 'unavailable', reason: 'ANTHROPIC_ADMIN_API_KEY not set in dashboard/.env' };

  // Cache hit?
  if (fs.existsSync(ADMIN_CACHE_FILE)) {
    try {
      const cached = JSON.parse(await fsp.readFile(ADMIN_CACHE_FILE, 'utf-8'));
      if (cached.cachedAt && Date.now() - cached.cachedAt < ADMIN_CACHE_TTL_MS && cached.days === days) {
        return { ...cached.payload, source: 'anthropic-admin-api', cached: true, cachedAt: cached.cachedAt };
      }
    } catch {}
  }

  const endingAt = new Date();
  const startingAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const buckets = [];
  let nextPage = null;
  let safetyCounter = 0;

  do {
    const url = new URL('https://api.anthropic.com/v1/organizations/usage_report/messages');
    url.searchParams.set('starting_at', startingAt.toISOString());
    url.searchParams.set('ending_at', endingAt.toISOString());
    url.searchParams.set('bucket_width', '1d');
    if (nextPage) url.searchParams.set('page', nextPage);

    let res;
    try {
      res = await fetch(url, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      });
    } catch (err) {
      return { source: 'error', reason: `network: ${err.message}` };
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { source: 'error', reason: `Anthropic ${res.status}: ${errText.slice(0, 200)}` };
    }

    const json = await res.json();
    if (Array.isArray(json.data)) buckets.push(...json.data);
    nextPage = json.has_more ? json.next_page : null;
    safetyCounter += 1;
  } while (nextPage && safetyCounter < 20);

  // Reduce buckets to per-day totals
  const byDay = new Map();
  for (const b of buckets) {
    const k = (b.starting_at || '').slice(0, 10);
    if (!k) continue;
    if (!byDay.has(k)) {
      byDay.set(k, { date: k, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, serverToolUse: 0, models: new Set() });
    }
    const acc = byDay.get(k);
    for (const r of (b.results || [])) {
      acc.input += r.uncached_input_tokens || 0;
      acc.cacheCreate += r.cache_creation_input_tokens || 0;
      acc.cacheRead += r.cache_read_input_tokens || 0;
      acc.output += r.output_tokens || 0;
      acc.serverToolUse += r.server_tool_use_tokens || 0;
      if (r.model) acc.models.add(r.model);
    }
  }
  const daily = Array.from(byDay.values()).map((d) => ({ ...d, models: Array.from(d.models), total: d.input + d.cacheCreate + d.output })).sort((a, b) => a.date.localeCompare(b.date));

  const payload = { source: 'anthropic-admin-api', daily, fetchedAt: Date.now() };

  // Persist cache
  try {
    await fsp.writeFile(ADMIN_CACHE_FILE, JSON.stringify({ cachedAt: Date.now(), days, payload }), 'utf-8');
  } catch {}

  return payload;
}

async function getUsage({ days = 60 } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const dayMap = new Map(); // YYYY-MM-DD -> aggregate

  // Init empty buckets for the last `days` days so the chart has a contiguous x-axis
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const k = d.toISOString().slice(0, 10);
    dayMap.set(k, {
      date: k,
      input: 0,
      cacheCreate: 0,
      cacheRead: 0,
      output: 0,
      requests: 0,
      messages: 0,
      projects: new Set(),
      models: new Set(),
    });
  }

  // Walk usage events
  for await (const e of walkUsageEvents()) {
    if (e.ts < cutoff) continue;
    const k = dateKey(e.ts);
    if (!dayMap.has(k)) continue; // outside the window after rounding
    const b = dayMap.get(k);
    b.input += e.input;
    b.cacheCreate += e.cacheCreate;
    b.cacheRead += e.cacheRead;
    b.output += e.output;
    b.requests += 1;
    b.projects.add(e.project);
    b.models.add(e.model);
  }

  // Walk history (user messages)
  const hist = await readHistoryActivity();
  for (const h of hist) {
    if (h.timestamp < cutoff) continue;
    const k = dateKey(h.timestamp);
    if (!dayMap.has(k)) continue;
    const b = dayMap.get(k);
    b.messages += 1;
    if (h.project) b.projects.add(normalizeProject(h.project));
  }

  // Fetch official usage from Anthropic Admin API (if configured) and overlay it.
  // Admin API is authoritative for billing; we use it to fill in days the local
  // logs don't cover, AND mark days where local + official differ.
  const admin = await fetchAnthropicUsage({ days });
  let adminDaily = [];
  if (admin.source === 'anthropic-admin-api' && Array.isArray(admin.daily)) {
    adminDaily = admin.daily;
    for (const ad of adminDaily) {
      if (!dayMap.has(ad.date)) {
        // Day older than our local floor — still in window, fill from API.
        dayMap.set(ad.date, {
          date: ad.date,
          input: 0, cacheCreate: 0, cacheRead: 0, output: 0,
          requests: 0, messages: 0,
          projects: new Set(), models: new Set(),
        });
      }
      const b = dayMap.get(ad.date);
      // Trust API over local for the four token columns (it's the billing source of truth).
      b.input = ad.input;
      b.cacheCreate = ad.cacheCreate;
      b.cacheRead = ad.cacheRead;
      b.output = ad.output;
      for (const m of (ad.models || [])) b.models.add(m);
      b.fromApi = true;
    }
  }

  // Convert to array, oldest first
  // "total" = NEW content only (input + cacheCreate + output).
  // cacheRead is the same content re-read each turn; billed at ~10% rate;
  // including it inflates the headline 10-100x. Surfaced separately.
  const daily = Array.from(dayMap.values())
    .map((b) => ({
      ...b,
      projects: Array.from(b.projects),
      models: Array.from(b.models),
      total: b.input + b.cacheCreate + b.output,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Weekly + monthly aggregates
  const weekly = aggregate(daily, startOfWeek);
  const monthly = aggregate(daily, startOfMonth);

  // Totals over windows
  const total7 = sumOver(daily, 7);
  const total30 = sumOver(daily, 30);
  const total60 = sumOver(daily, 60);

  return {
    daily,
    weekly,
    monthly,
    totals: { last7: total7, last30: total30, last60: total60 },
    sources: {
      local: { earliestDay: daily.find((d) => d.requests > 0)?.date || null },
      anthropic: admin.source === 'anthropic-admin-api'
        ? { available: true, dayCount: adminDaily.length, cached: !!admin.cached, cachedAt: admin.cachedAt }
        : { available: false, reason: admin.reason || 'unknown' },
    },
  };
}

function aggregate(daily, keyFn) {
  const map = new Map();
  for (const d of daily) {
    const k = keyFn(d.date);
    if (!map.has(k)) {
      map.set(k, { period: k, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, requests: 0, messages: 0, days: 0 });
    }
    const b = map.get(k);
    b.input += d.input;
    b.cacheCreate += d.cacheCreate;
    b.cacheRead += d.cacheRead;
    b.output += d.output;
    b.requests += d.requests;
    b.messages += d.messages;
    if (d.requests > 0 || d.messages > 0) b.days += 1;
  }
  for (const v of map.values()) v.total = v.input + v.cacheCreate + v.output;
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function sumOver(daily, n) {
  const slice = daily.slice(-n);
  return slice.reduce(
    (acc, d) => ({
      input: acc.input + d.input,
      cacheCreate: acc.cacheCreate + d.cacheCreate,
      cacheRead: acc.cacheRead + d.cacheRead,
      output: acc.output + d.output,
      requests: acc.requests + d.requests,
      messages: acc.messages + d.messages,
      total: acc.total + d.total,
    }),
    { input: 0, cacheCreate: 0, cacheRead: 0, output: 0, requests: 0, messages: 0, total: 0 },
  );
}

async function getSummary() {
  const summary = {
    aosRoot: AOS_ROOT,
    skillsRoot: null,
    skillsRootRel: null,
    skillsCount: 0,
    contextDirs: findContextDirs(),
    contextFiles: [],
    auditsCount: 0,
    latestAudit: null,
    decisionsCount: 0,
    archivesCount: 0,
    rootFiles: [],
    onboarded: false,
    hasClaudeMd: false,
    hasAgentsMd: false,
  };

  const skillsRoot = findSkillsRoot();
  if (skillsRoot) {
    summary.skillsRoot = skillsRoot;
    summary.skillsRootRel = path.relative(AOS_ROOT, skillsRoot).replace(/\\/g, '/');
    summary.skillsCount = (await listSkills()).length;
  }

  // Aggregate context files from all detected context dirs
  for (const dir of summary.contextDirs) {
    const files = await listDirFiles(dir);
    for (const f of files) summary.contextFiles.push(f);
  }

  // root .md/.txt files
  for (const it of await fsp.readdir(AOS_ROOT, { withFileTypes: true })) {
    if (it.isDirectory()) continue;
    if (it.name.startsWith('.')) continue;
    if (/\.(md|txt)$/i.test(it.name)) {
      summary.rootFiles.push({ name: it.name, path: it.name });
    }
  }

  const audits = await listAudits();
  summary.auditsCount = audits.length;
  summary.latestAudit = audits[0] || null;

  for (const dir of ['decisions', 'archives']) {
    const p = path.join(AOS_ROOT, dir);
    if (fs.existsSync(p)) {
      summary[dir + 'Count'] = (await fsp.readdir(p)).filter((f) => !f.startsWith('.')).length;
    }
  }

  const claudePath = path.join(AOS_ROOT, 'CLAUDE.md');
  summary.hasClaudeMd = fs.existsSync(claudePath);
  if (summary.hasClaudeMd) {
    const text = await fsp.readFile(claudePath, 'utf-8');
    summary.onboarded = !text.includes('{{Your Name}}') && !text.includes('{{Your name}}');
  }
  summary.hasAgentsMd = fs.existsSync(path.join(AOS_ROOT, 'AGENTS.md'));

  return summary;
}

// --- request handler -------------------------------------------------------

async function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  try {
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/summary' && req.method === 'GET') {
        return sendJson(res, 200, await getSummary());
      }
      if (pathname === '/api/tree' && req.method === 'GET') {
        return sendJson(res, 200, { root: AOS_ROOT, children: await readTree(AOS_ROOT) });
      }
      if (pathname === '/api/file' && req.method === 'GET') {
        const abs = safeResolve(parsed.query.path);
        const stat = await fsp.stat(abs);
        if (!stat.isFile()) return sendErr(res, 400, 'not a file');
        if (stat.size > 5_000_000) return sendErr(res, 413, 'file too large to view');
        const ext = path.extname(abs).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico'].includes(ext)) {
          const buf = await fsp.readFile(abs);
          return send(res, 200, buf, MIME[ext] || 'application/octet-stream');
        }
        const content = await fsp.readFile(abs, 'utf-8');
        return sendJson(res, 200, { path: parsed.query.path, content, mtime: stat.mtime.toISOString() });
      }
      if (pathname === '/api/file' && (req.method === 'PUT' || req.method === 'POST')) {
        const abs = safeResolve(parsed.query.path);
        let body = '';
        for await (const chunk of req) body += chunk;
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, body, 'utf-8');
        const stat = await fsp.stat(abs);
        return sendJson(res, 200, { ok: true, mtime: stat.mtime.toISOString(), size: stat.size });
      }
      if (pathname === '/api/skills' && req.method === 'GET') {
        return sendJson(res, 200, { skills: await listSkills() });
      }
      if (pathname === '/api/audits' && req.method === 'GET') {
        return sendJson(res, 200, { audits: await listAudits() });
      }
      if (pathname === '/api/usage' && req.method === 'GET') {
        const days = Math.min(parseInt(parsed.query.days, 10) || 60, 365);
        return sendJson(res, 200, await getUsage({ days }));
      }
      return sendErr(res, 404, 'unknown api route');
    }

    // static
    let urlPath = pathname === '/' ? '/index.html' : pathname;
    if (urlPath.includes('..')) return sendErr(res, 400, 'bad path');
    const filePath = path.join(PUBLIC_DIR, urlPath);
    if (!filePath.startsWith(PUBLIC_DIR)) return sendErr(res, 400, 'bad path');
    if (!fs.existsSync(filePath)) return sendErr(res, 404, 'not found');
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) return sendErr(res, 404, 'not found');
    const ext = path.extname(filePath).toLowerCase();
    const content = await fsp.readFile(filePath);
    return send(res, 200, content, MIME[ext] || 'application/octet-stream');
  } catch (err) {
    console.error('[err]', req.method, pathname, '-', err.message);
    return sendErr(res, 500, err.message);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[fatal]', err);
    sendErr(res, 500, err.message || 'unknown error');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AOS dashboard`);
  console.log(`  ─────────────`);
  console.log(`  AOS:    ${AOS_ROOT}`);
  console.log(`  URL:    http://localhost:${PORT}`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
});
