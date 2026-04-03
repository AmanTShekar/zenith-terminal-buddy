export const PANEL_JS = `
(function() {
  'use strict';
  const vsc = acquireVsCodeApi();
  const T3 = '\\x60\\x60\\x60', T1 = '\\x60';
  let streamEl = null;
  let pendingCmd = null;
  let currentLogData = [];
  let terminalsMap = {};

  const petEmojis = {
    cat: { happy: '😸', worried: '😿', sleeping: '😴', excited: '🙀', scared: '🫣', neutral: '🐱' },
    dog: { happy: '🐶', worried: '🥺', sleeping: '💤', excited: '🐕', scared: '😰', neutral: '🐕' },
    robot: { happy: '🤖', worried: '⚠️', sleeping: '💤', excited: '🚀', scared: '🔧', neutral: '🤖' },
    ghost: { happy: '👻', worried: '😶‍🌫️', sleeping: '💤', excited: '🎃', scared: '💀', neutral: '👻' }
  };

  // ── Helpers ──
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  
  function md(t) {
    if (!t) return '';
    try {
      let p = t.split(T3), o = '';
      for (let i = 0; i < p.length; i++) {
        if (i % 2 === 1) {
          o += '<pre><code>' + esc(p[i].replace(/^\\w+\\n/, '').trim()) + '</code></pre>';
        } else {
          let s = esc(p[i]);
          s = s.replace(/\\[LIVE:([^\\]]+)\\]/g, (m, id) => {
            const term = terminalsMap[id];
            if (!term) return \`<span class="dim">[Terminal \${id} stopped]</span>\`;
            return \`<div class="chat-live-card">
              <div class="chat-live-header">
                <span>📺 \${esc(term.name)}</span>
                <span class="dim">ID: \${esc(id)}</span>
              </div>
              <div class="chat-live-btns">
                <button class="chat-live-btn chat-live-focus" data-id="\${esc(id)}"><span class="chat-live-icon">🎯</span> Focus</button>
                <button class="chat-live-btn chat-live-kill" data-id="\${esc(id)}"><span class="chat-live-icon">💀</span> Kill</button>
                \${term.port ? \`<button class="chat-live-btn chat-live-link" data-url="http://localhost:\${term.port}"><span class="chat-live-icon">🌐</span> Port \${term.port}</button>\` : ''}
              </div>
            </div>\`;
          });
          s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>\$1</strong>');
          s = s.replace(/\\*([^*]+)\\*/g, '<em>\$1</em>');
          s = s.replace(new RegExp(T1 + '([^' + T1 + ']+)' + T1, 'g'), '<code>\$1</code>');
          s = s.replace(/\\n/g, '<br>');
          o += s;
        }
      }
      return o;
    } catch (e) { return esc(t); }
  }

  function ago(ts) {
    if (!ts) return '';
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return d + 's ago';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    return Math.floor(d / 3600) + 'h ago';
  }

  function badge(n) { return n > 0 ? \`<span class="tab-badge">\${n}</span>\` : '' }

  // ── Tabs ──
  let errCount = 0;
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const id = 'panel-' + tab.dataset.tab;
      const panel = document.getElementById(id);
      if (panel) panel.classList.add('active');
      if (tab.dataset.tab === 'log') { errCount = 0; updateErrTab(); }
    });
  });

  function updateErrTab() { 
    const t = document.querySelector('[data-tab="log"]'); 
    if (t) t.innerHTML = 'Log' + (errCount > 0 ? badge(errCount) : ''); 
  }

  // ── Pet ──
  function updatePet(s) {
    const em = document.getElementById('pet-emoji');
    const mo = document.getElementById('pet-mood');
    const lv = document.getElementById('pet-lv');
    const fill = document.getElementById('xp-fill');
    const name = document.getElementById('pet-name');
    if (s.type && s.mood) {
      const emo = petEmojis[s.type]?.[s.mood] || '🐱';
      if (em) em.textContent = emo;
    }
    if (mo) mo.textContent = s.mood || 'ready';
    if (lv) lv.textContent = 'Lv.' + (s.level || 1);
    if (name) name.textContent = s.name || 'Buddy';
    if (fill) fill.style.width = (s.xp % 100) + '%';
  }

  // ── Chat ──
  const chatMsgs = document.getElementById('chat-msgs');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  function appendMsg(html, role) {
    if (!chatMsgs) return null;
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    if (typeof html === 'string' && (role === 'user' || role.includes('thinking'))) d.innerHTML = esc(html);
    else if (typeof html === 'string') d.innerHTML = html;
    chatMsgs.appendChild(d);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
    return d;
  }

  function sendChat() {
    const txt = (chatInput.value || '').trim();
    if (!txt) return;
    appendMsg(txt, 'user');
    chatInput.value = ''; 
    chatInput.style.height = 'auto';
    vsc.postMessage({ type: 'askBuddy', payload: txt });
  }

  if (sendBtn) sendBtn.addEventListener('click', sendChat);
  if (chatInput) {
    chatInput.addEventListener('keydown', e => { 
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } 
    });
    chatInput.addEventListener('input', () => { 
      chatInput.style.height = 'auto'; 
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px'; 
    });
  }

  // ── Log ──
  function updateTermFilter(logs) {
    if (!logs) return;
    const sel = document.getElementById('term-filter');
    if (!sel) return;
    const activeTerm = sel.value;
    const terms = new Set();
    logs.forEach(l => { if (l.terminalName) terms.add(l.terminalName); });
    let h = '<option value="all">All Terms</option>';
    Array.from(terms).sort().forEach(t => {
      h += \`<option value="\${esc(t)}">\${esc(t)}</option>\`;
    });
    sel.innerHTML = h;
    sel.value = activeTerm;
  }

  function renderLog(logs) {
    if (!logs) return;
    currentLogData = logs;
    updateTermFilter(logs);
    const list = document.getElementById('log-list');
    const search = (document.getElementById('log-search')?.value || '').toLowerCase();
    const termF = document.getElementById('term-filter')?.value || 'all';
    const statF = document.getElementById('status-filter')?.value || 'all';

    const filtered = logs.filter(e => {
      const matchesSearch = e.cmd.toLowerCase().includes(search) || (e.projectName || '').toLowerCase().includes(search);
      const matchesTerm = termF === 'all' || e.terminalName === termF;
      const matchesStatus = statF === 'all' || (statF === 'err' && e.status === 'error') || (statF === 'warn' && e.status === 'warning') || (statF === 'ok' && e.status === 'ok');
      return matchesSearch && matchesTerm && matchesStatus;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No matching logs.</div></div>';
      return;
    }

    list.innerHTML = filtered.reverse().map(e => {
      const cls = e.status === 'ok' ? 'ok' : e.status === 'warning' ? 'warn' : 'err';
      const icon = cls === 'ok' ? '✓' : cls === 'warn' ? '⚠' : '✗';
      return \`
        <div class="entry \${cls}" data-entry='\${esc(JSON.stringify(e))}'>
          <div class="entry-header">
            <div class="entry-status-icon">\${icon}</div>
            <div class="entry-summary">
              <div class="entry-cmd-text">\${esc(e.cmd)}</div>
              <div class="entry-sub">
                <span>\${ago(e.timestamp)}</span>
                <span>•</span>
                <span>\${esc(e.terminalName || 'terminal')}</span>
              </div>
            </div>
          </div>
          <div class="entry-details">
            <div class="entry-full-cmd">\${esc(e.cmd)}</div>
            \${e.errorOutput ? '<div style="font-size:10px; color:var(--dim); margin-top:8px; opacity:0.7">Snippet: ' + esc(e.errorOutput.slice(0, 80)) + '...</div>' : ''}
            <div class="entry-footer">
              \${e.errorOutput ? '<button class="btn-sm focus ask-explain-btn">🤖 Ask Buddy</button>' : ''}
            </div>
          </div>
        </div>\`;
    }).join('');
  }

  document.getElementById('log-search')?.addEventListener('input', () => renderLog(currentLogData));
  document.getElementById('term-filter')?.addEventListener('change', () => renderLog(currentLogData));
  document.getElementById('status-filter')?.addEventListener('change', () => renderLog(currentLogData));
  document.getElementById('filter-toggle-btn')?.addEventListener('click', () => {
    document.getElementById('log-filters-box')?.classList.toggle('show');
    document.getElementById('filter-toggle-btn')?.classList.toggle('active');
  });

  document.getElementById('log-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.ask-explain-btn');
    if (btn) {
      const entry = btn.closest('.entry');
      if (entry) {
        try {
          const data = JSON.parse(entry.dataset.entry || '{}');
          document.querySelector('[data-tab="chat"]')?.click();
          vsc.postMessage({ type: 'explainEntry', payload: data });
        } catch (err) {}
      }
      return;
    }
    const entry = e.target.closest('.entry');
    if (entry) entry.classList.toggle('expanded');
  });

  // ── Live ──
  function renderLive(cmds) {
    const c = document.getElementById('live-list');
    if (!c) return;
    if (!cmds || !cmds.length) {
      c.innerHTML = '<div class="empty"><div class="empty-icon">⚡</div><div class="empty-text">No active commands.</div></div>';
      return;
    }
    c.innerHTML = cmds.map(cmd => \`<div class="live-entry">
      <div class="live-info" style="display:flex;align-items:center;gap:10px">
        <div class="spin"></div>
        <div style="flex:1;min-width:0">
          <div class="entry-cmd" style="font-family:var(--mono);font-size:11px">\${esc(cmd.cmd || 'Running…')}</div>
          <div class="live-status" style="font-size:10px;color:var(--dim)">
            <span>\${ago(cmd.startTime)}</span>
            <span>•</span>
            <span>PID: \${cmd.pid || '?'}</span>
          </div>
        </div>
      </div>
      <div class="live-btns" style="display:flex;gap:6px;margin-top:6px">
        <button class="btn-sm kill live-kill-btn" data-id="\${cmd.terminalId}">⏹ End</button>&nbsp;
        <button class="btn-sm focus live-focus-btn" data-id="\${cmd.terminalId}">👁 Focus</button>
        \${cmd.port ? \`&nbsp;<button class="btn-sm link live-link-btn" data-url="http://localhost:\${cmd.port}">🚀 Link</button>\` : ''}
      </div>
    </div>\`).join('');
  }

  document.getElementById('live-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-sm');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('live-kill-btn')) vsc.postMessage({ type: 'killTerminal', payload: id });
    if (btn.classList.contains('live-focus-btn')) vsc.postMessage({ type: 'focusTerminal', payload: id });
    if (btn.classList.contains('live-link-btn')) vsc.postMessage({ type: 'openExternal', payload: btn.dataset.url });
  });

  // ── Ports ──
  function renderPorts(ports) {
    const c = document.getElementById('ports-list');
    if (!c) return;
    if (!ports || !ports.length) {
      c.innerHTML = '<div class="empty"><div class="empty-icon">🔌</div><div class="empty-text">No dev servers detected.</div></div>';
      return;
    }
    c.innerHTML = ports.map(p => \`
      <div class="card" style="display:flex;align-items:center;gap:10px">
        <div class="dot"></div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600">:\${p.port}</div>
          <div style="font-size:10px;color:var(--dim)">\${esc(p.label || 'Active')}</div>
        </div>
        \${p.pid ? \`<button class="kill-btn" data-port="\${p.port}" data-pid="\${p.pid}">Kill</button>\` : ''}
      </div>\`).join('');
  }

  document.getElementById('ports-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.kill-btn');
    if (btn) vsc.postMessage({ type: 'killPort', payload: { port: +btn.dataset.port, pid: +btn.dataset.pid } });
  });

  // ── Git ──
  function renderGit(payload) {
    const c = document.getElementById('git-content');
    if (!c) return;
    if (!payload) {
      c.innerHTML = '<div class="empty"><div class="empty-icon">🌿</div><div class="empty-text">No git repository detected.</div></div>';
      return;
    }
    const existingTree = c.querySelector('.git-tree-container')?.innerHTML;
    let h = \`<div class="branch-badge">🌿 \${esc(payload.branch || '?')}\`;
    if (payload.aheadCount > 0) h += \` · <span style="color:var(--ok)">↑\${payload.aheadCount}</span>\`;
    if (payload.behindCount > 0) h += \` · <span style="color:var(--warn)">↓\${payload.behindCount}</span>\`;
    if (payload.uncommittedCount > 0) h += \` · <span style="color:var(--warn)">\${payload.uncommittedCount} changed</span>\`;
    h += '</div>';

    function renderNode(node, depth = 0) {
      if (!node) return '';
      let html = '';
      if (node.name !== 'root') {
        const isFolder = node.children && node.children.length > 0;
        if (isFolder) {
          const folderStatus = node.status !== 'clean' ? \`status-\${node.status}\` : '';
          html += \`<div class="tree-node folder \${folderStatus}" style="margin-left:\${depth * 8}px">📁 \${esc(node.name)}</div>\`;
        } else {
          const stRaw = (node.status || '').trim().charAt(0).toUpperCase();
          const stClass = stRaw === 'M' ? 'M' : stRaw === 'A' ? 'A' : stRaw === 'D' ? 'D' : '';
          html += \`<div class="tree-node file" style="margin-left:\${depth * 8}px">
            <div class="git-file">
              <span class="git-s \${stClass}">\${esc(stRaw || ' ')}</span>
              <span class="file-name" style="\${stClass ? \`color: var(--\${stClass === 'M' ? 'warn' : stClass === 'A' ? 'ok' : 'err'})\` : ''}">\${esc(node.name)}</span>
            </div>
          </div>\`;
        }
      }
      if (node.children) {
        node.children.forEach(ch => html += renderNode(ch, node.name === 'root' ? 0 : depth + 1));
      }
      return html;
    }

    if (payload.tree) {
      h += '<div class="git-tree-container" style="margin-bottom:12px; border-top:1px solid var(--border); padding-top:4px;">';
      h += renderNode(payload.tree);
      h += '</div>';
    } else if (existingTree) {
      h += '<div class="git-tree-container" style="margin-bottom:12px; border-top:1px solid var(--border); padding-top:4px;">' + existingTree + '</div>';
    }
    if (payload.lastCommitMessage) h += \`<div style="font-size:10px;color:var(--dim);margin-bottom:6px">Last: \${esc(payload.lastCommitMessage)} · \${esc(payload.lastCommitTime)}</div>\`;
    if (payload.guide) h += \`<div class="git-tip">\${md(payload.guide)}</div>\`;
    c.innerHTML = h;
  }

  // ── Pkgs ──
  function renderPkgs(list) {
    const c = document.getElementById('pkgs-list');
    if (!c) return;
    if (!list || !list.length) {
      c.innerHTML = '<div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No scripts found.</div></div>';
      return;
    }
    const groups = {};
    list.forEach(i => { const g = i.group || 'Other'; if (!groups[g]) groups[g] = []; groups[g].push(i); });
    const typeIcon = { npm: '📦', python: '🐍', script: '⚙️', binary: '🐳', go: '🐹' };
    let h = '';
    Object.keys(groups).sort((a, b) => a === 'Root' ? -1 : b === 'Root' ? 1 : a.localeCompare(b)).forEach(g => {
      h += \`<div class="pkg-header">\${esc(g)}</div>\`;
      groups[g].forEach(item => {
        h += \`<div class="card"><div class="pkg-row"><span class="pkg-name" title="\${esc(item.command)}">\${esc(item.name)}</span><span class="pkg-type">\${typeIcon[item.type] || '▶'}</span><button class="run-btn" data-cmd="\${esc(item.command)}" data-path="\${esc(item.path)}">▶ Run</button></div></div>\`;
      });
    });
    c.innerHTML = h;
  }

  document.getElementById('pkgs-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.run-btn');
    if (btn) vsc.postMessage({ type: 'runExecutable', payload: { command: btn.dataset.cmd, path: btn.dataset.path, name: btn.dataset.cmd } });
  });

  // ── AI ──
  function updateAiInfo(info) {
    const b = document.getElementById('ai-badge');
    if (!b || !info) return;
    const txt = \`\${(info.provider || 'AI').toUpperCase()} · \${info.model || ''}\`;
    b.textContent = txt.length > 22 ? txt.slice(0, 19) + '…' : txt;
    b.title = txt;
  }

  function renderExplanation(ex) {
    if (!ex) return;
    const el = document.getElementById("ai-expl");
    if (el) {
      el.innerHTML = \`<div class="explain-card">
        <div class="ec-label">Analysis</div>
        <div>\${md(ex.summary || '')}</div>
        \${ex.fix ? \`<div class="ec-fix"><strong>Fix:</strong> \${md(ex.fix)}</div>\` : ""}
      </div>\`;
      el.style.display = "block";
      el.scrollIntoView({ behavior: "smooth" });
    }
  }

  document.getElementById('chat-msgs')?.addEventListener('click', e => {
    const rb = e.target.closest('.run-cmd-btn');
    if (rb) vsc.postMessage({ type: 'runCommand', payload: rb.dataset.cmd });
    const lb = e.target.closest('.chat-live-btn');
    if (lb) {
      const id = lb.dataset.id;
      const url = lb.dataset.url;
      if (lb.classList.contains('chat-live-focus')) vsc.postMessage({ type: 'focusTerminal', payload: id });
      else if (lb.classList.contains('chat-live-kill')) vsc.postMessage({ type: 'killTerminal', payload: id });
      else if (lb.classList.contains('chat-live-link')) vsc.postMessage({ type: 'openExternal', payload: url });
    }
  });

  // ── Explorer ──
  function renderExplorer(tree) {
    const c = document.getElementById('explorer-tree');
    if (!c) return;
    if (!tree || !tree.length) {
      c.innerHTML = '<div class="empty"><div class="empty-icon">📁</div><div class="empty-text">Empty workspace.</div></div>';
      return;
    }
    function buildNode(n, depth = 0) {
      const isDir = n.type === 'directory';
      const icon = isDir ? '📁' : '📄';
      let h = \`<div class="tree-item \${isDir ? 'folder' : 'file'}" style="padding-left: \${depth * 12}px" data-path="\${esc(n.path)}">
        <span class="item-icon">\${icon}</span>
        <span class="item-name">\${esc(n.name)}</span>
      </div>\`;
      if (isDir && n.children) {
        n.children.sort((a, b) => (a.type === b.type) ? a.name.localeCompare(b.name) : (a.type === 'directory' ? -1 : 1))
          .forEach(ch => h += buildNode(ch, depth + 1));
      }
      return h;
    }
    c.innerHTML = tree.map(n => buildNode(n)).join('');
  }

  document.getElementById('explorer-tree')?.addEventListener('click', e => {
    const item = e.target.closest('.tree-item');
    if (item) vsc.postMessage({ type: 'openFile', payload: item.dataset.path });
  });

  document.getElementById('ai-mover-input')?.addEventListener('input', e => {
    const query = e.target.value.trim().toLowerCase();
    if (query.startsWith('go ') || query.startsWith('cd ')) return;
    const items = document.querySelectorAll('.tree-item');
    items.forEach(item => {
      const name = item.querySelector('.item-name')?.textContent?.toLowerCase() || '';
      item.classList.toggle('hidden', query !== '' && !name.includes(query));
    });
  });

  document.getElementById('ai-mover-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      if (!query) return;
      if (query.startsWith('go ') || query.startsWith('cd ') || query.includes(' to ')) {
        vsc.postMessage({ type: 'aiMoveDirectory', payload: query });
        e.target.value = '';
        e.target.placeholder = 'Moving...';
      }
    }
  });

  // ── Terminal Selector ──
  function renderTerminalSelector(data) {
    const list = document.getElementById('terminal-selector');
    if (!list) return;
    terminalsMap = {};
    data.forEach(t => terminalsMap[t.id] = t);
    list.innerHTML = data.map(t => \`
      <div class="terminal-card \${t.active ? 'active' : ''}">
        <div class="term-header">
          <div class="term-name">\${esc(t.name)}</div>
          <div class="term-status \${t.isExecuting ? 'executing' : ''}"></div>
        </div>
        <div class="term-purpose">\${esc(t.purpose)}</div>
        \${t.port ? \`<a href="http://localhost:\${t.port}" style="font-size:10px; color:var(--accent); display:block; margin:4px 0;">🚀 Open http://localhost:\${t.port}</a>\` : ''}
        <div class="term-actions" style="display:flex;gap:6px;margin-top:6px">
          <button class="btn-sm focus term-focus-btn" data-id="\${t.id}">👁 Focus</button>&nbsp;
          <button class="btn-sm kill term-kill-btn" data-id="\${t.id}">⏹ Kill</button>
        </div>
      </div>\`).join('');
  }

  document.getElementById('terminal-selector')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-sm');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('term-focus-btn')) vsc.postMessage({ type: 'focusTerminal', payload: id });
    if (btn.classList.contains('term-kill-btn')) vsc.postMessage({ type: 'killTerminal', payload: id });
  });

  // ── Stats ──
  function updateStats(s) {
    const ok = document.getElementById('st-ok');
    const err = document.getElementById('st-err');
    const tot = document.getElementById('st-total');
    if (ok) ok.querySelector('.st-val').textContent = s.ok || 0;
    if (err) err.querySelector('.st-val').textContent = s.error || 0;
    if (tot) tot.querySelector('.st-val').textContent = s.total || 0;
  }

  // ── Message Router ──
  let hatched = false;
  window.addEventListener('message', evt => {
    const msg = evt.data; if (!msg || !msg.type) return;
    if (!hatched) {
      hatched = true;
      const em = document.getElementById('pet-emoji');
      const mo = document.getElementById('pet-mood');
      if (em && (em.textContent === '🥚' || em.textContent === 'Hatching...')) em.textContent = '🐱';
      if (mo && mo.textContent.toLowerCase().includes('hatch')) mo.textContent = 'ready';
    }
    try {
      switch (msg.type) {
        case 'updateLog': renderLog(msg.payload); break;
        case 'updatePetState': updatePet(msg.payload); break;
        case 'updateActiveCommands': renderLive(msg.payload); break;
        case 'updatePorts': renderPorts(msg.payload); break;
        case 'updateGitStatus': renderGit(msg.payload); break;
        case 'updateTerminalSelector': renderTerminalSelector(msg.payload); break;
        case 'updateGitTree': renderGit(msg.payload); break;
        case 'updateExecutables': renderPkgs(msg.payload); break;
        case 'updateStats': updateStats(msg.payload); break;
        case 'updateAiInfo': updateAiInfo(msg.payload); break;
        case 'updateWorkspaceMap': if (msg.payload.fileTree) renderExplorer([msg.payload.fileTree]); break;
        case 'aiThinking': streamEl = appendMsg('…', 'buddy thinking'); break;
        case 'aiStreamChunk':
          if (!streamEl) streamEl = appendMsg('', 'buddy');
          if (streamEl.classList.contains('thinking')) {
            streamEl.classList.remove('thinking');
            streamEl.dataset.raw = '';
            streamEl.innerHTML = '';
          }
          streamEl.dataset.raw = (streamEl.dataset.raw || '') + (msg.payload || '');
          streamEl.innerHTML = md(streamEl.dataset.raw);
          chatMsgs.scrollTop = chatMsgs.scrollHeight; break;
        case 'aiStreamDone':
          if (streamEl) { streamEl.classList.remove('thinking'); streamEl.innerHTML = md(streamEl.dataset.raw || ''); }
          streamEl = null; break;
        case 'aiExplanation': renderExplanation(msg.payload); break;
        case 'warning': {
          const wb = document.getElementById('warn-bar');
          if (wb) { wb.textContent = msg.payload; wb.style.display = 'block'; setTimeout(() => wb.style.display = 'none', 5000); }
          break;
        }
        case 'safetyAlert': {
          const ov = document.getElementById('safety-overlay');
          const sm = document.getElementById('safety-msg');
          const sc = document.getElementById('safety-cmd-preview');
          if (ov && sm && sc) {
            pendingCmd = msg.payload.cmd;
            sm.textContent = msg.payload.alert?.explanation || 'Safety risk detected.';
            sc.textContent = msg.payload.cmd;
            ov.classList.add('show');
          } break;
        }
      }
    } catch (e) { console.error('Buddy Webview Error:', e); }
  });

  // ── Safety Buttons ──
  document.getElementById('s-cancel')?.addEventListener('click', () => { document.getElementById('safety-overlay')?.classList.remove('show'); pendingCmd = null; });
  document.getElementById('s-run')?.addEventListener('click', () => { if (pendingCmd) vsc.postMessage({ type: 'runCommand', payload: pendingCmd }); document.getElementById('safety-overlay')?.classList.remove('show'); pendingCmd = null; });

  // ── Handshake ──
  vsc.postMessage({ type: 'ready' });
})();
\`;
