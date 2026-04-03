export const PANEL_JS = `(function() {
  'use strict';
  console.log('[Terminal Buddy] Webview script heartbeat.');
  var vsc = acquireVsCodeApi();
  var hatched = false;
  var allLogs = [];

  var PET_MAP = {
    cat: { happy: '😸', neutral: '🐱', tired: '😿', worried: '🙀', excited: '😽', scared: '🙀', sleeping: '😴' },
    dog: { happy: '🐶', neutral: '🐕', tired: '🦮', worried: '🐕‍🦺', excited: '🐕', scared: '🐕', sleeping: '💤' },
    robot: { happy: '🤖', neutral: '🤖', tired: '🔌', worried: '📉', excited: '🚀', scared: '⚠️', sleeping: '💤' },
    ghost: { happy: '👻', neutral: '👻', tired: '🌫️', worried: '😨', excited: '✨', scared: '😱', sleeping: '💤' }
  };

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || !msg.type) { return; }

    if (!hatched) {
      hatched = true;
      var emojiEl = document.getElementById('pet-emoji');
      var moodEl = document.getElementById('pet-mood');
      if (emojiEl && (emojiEl.textContent.trim() === '🥚' || emojiEl.textContent.trim() === 'Hatching...')) {
         emojiEl.textContent = '🐱';
      }
      if (moodEl && (moodEl.textContent.trim() === 'Hatching...' || moodEl.textContent.trim() === 'Waiting...')) {
         moodEl.textContent = 'ready';
      }
    }

    try {
      switch (msg.type) {
        case 'init': break;
        case 'updateLog': 
          allLogs = msg.payload || [];
          populateProjectFilter(allLogs);
          applyFilters();
          break;
        case 'updatePetState': updatePet(msg.payload); break;
        case 'updateActiveCommands': renderLive(msg.payload); break;
        case 'updatePorts': renderPorts(msg.payload); break;
        case 'updateGitStatus': break;
        case 'updateGitTree': renderGitTree(msg.payload); break;
        case 'updateTerminalSelector': updateTerminals(msg.payload); break;
        case 'updateExecutables': renderPkgs(msg.payload); break;
        case 'updateStats': updateStats(msg.payload); break;
        case 'updateAiInfo': updateAiInfo(msg.payload); break;
        case 'updateWorkspaceMap': renderExplorer(msg.payload); break;
        case 'aiThinking': addChatMsg('Thinking...', 'buddy thinking'); break;
        case 'aiStreamChunk': handleStreamChunk(msg.payload); break;
        case 'aiStreamDone': finalizeStream(); break;
        case 'aiExplanation': renderExplanation(msg.payload); break;
        case 'warning': showWarning(msg.payload); break;
        case 'safetyAlert': showSafety(msg.payload); break;
      }
    } catch (err) {
      console.error('[Terminal Buddy] Webview error:', err);
    }
  });

  var streamEl = null;
  var pendingCmd = null;
  var terminals = [];

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseMd(text) {
    if (!text) return '';
    try {
      var TICK = String.fromCharCode(96);
      var FENCE = TICK + TICK + TICK;
      var parts = text.split(FENCE);
      var html = '';
      for (var i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          var content = parts[i].replace(/^[a-z]*\\n/, '');
          html += '<pre><code>' + esc(content.trim()) + '</code></pre>';
        } else {
          var segment = esc(parts[i]);
          segment = segment.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
          segment = segment.replace(new RegExp(TICK + '([^' + TICK + ']+)' + TICK, 'g'), '<code>$1</code>');
          segment = segment.replace(/\\[LIVE:([^\\]]+)\\]/g, function(match, id) {
            var found = null;
            for (var j = 0; j < terminals.length; j++) {
              if (terminals[j].id === id) { found = terminals[j]; break; }
            }
            return '<button class="chat-live-token" data-id="' + esc(id) + '">📺 ' + esc(found ? found.name : id) + '</button>';
          });
          html += segment.replace(/\\n/g, '<br>');
        }
      }
      return html;
    } catch (e) {
      return esc(text);
    }
  }

  function applyFilters() {
    var query = (document.getElementById('log-search').value || '').toLowerCase();
    var termId = document.getElementById('term-filter').value;
    var status = document.getElementById('status-filter').value;
    var project = document.getElementById('project-filter').value;
    var sort = document.getElementById('sort-filter').value;
    
    var filtered = allLogs.filter(function(l) {
      var matchQuery = !query || l.cmd.toLowerCase().indexOf(query) !== -1;
      var matchTerm = termId === 'all' || l.terminalId === termId;
      var matchStatus = status === 'all' || l.status === status;
      var matchProject = project === 'all' || l.project === project;
      return matchQuery && matchTerm && matchStatus && matchProject;
    });

    filtered.sort(function(a, b) {
      var ta = a.timestamp || 0;
      var tb = b.timestamp || 0;
      return sort === 'asc' ? ta - tb : tb - ta;
    });

    renderLog(filtered, true);
  }

  function addChatMsg(content, role) {
    var container = document.getElementById('chat-msgs');
    if (!container) return null;
    var div = document.createElement('div');
    div.className = 'msg ' + role;
    div.innerHTML = (role.indexOf('thinking') !== -1) ? '<span class="thinking-dots">' + esc(content) + '</span>' : content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function handleStreamChunk(chunk) {
    if (!streamEl) {
      var thinking = document.querySelector('#chat-msgs .msg.thinking');
      if (thinking) { thinking.parentNode.removeChild(thinking); }
      streamEl = addChatMsg('', 'buddy');
    }
    var raw = (streamEl.getAttribute('data-raw') || '') + chunk;
    streamEl.setAttribute('data-raw', raw);
    streamEl.innerHTML = parseMd(raw);
    var c = document.getElementById('chat-msgs');
    if (c) { c.scrollTop = c.scrollHeight; }
  }

  function finalizeStream() {
    if (streamEl) {
      streamEl.innerHTML = parseMd(streamEl.getAttribute('data-raw') || '');
      streamEl = null;
    }
  }

  function updatePet(s) {
    var emoji = document.getElementById('pet-emoji');
    var mood = document.getElementById('pet-mood');
    var lv = document.getElementById('pet-lv');
    var fill = document.getElementById('xp-fill');
    var name = document.getElementById('pet-name');
    if (emoji && s) {
      var typeMap = PET_MAP[s.type] || PET_MAP.cat;
      emoji.textContent = typeMap[s.mood] || typeMap.neutral || '🐱';
    }
    if (mood && s) { mood.textContent = s.mood || 'ready'; }
    if (lv && s) { lv.textContent = 'Lv.' + (s.level || 1); }
    if (name && s) { name.textContent = s.name || 'Buddy'; }
    if (fill && s) { fill.style.width = (s.xp % 100) + '%'; }
  }

  function renderLog(logs, isFilter) {
    var list = document.getElementById('log-list');
    if (!list) return;
    if (!logs || !logs.length) {
      list.innerHTML = '<div class="empty">' + (isFilter ? 'No matching logs.' : 'No commands yet.') + '</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < logs.length; i++) {
        var l = logs[i];
        var cls = l.status === 'error' ? 'err' : 'ok';
        var json = JSON.stringify(l).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        html += '<div class="log-entry ' + cls + '" onclick=\\\'vscPost("explainEntry", ' + json + ')\\\'><div class="log-cmd">' + esc(l.cmd) + '</div></div>';
    }
    list.innerHTML = html;
  }

  function renderLive(commands) {
    var list = document.getElementById('live-list');
    if (!list || !commands) return;
    var html = '';
    for (var i = 0; i < commands.length; i++) {
        var c = commands[i];
        html += '<div class="live-entry"><div class="entry-cmd-text">' + esc(c.cmd || c.name || '') + '</div>' +
          '<div class="entry-sub"><span>' + esc(c.terminalName || '') + '</span></div></div>';
    }
    list.innerHTML = html || '<div class="empty">No active commands.</div>';
  }

  function renderPorts(ports) {
    var list = document.getElementById('ports-list');
    if (!list || !ports) return;
    var html = '';
    for (var i = 0; i < ports.length; i++) {
        var p = ports[i];
        html += '<div class="card"><div class="pkg-row"><div><div class="pkg-name">:' + esc(p.port) + ' - ' + esc(p.label || p.name || '') + '</div></div>' +
          '<button class="kill-btn" onclick=\\\'vscPost("killPort", {port:' + p.port + ',pid:' + (p.pid || 0) + '})\\\'>Kill</button>' +
          '</div></div>';
    }
    list.innerHTML = html || '<div class="empty">No dev servers.</div>';
  }

  function renderGitTree(data) {
    var container = document.getElementById('git-content');
    if (!container || !data) return;
    var html = '<div class="branch-badge">🌿 ' + esc(data.branch || 'unknown') + '</div>';
    if (data.guide) { html += '<div class="git-tip">' + esc(data.guide) + '</div>'; }
    container.innerHTML = html;
  }

  function renderPkgs(list) {
    var container = document.getElementById('pkgs-list');
    if (!container || !list) return;
    
    var groups = {};
    for (var i = 0; i < list.length; i++) {
      var pkg = list[i];
      var dir = pkg.path || 'Root';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(pkg);
    }

    var html = '';
    var keys = Object.keys(groups);
    keys.sort();
    for (var k = 0; k < keys.length; k++) {
      var dirName = keys[k];
      var pkgs = groups[dirName];
      html += '<div class="pkg-group"><div class="pkg-group-header">' + esc(dirName) + '</div>';
      for (var j = 0; j < pkgs.length; j++) {
        var p = pkgs[j];
        var json = JSON.stringify(p).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        html += '<div class="card pkg-row"><div><div class="pkg-name">' + esc(p.name) + '</div><div class="pkg-type">' + esc(p.type || '') + '</div></div>' +
          '<button class="run-btn btn-sm" onclick=\\\'vscPost("runExecutable",' + json + ')\\\'>Run</button></div>';
      }
      html += '</div>';
    }
    container.innerHTML = html || '<div class="empty">No scripts.</div>';
  }

  function renderExplanation(ex) {
    if (!ex) return;
    var container = document.getElementById('ai-expl');
    if (!container) return;
    container.style.display = 'block';
    
    var activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.getAttribute('data-tab') !== 'chat') {
       var chatTab = document.querySelector('.tab[data-tab="chat"]');
       if (chatTab) chatTab.click();
    }

    var html = '<div class="explain-card card">';
    if (ex.summary) html += '<div class="ec-label">Summary</div><div>' + esc(ex.summary) + '</div>';
    if (ex.cause) html += '<div class="ec-label" style="margin-top:8px">Cause</div><div>' + esc(ex.cause) + '</div>';
    if (ex.fix) html += '<div class="ec-fix"><div class="ec-label">Fix</div><div>' + esc(ex.fix) + '</div></div>';
    if (ex.suggestedCommands && ex.suggestedCommands.length) {
      html += '<div style="margin-top:8px">';
      for (var i = 0; i < ex.suggestedCommands.length; i++) {
        var cmd = ex.suggestedCommands[i];
        html += '<button class="sug-btn" onclick=\\\'vscPost("runCommand","' + esc(cmd) + '")\\\'>' + esc(cmd) + '</button>';
      }
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
    if (typeof container.scrollIntoView === "function") {
       container.scrollIntoView({ behavior: "smooth" });
    }
  }

  function renderExplorer(map) {
    var container = document.getElementById('explorer-tree');
    if (!container || !map || !map.projects) return;
    var html = '';
    for (var i = 0; i < map.projects.length; i++) {
      var proj = map.projects[i];
      html += '<div class="tree-node folder" onclick=\\\'vscPost("openFile","' + esc(proj.path || '') + '")\\\'>📁 ' + esc(proj.name) + '</div>';
      var files = proj.topLevelFiles || [];
      for (var j = 0; j < Math.min(files.length, 10); j++) {
        html += '<div class="tree-node file" style="padding-left:18px" onclick=\\\'vscPost("openFile","' + esc(files[j]) + '")\\\'>📄 ' + esc(files[j].split(/[\\\\\\\\/]/).pop() || files[j]) + '</div>';
      }
    }
    container.innerHTML = html || '<div class="empty">No projects.</div>';
  }

  function updateTerminals(list) {
    terminals = list || [];
    var sel = document.getElementById('terminal-selector');
    var filterSel = document.getElementById('term-filter');
    if (!sel) return;
    var html = '';
    var optHtml = '<option value="all">All Terminals</option>';
    for (var i = 0; i < terminals.length; i++) {
        var t = terminals[i];
        html += '<div class="terminal-card"><div class="term-header"><div class="term-name">' + esc(t.name) + '</div>' +
          '<div class="term-status' + (t.isExecuting ? ' executing' : '') + '"></div></div>' +
          '<div class="term-actions"><button class="ask-btn" onclick=\\\'vscPost("focusTerminal","' + esc(t.id) + '")\\\'>Focus</button>' +
          '<button class="kill-btn" style="font-size:10px;padding:2px 8px" onclick=\\\'vscPost("killTerminal","' + esc(t.id) + '")\\\'>Kill</button></div></div>';
        optHtml += '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
    }
    sel.innerHTML = html;
    if (filterSel) filterSel.innerHTML = optHtml;
  }

  function populateProjectFilter(logs) {
    var sel = document.getElementById('project-filter');
    if (!sel) return;
    var projects = {};
    for (var i = 0; i < logs.length; i++) {
        var pName = logs[i].project;
        if (pName) projects[pName] = true;
    }
    var html = '<option value="all">All Projects</option>';
    var keys = Object.keys(projects).sort();
    for (var j = 0; j < keys.length; j++) {
        html += '<option value="' + esc(keys[j]) + '">' + esc(keys[j]) + '</option>';
    }
    // Only update if options changed to preserve selection if possible
    var currentVal = sel.value;
    sel.innerHTML = html;
    sel.value = currentVal || 'all';
  }

  function updateStats(s) {
    var tok = document.querySelector('#st-ok .st-val');
    var terr = document.querySelector('#st-err .st-val');
    var tall = document.querySelector('#st-total .st-val');
    if (tok) tok.textContent = s.ok || 0;
    if (terr) terr.textContent = s.err || 0;
    if (tall) tall.textContent = s.total || 0;
  }

  function updateAiInfo(info) {
    var badge = document.getElementById('ai-badge');
    if (badge) { badge.textContent = (info.provider || 'AI').toUpperCase() + ' - ' + (info.model || ''); }
  }

  function showWarning(txt) {
    var bar = document.getElementById('warn-bar');
    if (bar) {
      bar.textContent = txt;
      bar.style.display = 'block';
      setTimeout(function() { bar.style.display = 'none'; }, 4000);
    }
  }

  function showSafety(data) {
    var overlay = document.getElementById('safety-overlay');
    if (overlay) {
      pendingCmd = data.cmd;
      var msg = document.getElementById('safety-msg');
      var preview = document.getElementById('safety-cmd-preview');
      if (msg) msg.textContent = (data.alert && data.alert.explanation) ? data.alert.explanation : 'Safety alert.';
      if (preview) preview.textContent = data.cmd;
      overlay.className += ' show';
    }
  }

  window.vscPost = function(type, payload) { vsc.postMessage({ type: type, payload: payload }); };

  var tabEls = document.querySelectorAll('.tab');
  for (var i = 0; i < tabEls.length; i++) {
    (function(idx) {
        tabEls[idx].addEventListener('click', function() {
          var target = this.getAttribute('data-tab');
          var allTabs = document.querySelectorAll('.tab');
          for (var j = 0; j < allTabs.length; j++) { allTabs[j].className = allTabs[j].className.replace(' active', ''); }
          var allPanels = document.querySelectorAll('.panel');
          for (var k = 0; k < allPanels.length; k++) { allPanels[k].className = allPanels[k].className.replace(' active', ''); }
          this.className += ' active';
          var p = document.getElementById('panel-' + target);
          if (p) p.className += ' active';
        });
    })(i);
  }

  // Filter Toggle
  var filterBtn = document.getElementById('filter-toggle-btn');
  if (filterBtn) {
    filterBtn.addEventListener('click', function() {
      var box = document.getElementById('log-filters-box');
      if (box) {
        if (box.className.indexOf('active') !== -1) {
          box.className = box.className.replace(' active', '');
        } else {
          box.className += ' active';
        }
      }
    });
  }

  // Log Search & Select Filters
  var logSearch = document.getElementById('log-search');
  if (logSearch) logSearch.addEventListener('input', applyFilters);
  var termFil = document.getElementById('term-filter');
  if (termFil) termFil.addEventListener('change', applyFilters);
  var statFil = document.getElementById('status-filter');
  if (statFil) statFil.addEventListener('change', applyFilters);
  var projectFil = document.getElementById('project-filter');
  if (projectFil) projectFil.addEventListener('change', applyFilters);
  var sortFil = document.getElementById('sort-filter');
  if (sortFil) sortFil.addEventListener('change', applyFilters);

  var sendBtn = document.getElementById('send-btn');
  var inputEl = document.getElementById('chat-input');
  function doSend() {
    var v = (inputEl.value || '').trim();
    if (!v) return;
    addChatMsg(esc(v), 'user');
    vsc.postMessage({ type: 'askBuddy', payload: v });
    inputEl.value = '';
  }
  if (sendBtn) sendBtn.addEventListener('click', doSend);
  if (inputEl) inputEl.addEventListener('keydown', function(e) { if (e.keyCode === 13 && !e.shiftKey) { e.preventDefault(); doSend(); } });

  setTimeout(function() { vsc.postMessage({ type: 'ready' }); }, 150);
})();
`;