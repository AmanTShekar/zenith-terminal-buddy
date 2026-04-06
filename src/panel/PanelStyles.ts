export const PANEL_CSS = `
:root {
  --bg: #000000;
  --bg2: #0a0a0a;
  --fg: #e0e0e0;
  --fg-dim: #888888;
  --accent: #ffffff;
  --accent-dim: #c0c0c0;
  --border: #222222;
  --card: #111111;
  --card2: #161616;
  --primary: #dcdcdc; /* Silver primary */
  --error: #ff4444;
  --success: #00e676;
  --warn: #ffab00;
  --shadow: rgba(0,0,0,0.5);
  --glass: rgba(255, 255, 255, 0.03);
}

* { box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  margin: 0;
  padding: 0;
  overflow: hidden;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

body.tb-disabled #pet, 
body.tb-disabled #stats-bar, 
body.tb-disabled #ai-badge { 
  display: none !important; 
}

body.tb-pet-off #pet { 
  display: none !important; 
}

.hidden { display: none !important; }

/* ── Header ──────────────────────────────────────────────────────────────── */
#hdr {
  padding: 12px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logo { font-weight: 800; letter-spacing: -0.5px; font-size: 14px; text-transform: uppercase; color: var(--accent); }
#ai-badge { 
  display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 20px; 
  background: var(--glass); border: 1px solid var(--border); font-size: 10px; 
  font-weight: 700; color: var(--accent); transition: all 0.3s; cursor: default;
}
#ai-badge.offline { background: rgba(255, 68, 68, 0.1); border-color: var(--error); color: var(--error); cursor: pointer; }
#ai-badge.offline:hover { background: rgba(255, 68, 68, 0.2); }

#ai-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 10px var(--success); }
#ai-badge.offline #ai-status-dot { background: var(--error); box-shadow: 0 0 10px var(--error); }
#ai-badge.thinking #ai-status-dot { animation: pulse-bg 1s infinite alternate; }

#ai-status-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }

@keyframes pulse-border { 0% { border-color: var(--border); } 50% { border-color: var(--accent); } 100% { border-color: var(--border); } }
@keyframes pulse-bg { from { opacity: 0.3; } to { opacity: 1; } }

/* ── Pet Area ───────────────────────────────────────────────────────────── */
#pet {
  padding: 12px 16px;
  background: linear-gradient(180deg, var(--bg2) 0%, var(--bg) 100%);
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--border);
}
#pet-emoji { font-size: 32px; filter: drop-shadow(0 0 8px var(--shadow)); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
#pet-emoji:hover { transform: scale(1.1) rotate(5deg); }
#pet-info { flex: 1; min-width: 0; }
#pet-row { display: flex; align-items: baseline; gap: 6px; }
#pet-name { font-weight: 700; font-size: 14px; color: var(--accent); }
#pet-lv { font-size: 10px; color: var(--fg-dim); font-weight: 500; }
#pet-mood { font-size: 11px; color: var(--fg-dim); margin: 2px 0 6px; text-transform: capitalize; }
#xp-track { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
#xp-fill { height: 100%; background: var(--accent); box-shadow: 0 0 4px var(--accent); transition: width 0.5s ease; }

/* ── Stats ──────────────────────────────────────────────────────────────── */
#stats-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.st-item { padding: 10px; text-align: center; border-right: 1px solid var(--border); }
.st-item:last-child { border-right: none; }
.st-val { display: block; font-size: 16px; font-weight: 800; color: var(--accent); }
.st-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg-dim); }
#st-ok .st-val { color: var(--success); }
#st-err .st-val { color: var(--error); }

/* ── Tabs ───────────────────────────────────────────────────────────────── */
#tabs {
  display: flex;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
#tabs::-webkit-scrollbar { display: none; }
.tab {
  padding: 10px 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-dim);
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}
.tab:hover { color: var(--fg); background: var(--glass); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); background: var(--bg); }

/* ── Panels ─────────────────────────────────────────────────────────────── */
#panels { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.panel { display: none; flex: 1; flex-direction: column; min-height: 0; }
.panel.active { display: flex; }

.scroll { flex: 1; overflow-y: auto; padding: 10px; overflow-anchor: none; }
.scroll::-webkit-scrollbar { width: 4px; }
.scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ── Chat ───────────────────────────────────────────────────────────────── */
#panel-chat { padding: 0; display: none; flex-direction: column; height: 100%; min-height: 0; }
#panel-chat.active { display: flex; }
#chat-msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow-anchor: none; }
#chat-msgs::-webkit-scrollbar { width: 4px; }
#chat-msgs::-webkit-scrollbar-thumb { background: var(--border); }

.msg { max-width: 88%; padding: 8px 12px; border-radius: 10px; font-size: 12px; line-height: 1.6; word-break: break-word; animation: fadeIn 0.3s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

.msg.buddy { align-self: flex-start; background: var(--card); border: 1px solid var(--border); border-bottom-left-radius: 2px; }
.msg.user { align-self: flex-end; background: var(--accent); color: #000; font-weight: 500; border-bottom-right-radius: 2px; }
.msg.thinking { align-self: flex-start; background: var(--card2); border: 1px dashed var(--border); font-style: italic; color: var(--fg-dim); }

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 10px;
  border-bottom: 1px solid var(--border);
}

.settings-row:has(input[type="checkbox"]) {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.settings-row:has(input[type="checkbox"]) label {
  margin-bottom: 0;
  flex: 1;
}

.settings-row:has(input[type="checkbox"]) p.sub-text-tiny {
  width: 100%;
  margin-top: 2px;
}

.settings-row label {
  font-weight: 500;
  font-size: 11px;
}

.settings-row input[type="text"], 
.settings-row select {
  width: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--fg);
  padding: 4px 6px;
  border-radius: 4px;
}

.sub-text-tiny {
  font-size: 10px;
  color: var(--fg-dim);
  margin-top: 4px;
  line-height: 1.3;
}

.badge-exp {
  font-size: 9px;
  padding: 1px 4px;
  background: var(--error);
  color: #fff;
  border-radius: 4px;
  vertical-align: middle;
  font-weight: bold;
  margin-left: 5px;
  opacity: 0.8;
}

/* 🌳 Explorer & Git Tree Styles */
.explorer-header, .git-header {
  padding: 12px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tree-container {
  padding: 8px 0;
}

.tree-item {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  gap: 8px;
}

.tree-item:hover {
  background: var(--card2);
}

.tree-icon {
  font-size: 14px;
  opacity: 0.8;
  width: 16px;
  display: inline-block;
  text-align: center;
}

.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 3px;
  min-width: 14px;
  text-align: center;
}

.status-modified .status-badge { background: #e2b93d22; color: #e2b93d; }
.status-untracked .status-badge { background: #2ea44f22; color: #2ea44f; }
.status-deleted .status-badge { background: #cf222e22; color: #cf222e; }

.git-branch {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 700;
  width: fit-content;
}

.branch-main { background: #2ea44f22; color: #2ea44f; border: 1px solid #2ea44f44; }
.branch-feature { background: var(--accent); color: #000; }

.git-guide {
  padding: 12px;
  margin: 10px;
  background: var(--glass);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--fg-dim);
}

.git-tree-header, .section-title {
  padding: 8px 12px;
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--fg-dim);
  opacity: 0.7;
}

.projects-section {
  margin-top: 16px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.project-card {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.project-card:hover { background: var(--card2); }

.project-card .p-icon { font-size: 18px; }
.project-card .p-name { font-size: 12px; font-weight: 600; }
.project-card .p-type { font-size: 10px; color: var(--fg-dim); text-transform: capitalize; }

.thought-trace { font-size: 10px; color: var(--fg-dim); margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border); opacity: 0.8; }

#chat-input-area {
  padding: 12px;
  background: var(--bg2);
  border-top: 1px solid var(--border);
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
#chat-input {
  flex: 1;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  color: var(--fg);
  font-size: 12px;
  resize: none;
  max-height: 120px;
  outline: none;
}
#chat-input:focus { border-color: var(--fg-dim); }
#send-btn {
  background: var(--accent);
  color: #000;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: transform 0.1s;
}
#send-btn:hover { background: var(--primary); transform: scale(1.05); }
#send-btn:active { transform: scale(0.95); }

.explanation-rich { border-left: 3px solid var(--accent) !important; background: var(--glass) !important; padding: 16px !important; width: 95% !important; }
.expl-header { font-weight: 800; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px; color: var(--accent); opacity: 0.7; }
.expl-summary { font-size: 14px; font-weight: 600; line-height: 1.4; margin-bottom: 16px; color: #fff; }
.expl-section { margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); }
.expl-section .label { font-size: 9px; font-weight: 800; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; opacity: 0.6; display: flex; align-items: center; gap: 4px; }
.expl-section .content { font-size: 11px; line-height: 1.5; color: var(--fg); }
.expl-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.cmd-btn { 
  background: var(--accent); color: #000; border: none; padding: 6px 12px; border-radius: 6px; 
  font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3); transition: all 0.2s;
}
.cmd-btn:hover { background: #fff; transform: translateY(-2px); box-shadow: 0 6px 12px rgba(0,0,0,0.4); }
.cmd-btn:active { transform: translateY(0); }
.cmd-btn .icon { font-size: 10px; opacity: 0.8; }

/* ── Logs ───────────────────────────────────────────────────────────────── */
.log-entry {
  padding: 10px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
}
.log-entry:hover { border-color: var(--fg-dim); background: var(--card2); }
.log-entry.err { border-left: 3px solid var(--error); }
.log-entry.ok { border-left: 3px solid var(--success); }

.log-cmd { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 11px; color: var(--fg); margin-bottom: 4px; }
.agent-badge { 
  font-size: 9px; background: #333; color: #fff; padding: 1px 4px; border-radius: 3px; margin-right: 6px; 
  text-transform: uppercase; font-weight: 800; font-family: sans-serif;
}

.log-filter-bar { padding: 12px; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: center; position: sticky; top: 0; z-index: 10; }
#log-search { flex: 1; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; color: var(--fg); font-size: 12px; outline: none; box-shadow: inset 0 2px 4px var(--shadow); }
#log-search:focus { border-color: var(--accent-dim); background: var(--bg); }
#filter-toggle-btn { background: var(--card); border: 1px solid var(--border); border-radius: 8px; width: 32px; height: 32px; color: var(--fg); cursor: pointer; display: flex; align-items: center; justify-content: center; }
#filter-toggle-btn:hover { border-color: var(--fg); background: var(--glass); }

.log-filters { display: none; padding: 12px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 10px; flex-wrap: wrap; box-shadow: 0 4px 10px var(--shadow); }
.log-filters.show { display: flex; animation: slideDown 0.2s ease; }
.filter-select { flex: 1; min-width: 120px; background: var(--card2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; color: var(--fg); font-size: 11px; outline: none; }
.filter-select:hover { border-color: var(--fg-dim); }

/* ── Suggestion Cards ───────────────────────────────────────────────────── */
.fix-suggestion-card {
  margin: 10px;
  background: var(--card2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 12px var(--shadow);
  border-top: 3px solid var(--accent);
}
.fsc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.fsc-title { font-weight: 700; font-size: 13px; color: var(--accent); display: flex; align-items: center; gap: 6px; }

.sug-btn {
  background: var(--accent);
  color: #000;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  margin-right: 5px;
  margin-top: 4px;
}
.sug-btn:hover { background: var(--primary); }

.ask-btn {
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

/* ── Git Tab ──────────────────────────────────────────────────────────────── */
.branch-badge {
  display: inline-block;
  padding: 4px 10px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 12px;
}
.git-tip {
  padding: 12px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--fg-dim);
  border-left: 3px solid var(--accent);
  margin-bottom: 20px;
}
.git-tip strong { color: var(--accent); }

.git-tree-header {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--fg-dim);
  margin-bottom: 8px;
  font-weight: 800;
}
.git-node {
  display: flex;
  align-items: center;
  padding: 6px 0;
  font-size: 11px;
  gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.02);
}
.git-icon { font-size: 12px; opacity: 0.7; }
.git-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-badge {
  font-size: 9px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 3px;
  min-width: 18px;
  text-align: center;
}
.git-status-d { background: var(--error); color: #fff; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; color: var(--fg-dim); text-align: center; }
.empty-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.5; }
.empty-text { font-size: 12px; font-weight: 500; }

.live-entry { 
  background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 10px;
  display: flex; flex-direction: column; gap: 4px; position: relative; overflow: hidden;
}
.live-entry::before { 
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--success);
  animation: pulse-bg 2s infinite;
}
@keyframes pulse-bg { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }

.entry-cmd-text { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-sub { font-size: 10px; color: var(--fg-dim); display: flex; align-items: center; gap: 8px; }
.live-badge { background: rgba(0, 230, 118, 0.1); color: var(--success); padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 9px; text-transform: uppercase; }

.port-card, .terminal-card { 
  background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 10px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; transition: all 0.2s;
}
.port-card:hover, .terminal-card:hover { border-color: var(--accent-dim); background: var(--card2); }

.card-info { flex: 1; overflow: hidden; }
.card-title { font-weight: 700; font-size: 12px; color: var(--accent); margin-bottom: 2px; }
.card-sub { font-size: 10px; color: var(--fg-dim); }

.btn-group { display: flex; gap: 6px; }
.icon-btn { 
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border); 
  background: var(--card2); color: var(--fg); cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all 0.2s;
}
.icon-btn:hover { background: var(--glass); border-color: var(--fg-dim); scale: 1.05; }
.icon-btn.focus { background: var(--accent); color: #000; border: none; }
.icon-btn.focus:hover { background: var(--primary); }
.icon-btn.kill { color: var(--error); }
.icon-btn.kill:hover { background: rgba(255, 68, 68, 0.1); border-color: var(--error); }

.ai-mover { padding: 16px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.ai-mover-input { 
  width: 100%; background: var(--card); border: 1px dashed var(--border); border-radius: 10px; 
  padding: 10px 16px; color: var(--fg); font-size: 13px; outline: none; transition: all 0.3s;
  box-shadow: 0 4px 10px var(--shadow);
}
.ai-mover-input:focus { border-style: solid; border-color: var(--accent); background: var(--bg); box-shadow: 0 0 15px var(--glass); }

.explorer-card {
  padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 10px;
  margin-bottom: 10px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s;
}
.explorer-card:hover { border-color: var(--accent-dim); background: var(--card2); transform: translateX(4px); }
.explorer-card .icon { font-size: 18px; }
.explorer-card .name { font-size: 12px; font-weight: 600; flex: 1; }
.explorer-card .type { font-size: 9px; text-transform: uppercase; color: var(--fg-dim); background: var(--bg2); padding: 2px 6px; border-radius: 4px; }

.terminal-selector { padding: 12px; border-top: 1px solid var(--border); background: var(--bg2); }

/* ── Overlays ───────────────────────────────────────────────────────────── */
#warn-bar {
  display: none;
  position: absolute;
  top: 0; left: 0; right: 0;
  padding: 8px;
  background: var(--warn);
  color: #000;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  z-index: 1000;
  animation: slideDown 0.3s ease;
}
@keyframes slideDown { from { transform: translateY(-100%); } to { transform: translateY(0); } }

#safety-overlay {
  display: none;
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.8);
  backdrop-filter: blur(4px);
  z-index: 2000;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
#safety-overlay.show { display: flex; }
.s-box { background: var(--bg2); border: 1px solid var(--error); border-radius: 12px; width: 100%; max-width: 320px; padding: 20px; text-align: center; }
.s-icon { font-size: 40px; margin-bottom: 12px; }
.s-title { font-weight: 800; font-size: 16px; color: var(--error); margin-bottom: 8px; }
#safety-msg { font-size: 12px; color: var(--fg-dim); margin-bottom: 16px; line-height: 1.5; }
#safety-cmd-preview { background: #000; padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; color: #fff; margin-bottom: 20px; word-break: break-all; }
.s-btns { display: flex; gap: 10px; }
.s-btn { flex: 1; padding: 10px; border-radius: 6px; border: none; font-weight: 700; cursor: pointer; }
#s-cancel { background: var(--border); color: var(--fg); }
#s-run { background: var(--error); color: #fff; }

/* ── Settings ────────────────────────────────────────────────────────────── */
.settings-group {
  margin-bottom: 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.settings-header {
  padding: 10px 16px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--accent);
  opacity: 0.8;
}

/* ── Grouped Packages ───────────────────────────────────────────────────── */
.pkg-group-header {
  padding: 12px 16px 4px;
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--fg-dim);
  opacity: 0.6;
}

/* ── Modern Settings ────────────────────────────────────────────────────── */
.settings-card {
  padding: 8px;
  background: var(--bg);
}

.settings-row-v2 {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--border);
  transition: background 0.2s;
}
.settings-row-v2:last-child { border-bottom: none; }
.settings-row-v2:hover { background: rgba(255,255,255,0.02); }

.settings-row-v2.stack { flex-direction: column; align-items: flex-start; gap: 8px; }

.s-v2-info { flex: 1; min-width: 0; }
.s-v2-label { font-size: 12px; font-weight: 700; color: var(--fg); margin-bottom: 2px; }

.modern-input {
  width: 100%;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--fg);
  font-size: 12px;
  outline: none;
  transition: all 0.2s;
}
.modern-input:focus { border-color: var(--accent); box-shadow: 0 0 10px var(--glass); }

.filter-select.modern { width: 100%; height: 38px; background: var(--bg2); border-radius: 8px; }

/* ── Toggle Switch ──────────────────────────────────────────────────────── */
.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.switch input { opacity: 0; width: 0; height: 0; }

.slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--border);
  transition: .3s;
}

.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
}

input:checked + .slider { background-color: var(--accent); }
input:focus + .slider { box-shadow: 0 0 1px var(--accent); }
input:checked + .slider:before { transform: translateX(16px); }

.slider.round { border-radius: 20px; }
.slider.round:before { border-radius: 50%; }

/* ── Modern AI Manager ────────────────────────────────────────────────── */
.provider-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 16px;
  background: var(--bg);
}
.provider-card {
  background: var(--card2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
}
.provider-card:hover { 
  border-color: var(--fg-dim); 
  transform: translateY(-2px);
  background: var(--glass);
}
.provider-card.active {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.1);
}
.provider-card.active::after {
  content: '✓';
  position: absolute;
  top: -6px; right: -6px;
  background: var(--accent);
  color: #000;
  width: 16px; height: 16px;
  border-radius: 50%;
  font-size: 10px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 800;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.p-icon { font-size: 14px; }
.p-name { font-size: 11px; font-weight: 800; flex: 1; color: var(--accent); }
.p-status { font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6; }

.provider-card.active .p-status { opacity: 1; color: var(--success); }

.card-body { width: 100%; }
.p-key {
  width: 100%;
  background: #000;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  color: var(--fg);
  font-size: 10px;
  outline: none;
}
.p-key:focus { border-color: var(--accent-dim); }

.settings-row-modern {
  padding: 0 16px 16px;
  border-top: 1px solid var(--border);
  background: var(--card);
}

/* ── Utility Classes (CSP Fixes) ───────────────────────────────────────── */
.flex-row { display: flex; align-items: center; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.flex-1 { flex: 1; min-width: 0; }
.gap-4 { gap: 4px; }
.mt-10 { margin-top: 10px; }
.mt-20 { margin-top: 20px; }
.ml-auto { margin-left: auto; }
.w-auto { width: auto !important; }
.text-center { text-align: center; }

.sub-text-tiny { font-size: 8px; opacity: 0.5; font-weight: 400; text-transform: none; }
.btn-tiny-flat { margin: 0; padding: 2px 6px; font-size: 10px; background: var(--border); color: var(--fg); border-radius: 4px; border: none; cursor: pointer; }
.btn-tiny-flat:hover { background: var(--glass); }
.btn-fix-magic { background: var(--primary); color: #000; font-weight: 700; }

.h24 { height: 24px; font-size: 10px; }
.flex-2 { flex: 2; }

.footer-box { padding: 20px; text-align: center; opacity: 0.5; font-size: 10px; }
.ai-expl-box { padding: 10px; }

/* ── Usage Panel ────────────────────────────────────────────────────────── */
.usage-summary-card {
  background: linear-gradient(135deg, var(--card) 0%, var(--bg2) 100%);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  margin-bottom: 20px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.u-title { font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: var(--fg-dim); margin-bottom: 8px; }
.u-val { font-size: 32px; font-weight: 800; color: var(--accent); margin-bottom: 4px; }
.u-sub { font-size: 11px; color: var(--fg-dim); }

.u-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--card2);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-bottom: 8px;
  transition: transform 0.2s;
}
.u-item:hover { transform: translateX(4px); border-color: var(--fg-dim); }
.u-provider-info { display: flex; flex-direction: column; gap: 2px; }
.u-name { font-size: 12px; font-weight: 700; color: var(--accent); text-transform: capitalize; }
.u-count { font-size: 10px; color: var(--fg-dim); }
.u-stats { text-align: right; }
.u-cost { font-size: 12px; font-weight: 700; color: var(--success); }
.u-tokens { font-size: 9px; color: var(--fg-dim); }

.u-clear-btn {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px solid var(--error);
  color: var(--error);
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  margin-top: 20px;
  transition: all 0.2s;
}
.u-clear-btn:hover { background: rgba(255, 68, 68, 0.1); }

/* ── Vault Panel ────────────────────────────────────────────────────────── */
.vault-header { padding: 16px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.v-title { font-size: 18px; font-weight: 800; color: var(--accent); margin-bottom: 4px; }
.vault-item { 
  background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 12px;
  display: flex; flex-direction: column; gap: 12px; transition: all 0.2s;
}
.vault-item:hover { border-color: var(--fg-dim); background: var(--card2); }
.v-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.v-info { flex: 1; }
.v-name { font-size: 14px; font-weight: 700; color: var(--accent); margin-bottom: 2px; }
.v-env { font-size: 10px; font-family: monospace; color: var(--fg-dim); background: var(--bg2); padding: 2px 6px; border-radius: 4px; display: inline-block; }
.v-input-row { display: flex; gap: 8px; }
.v-input { 
  flex: 1; background: #000; border: 1px solid var(--border); border-radius: 6px; 
  padding: 8px 12px; color: var(--fg); font-size: 12px; outline: none; 
}
.v-input:focus { border-color: var(--accent); }
.v-actions { display: flex; gap: 8px; }
.v-btn { 
  padding: 8px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s;
  border: 1px solid var(--border); background: var(--bg2); color: var(--fg);
}
.v-btn:hover { background: var(--glass); border-color: var(--fg); }
.v-btn.primary { background: var(--accent); color: #000; border: none; }
.v-btn.primary:hover { background: var(--primary); }
.v-btn.danger { color: var(--error); border-color: var(--error); background: transparent; }
.v-btn.danger:hover { background: rgba(255, 68, 68, 0.1); }

.vault-add-box {
  margin-top: 24px; padding: 20px; border: 2px dashed var(--border); border-radius: 12px;
  display: flex; flex-direction: column; gap: 12px; background: rgba(255,255,255,0.01);
}
.vault-add-box input {
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 14px; color: var(--fg); font-size: 12px; outline: none;
}
.vault-add-box input:focus { border-color: var(--accent-dim); }
#vault-add-btn {
  background: var(--accent); color: #000; border: none; padding: 12px; border-radius: 8px;
  font-weight: 800; cursor: pointer; font-size: 12px; transition: all 0.2s;
}
#vault-add-btn:hover { background: var(--primary); transform: translateY(-2px); }


code { background: var(--card2); padding: 2px 4px; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; }
pre { background: #000; padding: 10px; border-radius: 6px; border: 1px solid var(--border); overflow-x: auto; }
pre code { background: transparent; padding: 0; font-size: 11px; }
`;