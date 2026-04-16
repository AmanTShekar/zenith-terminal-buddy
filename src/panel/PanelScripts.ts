export const PANEL_JS = `
(function() {
  console.log('[Terminal Buddy] Script Initializing...');
  var vsc = acquireVsCodeApi();
  var hatched = false;
  var streamEl = null;

  function safeSet(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function doHatch() {
    if (hatched) return;
    hatched = true;
    console.log('[Terminal Buddy] Hatching Pet...');
    var emo = document.getElementById('pet-emoji');
    var mod = document.getElementById('pet-mood');
    if (emo && (emo.textContent === '🥚' || !emo.textContent)) emo.textContent = '🐱';
    if (mod && (mod.textContent === 'Hatching...' || !mod.textContent)) mod.textContent = 'Ready';
  }

  setTimeout(doHatch, 2000);

  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || !msg.type) return;
    console.log('[Terminal Buddy] Received:', msg.type);

    if (!hatched && (msg.type === 'init' || msg.type === 'updatePetState' || msg.type === 'updateLog' || msg.type === 'updateConfig')) {
      doHatch();
    }

    try {
      switch (msg.type) {
        case 'updateConfig': updateSettingsUI(msg.payload); break;
        case 'updateLog': renderLog(msg.payload || []); break;
        case 'updatePetState': updatePetUI(msg.payload); break;
        case 'updateActiveCommands': renderLive(msg.payload); break;
        case 'updatePorts': renderPorts(msg.payload || []); break;
        case 'updateGitTree': renderGit(msg.payload); break;
        case 'updateTerminalSelector': updateTerminals(msg.payload || []); break;
        case 'updateExecutables': renderPkgs(msg.payload || []); break;
        case 'updateAiInfo': updateAiStatus(msg.payload); break;
        case 'updateWorkspaceMap': renderExplorer(msg.payload); break;
        case 'updateUsage': renderUsage(msg.payload); break;
        case 'updateVault': renderVault(msg.payload || []); break;
        case 'updateJira': renderJira(msg.payload); break;
        case 'aiThinking': showThinking(); break;
        case 'aiStreamChunk': handleStream(msg.payload); break;
        case 'aiStreamDone': finalizeStream(); break;
        case 'aiExplanation': renderExplanation(msg.payload); break;
        case 'agentThought': showThought(msg.payload); break;
        case 'warning': showWarn(msg.payload); break;
        case 'showSafetyOverlay': showSafety(msg.payload); break;
        case 'hideSafetyOverlay': hideSafety(); break;
      }
    } catch (err) { console.error('[Terminal Buddy] Router Error:', err); }
  });

  function vscAction(type, id, extra) {
    vsc.postMessage({ type: type, payload: id, extra: extra });
  }

  // --- Event Listeners ---------------------------------------------------

  document.addEventListener('click', function(e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.id === 's-run') { vsc.postMessage({ type: 'runDangerousCommand' }); return; }
      if (t.id === 's-cancel') { hideSafety(); return; }
      
      if (t.id === 'zenith-center-btn') {
        vsc.postMessage({ type: 'openZenithCenter' });
        return;
      }
      
      var act = t.getAttribute('data-action');
      if (act) {
        if (act === 'tab') {
          switchTab(t);
        } else if (act === 'openZenithCenter') {
          vsc.postMessage({ type: 'openZenithCenter' });
        } else if (act === 'selectProvider') {
          var pid = t.getAttribute('data-id');
          vsc.postMessage({ type: 'updateSetting', payload: { key: 'aiProvider', value: pid } });
        } else {
          vscAction(act, t.getAttribute('data-id'), t.getAttribute('data-extra'));
        }
        e.stopPropagation();
        return;
      }
      t = t.parentNode;
    }
  });

  function switchTab(el) {
    var tab = el.getAttribute('data-tab');
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    el.classList.add('active');
    var p = document.getElementById('panel-' + tab);
    if (p) p.classList.add('active');
    if (tab === 'usage') vsc.postMessage({ type: 'getUsage' });
    if (tab === 'vault') vsc.postMessage({ type: 'getVault' });
  }

  // Settings Interaction
  document.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var key = cb.id.replace('setting-', '');
      vsc.postMessage({ type: 'updateSetting', payload: { key: key, value: cb.checked } });
    });
  });

  document.querySelectorAll('input[type="text"], input[type="password"], select').forEach(function(inp) {
    inp.addEventListener('change', function() {
      if (inp.classList.contains('p-key')) {
        var prov = inp.getAttribute('data-provider');
        var val = inp.value.trim();
        if (val) vsc.postMessage({ type: 'updateProviderKey', payload: { provider: prov, key: val } });
      } else if (inp.id.startsWith('setting-')) {
        var key = inp.id.replace('setting-', '');
        var val = inp.value.trim();
        if (key === 'endpoint' && (val.startsWith('gsk_') || val.startsWith('sk-'))) {
           showWarn('Invalid Endpoint: Do not paste API keys here!');
           inp.value = '';
           return;
        }
        vsc.postMessage({ type: 'updateSetting', payload: { key: key, value: val } });
      }
    });
  });

  // Auto-detect keys on paste
  document.addEventListener('paste', function(e) {
    var text = (e.clipboardData || window.clipboardData).getData('text').trim();
    var detected = null;
    if (text.startsWith('gsk_')) detected = 'groq';
    else if (text.startsWith('sk-ant-')) detected = 'claude';
    else if (text.startsWith('sk-')) detected = 'openai';
    else if (text.length > 30 && /^[A-Za-z0-9_-]+$/.test(text)) detected = 'gemini';

    if (detected) {
      console.log('[Terminal Buddy] Detected key for:', detected);
      vsc.postMessage({ type: 'updateProviderKey', payload: { provider: detected, key: text } });
      vsc.postMessage({ type: 'updateSetting', payload: { key: 'aiProvider', value: detected } });
      showWarn('Detected ' + detected + ' key and updated settings! ✨');
    }
  });

  function updateSettingsUI(c) {
    if (!c) return;
    if (c.enabled !== undefined) document.getElementById('setting-enabled').checked = c.enabled;
    if (c.petEnabled !== undefined) document.getElementById('setting-petEnabled').checked = c.petEnabled;
    if (c.petName) document.getElementById('setting-petName').value = c.petName;
    if (c.petType) document.getElementById('setting-petType').value = c.petType;
    if (c.endpoint) document.getElementById('setting-endpoint').value = c.endpoint;

    // New settings
    if (c.autoRunSuggestions !== undefined) document.getElementById('setting-autoRunSuggestions').checked = c.autoRunSuggestions;
    if (c.autoInjectEnvVars !== undefined) document.getElementById('setting-autoInjectEnvVars').checked = c.autoInjectEnvVars;
    if (c.enableAuthDetection !== undefined) document.getElementById('setting-enableAuthDetection').checked = c.enableAuthDetection;

    // Update provider cards
    document.querySelectorAll('.provider-card').forEach(function(card) {
      card.classList.remove('active');
      if (card.getAttribute('data-id') === c.aiProvider) card.classList.add('active');
    });

    if (c.keys) {
      Object.keys(c.keys).forEach(function(p) {
        var st = document.getElementById('status-' + p);
        if (st) {
          st.textContent = c.keys[p] ? 'Ready' : (p === 'ollama' || p === 'custom' ? 'Local' : 'Off');
          st.className = 'p-status' + (c.keys[p] ? ' ready' : '');
        }
      });
    }
    
    var epRow = document.getElementById('row-endpoint');
    if (epRow) epRow.style.display = (c.aiProvider === 'custom' || c.aiProvider === 'ollama') ? 'block' : 'none';
  }

  function renderUsage(data) {
    if (!data) return;
    var totalCost = 0;
    var totalTokens = 0;
    var h = '';
    
    Object.keys(data).forEach(function(p) {
      var s = data[p];
      totalCost += s.totalCost;
      totalTokens += s.totalTokens;
      h += '<div class="u-item">' +
           '<div class="u-provider-info">' +
           '<div class="u-name">' + esc(p) + '</div>' +
           '<div class="u-count">' + s.requestCount + ' requests</div></div>' +
           '<div class="u-stats">' +
           '<div class="u-cost">$' + s.totalCost.toFixed(4) + '</div>' +
           '<div class="u-tokens">' + s.totalTokens + ' tokens</div></div></div>';
    });

    safeSet('usage-total-cost', '$' + totalCost.toFixed(2));
    safeSet('usage-total-tokens', totalTokens + ' tokens estimated');
    safeSet('usage-provider-list', h || '<div class="empty">No usage data.</div>');
  }

  function updatePetUI(s) {
    if (!s) return;
    var emo = document.getElementById('pet-emoji');
    if (emo) emo.textContent = s.emoji || '🐱';
    safeSet('pet-mood', s.mood || 'ready');
    safeSet('pet-name', s.name || 'Buddy');
    safeSet('pet-lv', 'Lv.' + (s.level || 1));
    var fill = document.getElementById('xp-fill');
    if (fill) fill.style.width = (s.xp % 100) + '%';
  }

  function updateAiStatus(info) {
    var dot = document.getElementById('ai-status-dot');
    var txt = document.getElementById('ai-status-text');
    if (dot) dot.style.background = info.isOffline ? 'var(--error)' : 'var(--success)';
    if (txt) txt.textContent = info.isOffline ? (info.reason || 'Offline') : (info.provider + ' Active');
  }

  function renderLog(logs) {
    var h = '';
    logs.slice(0, 50).forEach(function(l) {
      var cls = l.status === 'error' ? 'err' : 'ok';
      h += '<div class="log-entry ' + cls + '" data-action="explainEntry" data-id="' + l.id + '">' +
           '<div class="log-cmd">' + esc(l.cmd) + '</div></div>';
    });
    safeSet('log-list', h || '<div class="empty">No commands.</div>');
  }

  function renderLive(cmds) {
    var h = '';
    if (cmds && cmds.length) {
      cmds.forEach(function(c) {
        h += '<div class="live-entry"><div class="entry-sub"><span class="live-badge">Running</span> ' + esc(c.terminalName) + '</div>' + 
             '<div class="entry-cmd-text">' + esc(c.cmd) + '</div></div>';
      });
    }
    safeSet('live-list', h || '<div class="empty">No active commands.</div>');
  }

  function renderPorts(ports) {
    var h = '';
    ports.forEach(function(p) {
      h += '<div class="port-card"><div class="card-info"><div class="card-title">Port :' + p.port + '</div>' +
           '<div class="card-sub">' + esc(p.label) + '</div></div>' +
           '<button class="icon-btn kill" data-action="killPort" data-id="' + p.port + '" data-extra="' + p.pid + '">💀</button></div>';
    });
    safeSet('ports-list', h || '<div class="empty">No active servers.</div>');
  }

  function renderPkgs(pkgs) {
    if (!pkgs || !pkgs.length) {
      safeSet('pkgs-list', '<div class="empty">No scripts.</div>');
      return;
    }
    
    var groups = {};
    pkgs.forEach(function(p) {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    });

    var h = '';
    Object.keys(groups).sort().forEach(function(g) {
      h += '<div class="pkg-group-header">' + esc(g) + '</div>';
      groups[g].forEach(function(p) {
        h += '<div class="explorer-card" data-action="runExecutable" data-id="' + esc(p.name) + '">' +
             '<div class="icon">' + (p.type === 'npm' ? '📦' : (p.type === 'python' ? '🐍' : '⚙️')) + '</div>' +
             '<div class="name">' + esc(p.name) + '</div>' +
             '<div class="type">' + esc(p.type) + '</div></div>';
      });
    });
    safeSet('pkgs-list', h);
  }

  function renderExplorer(map) {
    if (!map) return;
    var rootName = map.rootPath ? map.rootPath.split(/[\\\\\\/]/).pop() : 'Unknown';
    var h = '<div class="explorer-header">Workspace: ' + esc(rootName) + '</div>';
    
    if (map.fileTree) {
      h += '<div class="tree-container">' + renderTree(map.fileTree, 0) + '</div>';
    }

    if (map.projects && map.projects.length) {
      h += '<div class="projects-section"><div class="section-title">Detected Projects</div>';
      map.projects.forEach(function(p) {
        h += '<div class="project-card" data-action="aiMoveDirectory" data-id="' + p.path + '">' +
             '<div class="p-icon">' + (p.type === 'node' ? '🟡' : (p.type === 'python' ? '🐍' : '📁')) + '</div>' +
             '<div class="p-info"><div class="p-name">' + esc(p.name) + '</div>' +
             '<div class="p-type">' + esc(p.type) + '</div></div></div>';
      });
      h += '</div>';
    }
    safeSet('explorer-tree', h || '<div class="empty">No files.</div>');
  }

  function renderTree(node, depth) {
    var h = '';
    var indent = depth * 12;
    var isDir = node.type === 'directory';
    var icon = isDir ? '📁' : '📄';
    
    h += '<div class="tree-item" style="padding-left:' + indent + 'px" ' + (isDir ? '' : 'data-action="openFile" data-id="' + node.path + '"') + '>' +
         '<span class="tree-icon">' + icon + '</span>' +
         '<span class="tree-label">' + esc(node.name) + '</span></div>';
    
    if (node.children && node.children.length) {
      node.children.forEach(function(c) { h += renderTree(c, depth + 1); });
    }
    return h;
  }

  function renderGit(data) {
    if (!data) {
      safeSet('git-content', '<div class="empty"><div class="empty-icon">🐙</div><div class="empty-text">Not a git repository.</div></div>');
      return;
    }
    var branchCls = data.branch === 'main' || data.branch === 'master' ? 'branch-main' : 'branch-feature';
    var h = '<div class="git-header">' +
            '<div class="git-branch ' + branchCls + '">🌿 ' + esc(data.branch) + '</div>' +
            (data.remoteUrl ? '<div class="git-remote">' + esc(data.remoteUrl) + '</div>' : '') +
            '</div>';
    
    if (data.guide) {
      h += '<div class="git-guide">' + data.guide + '</div>';
    }

    if (data.tree) {
      h += '<div class="git-tree-header">Changes</div>' + renderGitTree(data.tree, 0);
    } else {
      h += '<div class="empty">No uncommitted changes.</div>';
    }
    safeSet('git-content', h);
  }

  function renderGitTree(node, depth) {
    var h = '';
    var indent = depth * 12;
    var statusCls = 'status-' + (node.status || 'clean').replace('?', 'untracked');
    
    if (node.name !== 'root') {
      h += '<div class="tree-item ' + statusCls + '" style="padding-left:' + indent + 'px">' +
           '<span class="tree-label">' + esc(node.name) + '</span>' +
           '<span class="status-badge">' + (node.status === '??' ? 'U' : (node.status === 'M' ? 'M' : 'A')) + '</span></div>';
    }
    
    if (node.children && node.children.length) {
      node.children.forEach(function(c) { h += renderGitTree(c, node.name === 'root' ? 0 : depth + 1); });
    }
    return h;
  }

  function renderVault(keys) {
    var h = '';
    keys.forEach(function(k) {
      h += '<div class="vault-item">' +
           '<div class="v-row"><div class="v-info">' +
           '<div class="v-name">' + esc(k.name) + '</div>' +
           '<div class="v-env">' + esc(k.envVar) + '</div></div>' +
           '<div class="v-actions">' +
           (k.hasValue ? '<button class="v-btn primary" data-action="injectVaultKey" data-id="' + k.id + '">Inject 🚀</button>' : '') +
           '<button class="v-btn danger" data-action="deleteVaultKey" data-id="' + k.id + '">🗑️</button></div></div>' +
           '<div class="v-input-row">' +
           '<input type="password" class="v-input" id="v-key-' + k.id + '" placeholder="' + (k.hasValue ? '••••••••' : 'Enter Secret/Token') + '" />' +
           '<button class="v-btn" data-action="updateVaultKey" data-id="' + k.id + '">Save</button></div></div>';
    });
    safeSet('vault-list', h || '<div class="empty"><div class="empty-icon">🔐</div><div class="empty-text">Your vault is empty.</div></div>');

    document.querySelectorAll('[data-action="updateVaultKey"]').forEach(function(btn) {
      btn.onclick = function() {
        var id = btn.getAttribute('data-id');
        var val = document.getElementById('v-key-' + id).value.trim();
        if (val) vsc.postMessage({ type: 'updateVaultKey', payload: { id: id, value: val } });
      };
    });
  }

  var addVaultBtn = document.getElementById('vault-add-btn');
  if (addVaultBtn) {
    addVaultBtn.onclick = function() {
      var name = document.getElementById('vault-new-name').value.trim();
      var env = document.getElementById('vault-new-env').value.trim();
      if (name && env) {
        vsc.postMessage({ type: 'addVaultKey', payload: { name: name, envVar: env } });
        document.getElementById('vault-new-name').value = '';
        document.getElementById('vault-new-env').value = '';
      }
    };
  }

  function updateTerminals(list) {
    var h = '';
    list.forEach(function(t) {
      h += '<div class="terminal-card"><div class="card-info"><div class="card-title">' + esc(t.name) + '</div></div>' +
           '<button class="icon-btn focus" data-action="focusTerminal" data-id="' + t.id + '">🎯</button></div>';
    });
    safeSet('terminal-selector', h);
  }

  function showThinking() {
    var m = document.getElementById('chat-msgs');
    if (!m) return;
    var d = document.createElement('div');
    d.className = 'msg buddy thinking';
    d.textContent = 'Thinking...';
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
  }

  function handleStream(c) {
    if (!streamEl) {
      var th = document.querySelector('.msg.thinking');
      if (th) th.remove();
      streamEl = document.createElement('div');
      streamEl.className = 'msg buddy';
      document.getElementById('chat-msgs').appendChild(streamEl);
    }
    streamEl.textContent += c;
    var m = document.getElementById('chat-msgs');
    m.scrollTop = m.scrollHeight;
  }

  function finalizeStream() { 
    streamEl = null; 
    var th = document.querySelector('.msg.thinking');
    if (th) th.remove();
  }

  function renderExplanation(p) {
    finalizeStream();
    if (!p || !p.explanation) { return; }
    var m = document.getElementById('chat-msgs');
    if (!m) return;
    
    var expl = p.explanation;
    // Handle both rich objects and fallback strings
    var summary = typeof expl === 'string' ? expl : (expl.summary || 'No summary available.');
    var cause = expl.cause ? '<div class="expl-cause"><b>Cause:</b> ' + expl.cause + '</div>' : '';
    var fix = expl.fix ? '<div class="expl-fix"><b>Fix:</b> ' + expl.fix + '</div>' : '';

    var d = document.createElement('div');
    d.className = 'msg buddy explanation-rich';
    d.innerHTML = '<div class="expl-header">Analysis: ' + esc(p.cmd) + '</div>' + 
                  '<div class="expl-summary">' + summary + '</div>' +
                  cause + fix;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
  }

  function showThought(t) {
    var th = document.querySelector('.msg.thinking');
    if (th) th.textContent = t;
  }

  function showWarn(msg) {
    var w = document.getElementById('warn-bar');
    if (!w) return;
    w.textContent = msg;
    w.style.display = 'block';
    setTimeout(function() { w.style.display = 'none'; }, 4000);
  }

  function showSafety(p) {
    var o = document.getElementById('safety-overlay');
    var cmd = document.getElementById('safety-cmd-preview');
    if (o && cmd) {
      cmd.textContent = p.command;
      o.classList.add('show');
    }
  }

  function hideSafety() {
    var o = document.getElementById('safety-overlay');
    if (o) o.classList.remove('show');
  }

  var chatInp = document.getElementById('chat-input');
  if (chatInp) {
    chatInp.addEventListener('keydown', function(e) {
      if (e.keyCode === 13 && !e.shiftKey) {
        e.preventDefault();
        var v = chatInp.value.trim();
        if (!v) return;
        var m = document.getElementById('chat-msgs');
        var d = document.createElement('div');
        d.className = 'msg user';
        d.textContent = v;
        m.appendChild(d);
        vsc.postMessage({ type: 'askBuddy', payload: v });
        chatInp.value = '';
        m.scrollTop = m.scrollHeight;
      }
    });
  }

  var mvInp = document.getElementById('ai-mover-input');
  if (mvInp) {
    mvInp.addEventListener('keydown', function(e) {
      if (e.keyCode === 13) {
        vsc.postMessage({ type: 'aiMoveDirectory', payload: mvInp.value.trim() });
        mvInp.value = '';
      }
    });
  }

  vsc.postMessage({ type: 'ready' });
  function renderJira(issue) {
    var area = document.getElementById('jira-active-ticket');
    if (!area) return;
    if (!issue) {
      area.innerHTML = '<div class="empty-state">No active ticket detected.</div>';
      return;
    }
    area.innerHTML = ' \
      <div class="ticket-card" style="margin:0; border:none; background:transparent;"> \
        <div class="t-key">' + esc(issue.key) + '</div> \
        <div class="t-summary">' + esc(issue.summary) + '</div> \
        <div class="t-status">' + esc(issue.status) + '</div> \
        <div style="margin-top:10px;"><a href="' + esc(issue.url) + '" style="color:var(--accent); font-size:10px;">View in Jira</a></div> \
      </div>';
  }
})();
`;