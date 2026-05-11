// AOS dashboard SPA — vanilla JS, no framework

let SUMMARY = null; // cached after first load

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'request failed' }));
    throw new Error(err.error || `${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

const get = (p, q = {}) => {
  const url = new URL(p, location.origin);
  Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, v));
  return api(url.pathname + url.search);
};

const putFile = (path, content) =>
  fetch('/api/file?' + new URLSearchParams({ path }), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error)))));

function toast(msg, kind = '') {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- markdown (minimal renderer for .md preview) -----------------------------

function markdown(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let inCode = false;
  let inList = false;
  let listType = null;
  let inTable = false;
  let tableHeader = false;

  const flushList = () => {
    if (inList) {
      out.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
      listType = null;
    }
  };
  const flushTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
      tableHeader = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushList();
      flushTable();
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { out.push('<pre><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }

    if (/^\|.+\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        if (inTable) { out.push('</thead><tbody>'); tableHeader = false; }
        continue;
      }
      if (!inTable) { out.push('<table><thead>'); inTable = true; tableHeader = true; }
      const tag = tableHeader ? 'th' : 'td';
      out.push('<tr>' + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>');
      continue;
    } else if (inTable) {
      flushTable();
    }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.+)$/))) { flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^[-*]\s+(.+)$/))) {
      if (!inList || listType !== 'ul') { flushList(); out.push('<ul>'); inList = true; listType = 'ul'; }
      out.push('<li>' + inline(m[1]) + '</li>'); continue;
    }
    if ((m = line.match(/^\d+\.\s+(.+)$/))) {
      if (!inList || listType !== 'ol') { flushList(); out.push('<ol>'); inList = true; listType = 'ol'; }
      out.push('<li>' + inline(m[1]) + '</li>'); continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    if (/^---+$/.test(line)) { flushList(); out.push('<hr/>'); continue; }
    if (line.trim() === '') { flushList(); continue; }
    flushList();
    out.push('<p>' + inline(line) + '</p>');
  }
  flushList();
  flushTable();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

function inline(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

// --- views ---------------------------------------------------------------

const host = () => document.getElementById('view-host');

async function renderOverview() {
  host().innerHTML = '<div class="p-12 text-center text-slate-500">Loading…</div>';
  const [summary, skills, audits] = await Promise.all([get('/api/summary'), get('/api/skills'), get('/api/audits')]);
  SUMMARY = summary;

  const lastAudit = summary.latestAudit;
  const ctxNote = summary.contextDirs.length
    ? `${summary.contextFiles.length} files in ${summary.contextDirs.map((d) => `<code>${d}/</code>`).join(' + ')}`
    : 'no context dir found';

  host().innerHTML = `
    <div class="p-8 max-w-5xl">
      <div class="flex items-baseline justify-between mb-1">
        <h1 class="text-2xl font-bold">Overview</h1>
        <div class="text-xs text-slate-500 mono">${escapeHtml(summary.aosRoot)}</div>
      </div>
      <p class="text-slate-400 text-sm mb-8">State of the AOS at a glance.</p>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <div class="stat-card">
          <div class="stat-num">${skills.skills.length}</div>
          <div class="stat-label">Skills</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${summary.contextFiles.length}</div>
          <div class="stat-label">Context files</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${audits.audits.length}</div>
          <div class="stat-label">Audits</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${summary.decisionsCount}</div>
          <div class="stat-label">Decisions</div>
        </div>
      </div>

      <div class="grid md:grid-cols-2 gap-6 mb-8">
        <section>
          <div class="section-h">Workspace</div>
          <div class="text-sm text-slate-300">
            ${summary.hasClaudeMd ? '✓ <code>CLAUDE.md</code>' : '✗ no CLAUDE.md'}<br/>
            ${summary.hasAgentsMd ? '✓ <code>AGENTS.md</code>' : '✗ no AGENTS.md'}<br/>
            ${summary.skillsRootRel ? `Skills at <code>${escapeHtml(summary.skillsRootRel)}/</code>` : '<span class="text-amber-400">No skills folder found</span>'}<br/>
            <span class="text-slate-400 text-xs">${ctxNote}</span>
          </div>
        </section>
        <section>
          <div class="section-h">Latest audit</div>
          ${lastAudit
            ? `<div class="text-sm">
                 <a href="#" data-link="audits" class="text-indigo-300 hover:underline">${escapeHtml(lastAudit.name)}</a>
                 <span class="text-slate-500"> · ${new Date(lastAudit.mtime).toLocaleDateString()}</span>
               </div>`
            : `<div class="text-sm text-slate-400">No audits yet.</div>`
          }
        </section>
      </div>

      <section class="mb-8">
        <div class="section-h">Skills (${skills.skills.length})</div>
        <div class="grid md:grid-cols-2 gap-2">
          ${skills.skills.map((s) => `
            <div class="skill-card cursor-pointer" data-skill="${escapeHtml(s.folder)}">
              <div class="flex items-baseline justify-between mb-1">
                <code class="text-indigo-300 font-semibold mono">${escapeHtml(s.folder)}</code>
                <span class="text-[10px] text-slate-500 mono">${(s.bodyLength/1024).toFixed(1)}k</span>
              </div>
              <div class="text-xs text-slate-400 line-clamp-2">${escapeHtml((s.frontmatter.description || '').slice(0, 160))}</div>
            </div>`).join('')}
        </div>
      </section>
    </div>
  `;

  host().querySelectorAll('[data-link]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); switchView(el.dataset.link); }));
  host().querySelectorAll('[data-skill]').forEach((el) => el.addEventListener('click', () => switchView('skills', { focus: el.dataset.skill })));
}

async function renderSkills(opts = {}) {
  host().innerHTML = '<div class="p-12 text-center text-slate-500">Loading…</div>';
  const { skills } = await get('/api/skills');
  host().innerHTML = `
    <div class="flex h-full">
      <div class="w-72 border-r border-slate-800 overflow-y-auto p-3 flex-shrink-0">
        <div class="section-h px-2 mb-2">Skills (${skills.length})</div>
        <div id="skill-list">
          ${skills.map((s) => `
            <button data-skill="${escapeHtml(s.folder)}" class="block w-full text-left px-2 py-2 rounded hover:bg-slate-800 text-sm">
              <div class="text-indigo-300 mono font-semibold truncate">${escapeHtml(s.folder)}</div>
              <div class="text-[11px] text-slate-500 line-clamp-2 mt-0.5">${escapeHtml((s.frontmatter.description || '').slice(0, 100))}</div>
            </button>`).join('')}
        </div>
      </div>
      <div id="skill-detail" class="flex-1 overflow-y-auto"></div>
    </div>
  `;

  const detail = document.getElementById('skill-detail');
  const renderDetail = async (folder) => {
    document.querySelectorAll('#skill-list button').forEach((b) => b.classList.toggle('bg-slate-800', b.dataset.skill === folder));
    const skill = skills.find((s) => s.folder === folder);
    if (!skill) { detail.innerHTML = '<div class="p-12 text-slate-500">Skill not found.</div>'; return; }
    const file = await get('/api/file', { path: skill.path });
    detail.innerHTML = `
      <div class="p-6 max-w-4xl">
        <div class="flex items-baseline justify-between mb-1">
          <code class="text-2xl font-bold text-indigo-300 mono">${escapeHtml(skill.folder)}</code>
          <button class="cmd-pill" onclick="copyCmd(this, '/${escapeHtml(skill.frontmatter.name || skill.folder)}')">copy /${escapeHtml(skill.frontmatter.name || skill.folder)}</button>
        </div>
        <div class="text-xs text-slate-500 mono mb-6">${escapeHtml(skill.path)}</div>
        <div class="md-prev">${markdown(file.content)}</div>
        <div class="mt-8 pt-4 border-t border-slate-800 flex items-center gap-2">
          <button class="btn btn-ghost" data-edit-path="${escapeHtml(skill.path)}">Edit raw</button>
        </div>
      </div>
    `;
    detail.querySelector('[data-edit-path]').addEventListener('click', () => switchView('tree', { open: skill.path }));
  };

  host().querySelectorAll('#skill-list button').forEach((b) => b.addEventListener('click', () => renderDetail(b.dataset.skill)));

  if (skills.length) {
    const initial = opts.focus && skills.find((s) => s.folder === opts.focus) ? opts.focus : skills[0].folder;
    renderDetail(initial);
  } else {
    detail.innerHTML = '<div class="p-12 text-center text-slate-500">No skills found in this AOS.</div>';
  }
}

async function renderContext() {
  host().innerHTML = '<div class="p-12 text-center text-slate-500">Loading…</div>';
  const summary = SUMMARY || (SUMMARY = await get('/api/summary'));
  const items = [];
  // root .md/.txt
  for (const f of (summary.rootFiles || [])) items.push({ label: f.name, path: f.path });
  // contextDirs (context/, brain/)
  for (const f of (summary.contextFiles || [])) items.push({ label: f.path, path: f.path });

  if (!items.length) {
    host().innerHTML = '<div class="p-12 text-center text-slate-500">No context files found.</div>';
    return;
  }

  host().innerHTML = `
    <div class="flex h-full">
      <div class="w-80 border-r border-slate-800 overflow-y-auto p-3 flex-shrink-0">
        <div class="section-h px-2 mb-2">Context (${items.length})</div>
        <div id="ctx-list">
          ${items.map((i) => `<button data-path="${escapeHtml(i.path)}" class="block w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-sm mono text-slate-300 truncate">${escapeHtml(i.label)}</button>`).join('')}
        </div>
      </div>
      <div id="ctx-detail" class="flex-1 overflow-hidden"></div>
    </div>
  `;
  const detail = document.getElementById('ctx-detail');
  const open = async (p) => {
    document.querySelectorAll('#ctx-list button').forEach((b) => b.classList.toggle('bg-slate-800', b.dataset.path === p));
    await openEditor(detail, p);
  };
  host().querySelectorAll('#ctx-list button').forEach((b) => b.addEventListener('click', () => open(b.dataset.path)));
  open(items[0].path);
}

async function renderAudits() {
  host().innerHTML = '<div class="p-12 text-center text-slate-500">Loading…</div>';
  const { audits } = await get('/api/audits');
  if (!audits.length) {
    host().innerHTML = `
      <div class="p-12 max-w-2xl">
        <h1 class="text-2xl font-bold mb-2">Audits</h1>
        <p class="text-slate-400 text-sm mb-6">No audits yet.</p>
        <p class="text-sm">Run <span class="cmd-pill" onclick="copyCmd(this, '/audit')">/audit</span> in Claude Code from this folder. The result lands in <code class="text-indigo-300">audits/&lt;date&gt;.md</code> and shows up here.</p>
      </div>`;
    return;
  }
  host().innerHTML = `
    <div class="flex h-full">
      <div class="w-72 border-r border-slate-800 overflow-y-auto p-3 flex-shrink-0">
        <div class="section-h px-2 mb-2">Audits (${audits.length})</div>
        <div id="aud-list">
          ${audits.map((a) => `<button data-path="${escapeHtml(a.path)}" class="block w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 text-sm mono text-slate-300">${escapeHtml(a.name)}</button>`).join('')}
        </div>
      </div>
      <div id="aud-detail" class="flex-1 overflow-y-auto"></div>
    </div>
  `;
  const detail = document.getElementById('aud-detail');
  const open = async (p) => {
    document.querySelectorAll('#aud-list button').forEach((b) => b.classList.toggle('bg-slate-800', b.dataset.path === p));
    const file = await get('/api/file', { path: p });
    detail.innerHTML = `<div class="p-6 max-w-4xl"><div class="text-xs text-slate-500 mono mb-4">${escapeHtml(p)}</div><div class="md-prev">${markdown(file.content)}</div></div>`;
  };
  open(audits[0].path);
  host().querySelectorAll('#aud-list button').forEach((b) => b.addEventListener('click', () => open(b.dataset.path)));
}

async function renderTree(opts = {}) {
  host().innerHTML = '<div class="p-12 text-center text-slate-500">Loading…</div>';
  const { children } = await get('/api/tree');
  host().innerHTML = `
    <div class="flex h-full">
      <div class="w-80 border-r border-slate-800 overflow-y-auto p-3 flex-shrink-0">
        <div class="section-h px-2 mb-2">Files</div>
        <div id="tree-root"></div>
      </div>
      <div id="tree-detail" class="flex-1 overflow-hidden"></div>
    </div>
  `;
  const treeRoot = document.getElementById('tree-root');
  const detail = document.getElementById('tree-detail');
  treeRoot.appendChild(renderTreeNodes(children, async (item) => {
    document.querySelectorAll('.tree-row').forEach((r) => r.classList.toggle('active', r.dataset.path === item.path));
    await openEditor(detail, item.path);
  }));
  if (opts.open) {
    setTimeout(() => {
      const row = document.querySelector(`.tree-row[data-path="${CSS.escape(opts.open)}"]`);
      if (row) row.click();
    }, 50);
  }
}

function renderTreeNodes(items, onPick) {
  const wrap = document.createElement('div');
  if (!items) return wrap;
  for (const item of items) {
    if (item.type === 'dir') {
      const dir = document.createElement('div');
      dir.className = 'tree-node';
      const row = document.createElement('div');
      row.className = 'tree-row tree-dir';
      row.dataset.path = item.path;
      row.innerHTML = `<span class="tree-toggle">▾</span><span>${escapeHtml(item.name)}/</span>`;
      const childrenWrap = document.createElement('div');
      childrenWrap.style.paddingLeft = '14px';
      let expanded = true;
      row.addEventListener('click', () => {
        expanded = !expanded;
        childrenWrap.style.display = expanded ? '' : 'none';
        row.querySelector('.tree-toggle').textContent = expanded ? '▾' : '▸';
      });
      dir.appendChild(row);
      if (item.children && item.children.length) {
        childrenWrap.appendChild(renderTreeNodes(item.children, onPick));
      }
      dir.appendChild(childrenWrap);
      wrap.appendChild(dir);
    } else {
      const row = document.createElement('div');
      row.className = 'tree-row tree-file';
      row.dataset.path = item.path;
      row.innerHTML = `<span class="tree-toggle"> </span><span>${escapeHtml(item.name)}</span>`;
      row.addEventListener('click', () => onPick(item));
      wrap.appendChild(row);
    }
  }
  return wrap;
}

async function openEditor(host, filePath) {
  if (/\.(jpe?g|png|gif|svg|ico)$/i.test(filePath)) {
    host.innerHTML = `
      <div class="p-6 h-full overflow-auto">
        <div class="text-xs text-slate-500 mono mb-3">${escapeHtml(filePath)}</div>
        <img src="/api/file?path=${encodeURIComponent(filePath)}" class="max-w-full rounded border border-slate-800" />
      </div>`;
    return;
  }
  let file;
  try { file = await get('/api/file', { path: filePath }); }
  catch (e) { host.innerHTML = `<div class="p-12 text-center text-red-400">${escapeHtml(e.message)}</div>`; return; }
  host.innerHTML = `
    <div class="h-full flex flex-col">
      <div class="px-4 py-2 border-b border-slate-800 flex items-center gap-3 flex-shrink-0">
        <code class="text-xs mono text-slate-400 flex-1 truncate">${escapeHtml(filePath)}</code>
        <span id="dirty-flag" class="text-xs text-slate-500"></span>
        <button id="save-btn" class="btn btn-primary" disabled>Save</button>
      </div>
      <div class="flex-1 grid grid-cols-2 gap-0 overflow-hidden">
        <textarea id="ed" class="editor"></textarea>
        <div id="prev" class="md-prev p-6 overflow-auto bg-slate-950 border-l border-slate-800"></div>
      </div>
    </div>
  `;
  const ed = document.getElementById('ed');
  const prev = document.getElementById('prev');
  const dirty = document.getElementById('dirty-flag');
  const saveBtn = document.getElementById('save-btn');
  ed.value = file.content;
  prev.innerHTML = markdown(file.content);
  let original = file.content;
  let saving = false;
  let timer = null;

  const update = () => {
    prev.innerHTML = markdown(ed.value);
    const isDirty = ed.value !== original;
    dirty.textContent = isDirty ? 'unsaved' : '';
    saveBtn.disabled = !isDirty || saving;
  };
  ed.addEventListener('input', () => { update(); clearTimeout(timer); timer = setTimeout(save, 1500); });
  const save = async () => {
    if (saving || ed.value === original) return;
    saving = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      await putFile(filePath, ed.value);
      original = ed.value;
      saveBtn.textContent = 'Save';
      dirty.textContent = 'saved';
      setTimeout(() => (dirty.textContent = ''), 1500);
      toast(`Saved ${filePath}`, 'success');
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
    finally { saving = false; update(); }
  };
  saveBtn.addEventListener('click', save);
  ed.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
}

window.copyCmd = function (el, cmd) {
  navigator.clipboard.writeText(cmd).then(
    () => { el.style.color = '#34d399'; setTimeout(() => (el.style.color = ''), 800); toast('Copied: ' + cmd, 'success'); },
    () => toast('Copy failed', 'error'),
  );
};

async function renderUsage() {
  host().innerHTML = '<div class="p-12 text-center text-slate-500">Loading usage…</div>';
  const u = await get('/api/usage', { days: 60 });

  const fmt = (n) => n.toLocaleString();
  const fmtK = (n) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString());

  // Recent days first in the table
  const dailyDesc = [...u.daily].reverse();

  host().innerHTML = `
    <div class="p-8 max-w-6xl">
      <div class="flex items-baseline justify-between mb-1">
        <h1 class="text-2xl font-bold">Usage</h1>
        <div class="text-xs text-slate-500 mono">~/.claude/projects/*.jsonl + history.jsonl</div>
      </div>
      <p class="text-slate-400 text-sm mb-8">Token consumption across all Claude Code projects on this machine. Last 60 days.</p>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
        <div class="stat-card">
          <div class="stat-num">${fmtK(u.totals.last7.total)}</div>
          <div class="stat-label">Last 7 · new content</div>
          <div class="text-xs text-slate-500 mt-1">${u.totals.last7.requests} reqs · ${u.totals.last7.messages} msgs</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${fmtK(u.totals.last30.total)}</div>
          <div class="stat-label">Last 30 · new content</div>
          <div class="text-xs text-slate-500 mt-1">${u.totals.last30.requests} reqs · ${u.totals.last30.messages} msgs</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${fmtK(u.totals.last60.total)}</div>
          <div class="stat-label">Last 60 · new content</div>
          <div class="text-xs text-slate-500 mt-1">${u.totals.last60.requests} reqs · ${u.totals.last60.messages} msgs</div>
        </div>
        <div class="stat-card">
          <div class="stat-num text-emerald-400">${fmtK(u.totals.last7.cacheRead)}</div>
          <div class="stat-label">Last 7 · cache-read (re-reads)</div>
          <div class="text-xs text-slate-500 mt-1">billed at ~10% of normal rate</div>
        </div>
      </div>
      <p class="text-xs text-slate-500 mb-2">
        <strong class="text-slate-400">"New content"</strong> = input + cache-create + output (the tokens that actually represent fresh work).
        <strong class="text-slate-400">Cache-read</strong> is the same prompt content re-read each turn — high cache-read means caching is working; it's a savings indicator, not a usage figure.
      </p>
      <p class="text-xs mb-10 ${u.sources.anthropic.available ? 'text-emerald-400' : 'text-amber-400'}">
        ${u.sources.anthropic.available
          ? `✓ Showing Anthropic Admin API data for ${u.sources.anthropic.dayCount} days${u.sources.anthropic.cached ? ' (cached)' : ''} + local jsonl. Days outside the API window fall back to local-only.`
          : `⚠ Local jsonl only (${u.sources.anthropic.reason}). To pull historical months from Anthropic, add an admin API key — see <code>dashboard/.env.example</code>.`}
      </p>

      <section class="mb-10">
        <div class="section-h">Daily — last 60 days</div>
        <div class="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <canvas id="dailyChart" height="100"></canvas>
        </div>
      </section>

      <div class="grid md:grid-cols-2 gap-6 mb-10">
        <section>
          <div class="section-h">Weekly</div>
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 text-xs border-b border-slate-800"><th class="py-1">Week of</th><th>Total</th><th>Output</th><th>Requests</th></tr></thead>
            <tbody>
              ${[...u.weekly].reverse().map((w) => `<tr class="border-b border-slate-900"><td class="py-1.5 mono text-slate-300">${w.period}</td><td class="mono">${fmtK(w.total)}</td><td class="mono text-slate-400">${fmtK(w.output)}</td><td class="mono text-slate-500">${w.requests}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>
        <section>
          <div class="section-h">Monthly</div>
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 text-xs border-b border-slate-800"><th class="py-1">Month</th><th>Total</th><th>Output</th><th>Requests</th><th>Active days</th></tr></thead>
            <tbody>
              ${[...u.monthly].reverse().map((m) => `<tr class="border-b border-slate-900"><td class="py-1.5 mono text-slate-300">${m.period.slice(0,7)}</td><td class="mono">${fmtK(m.total)}</td><td class="mono text-slate-400">${fmtK(m.output)}</td><td class="mono text-slate-500">${m.requests}</td><td class="mono text-slate-500">${m.days}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <div class="section-h">Daily detail (recent first)</div>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 text-xs border-b border-slate-800">
            <th class="py-1">Date</th><th>Total</th><th>Input</th><th>Cache-read</th><th>Output</th><th>Reqs</th><th>Msgs</th><th>Projects</th>
          </tr></thead>
          <tbody>
            ${dailyDesc.filter((d) => d.requests > 0 || d.messages > 0).map((d) => `
              <tr class="border-b border-slate-900 ${d.requests > 0 ? '' : 'opacity-50'}">
                <td class="py-1.5 mono text-slate-300">${d.date}</td>
                <td class="mono">${fmtK(d.total)}</td>
                <td class="mono text-slate-400">${fmtK(d.input)}</td>
                <td class="mono text-slate-500">${fmtK(d.cacheRead)}</td>
                <td class="mono text-slate-400">${fmtK(d.output)}</td>
                <td class="mono text-slate-500">${d.requests}</td>
                <td class="mono text-slate-500">${d.messages}</td>
                <td class="text-xs text-slate-400">${d.projects.map((p) => `<code class="text-[10px]">${escapeHtml(p)}</code>`).join(' ')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${dailyDesc.filter((d) => d.requests > 0 || d.messages > 0).length === 0 ? '<p class="text-sm text-slate-500 mt-3">No activity in the last 60 days.</p>' : ''}
      </section>
    </div>
  `;

  // Render chart
  // Two stacks side-by-side per day: "new" (input + cacheCreate + output) and "cacheRead" (the re-read indicator).
  // Putting cacheRead in its own stack stops it from drowning the new-content bars visually.
  const ctx = document.getElementById('dailyChart');
  if (ctx && window.Chart) {
    const labels = u.daily.map((d) => d.date.slice(5)); // MM-DD
    new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Output', data: u.daily.map((d) => d.output), backgroundColor: '#a855f7', stack: 'new' },
          { label: 'Input', data: u.daily.map((d) => d.input), backgroundColor: '#6366f1', stack: 'new' },
          { label: 'Cache-create', data: u.daily.map((d) => d.cacheCreate), backgroundColor: '#0ea5e9', stack: 'new' },
          { label: 'Cache-read (re-reads, ~10% rate)', data: u.daily.map((d) => d.cacheRead), backgroundColor: '#22c55e80', stack: 'reads' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#cbd5e1', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ${c.raw.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 10 } }, stacked: true, grid: { color: '#1e293b' } },
          y: {
            ticks: {
              color: '#64748b',
              font: { size: 10 },
              callback: (v) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v,
            },
            stacked: true,
            grid: { color: '#1e293b' },
          },
        },
      },
    });
  }
}

const views = {
  overview: renderOverview,
  skills: renderSkills,
  context: renderContext,
  audits: renderAudits,
  tree: renderTree,
  usage: renderUsage,
};

function switchView(name, opts = {}) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  const fn = views[name];
  if (fn) fn(opts);
}

async function init() {
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  try {
    SUMMARY = await get('/api/summary');
    document.getElementById('aos-root-display').textContent = SUMMARY.aosRoot;
    document.getElementById('skills-root-display').textContent = SUMMARY.skillsRootRel || '—';
    document.getElementById('onboarded-status').textContent = SUMMARY.onboarded ? '✓ yes' : '✗ pending';
    document.getElementById('onboarded-status').className = 'mono ' + (SUMMARY.onboarded ? 'text-emerald-400' : 'text-amber-400');
    document.getElementById('nav-skills-count').textContent = SUMMARY.skillsCount;
    document.getElementById('nav-context-count').textContent = SUMMARY.contextFiles.length;
    document.getElementById('nav-audits-count').textContent = SUMMARY.auditsCount;
  } catch (e) { console.error(e); }
  switchView('overview');
}

init();
