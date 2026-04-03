export const PANEL_CSS = `
:root {
  --bg: #0d1117;
  --card: #161b22;
  --card2: #1f2937;
  --border: #30363d;
  --fg: #c9d1d9;
  --dim: #8b949e;
  --accent: #58a6ff;
  --agl: rgba(88, 166, 255, .12);
  --ok: #3fb950;
  --warn: #d29922;
  --err: #f85149;
  --mono: 'JetBrains Mono', 'Fira Code', monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

#warn-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  background: var(--warn);
  color: #000;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  z-index: 101;
  display: none;
}

#hdr {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.logo {
  font-weight: 700;
  font-size: 13px;
  background: linear-gradient(135deg, #fff, var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

#ai-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 20px;
  background: var(--agl);
  color: var(--accent);
  border: 1px solid rgba(88, 166, 255, .25);
  white-space: nowrap;
  overflow: hidden;
  max-width: 130px;
  text-overflow: ellipsis;
}

#pet {
  margin: 10px;
  padding: 10px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

#pet-emoji {
  font-size: 26px;
  line-height: 1;
  transition: transform .2s;
}

.pet-bounce { animation: bounce .4s cubic-bezier(.36, 0, .66, -.56); }

@keyframes bounce {
  0%, 100% { transform: scale(1) }
  50% { transform: scale(1.25) }
}

#pet-info { flex: 1; min-width: 0; }
#pet-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; }
#pet-name { font-weight: 600; font-size: 12px; }
#pet-lv { font-size: 10px; background: var(--border); padding: 1px 6px; border-radius: 10px; color: var(--dim); }
#pet-mood { font-size: 11px; color: var(--dim); text-transform: capitalize; margin-bottom: 4px; }
#xp-track { height: 3px; background: rgba(255, 255, 255, .07); border-radius: 2px; overflow: hidden; }
#xp-fill { height: 100%; width: 0; background: var(--accent); transition: width .5s ease; border-radius: 2px; }

/* FIX: stats bar — HTML uses .st-item/.st-val/.st-label, was .stat/.stat span */
#stats-bar {
  display: flex;
  gap: 6px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.st-item { font-size: 10px; color: var(--dim); display: flex; gap: 4px; align-items: baseline; }
.st-val { font-weight: 600; color: var(--fg); }
.st-label { font-size: 9px; }
#st-ok .st-val { color: var(--ok); }
#st-err .st-val { color: var(--err); }

#tabs {
  display: flex;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
#tabs::-webkit-scrollbar { display: none; }
.tab { padding: 8px 10px; font-size: 11px; font-weight: 500; color: var(--dim); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; transition: color .15s; }
.tab:hover { color: var(--fg); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-badge { display: inline-block; background: var(--err); color: #fff; font-size: 9px; padding: 0 4px; border-radius: 8px; margin-left: 3px; line-height: 14px; }

#panels { flex: 1; position: relative; overflow: hidden; }
.panel { position: absolute; inset: 0; display: none; flex-direction: column; overflow: hidden; }
.panel.active { display: flex; }

.scroll { flex: 1; overflow-y: auto; padding: 10px; }
.scroll::-webkit-scrollbar { width: 4px; }
.scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

#panel-chat { padding: 0; display: none; flex-direction: column; }
#panel-chat.active { display: flex; }
#chat-msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
#chat-msgs::-webkit-scrollbar { width: 4px; }
#chat-msgs::-webkit-scrollbar-thumb { background: var(--border); }

.msg { max-width: 88%; padding: 8px 12px; border-radius: 10px; font-size: 12px; line-height: 1.6; word-break: break-word; }
.msg.buddy { align-self: flex-start; background: var(--card); border: 1px solid var(--border); border-bottom-left-radius: 2px; }
.msg.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 2px; }

/* FIX: thinking bubble style — was missing, causing it to inherit .msg.buddy partially */
.msg.thinking {
  align-self: flex-start;
  background: var(--card2);
  border: 1px dashed var(--border);
  border-bottom-left-radius: 2px;
  color: var(--dim);
  font-style: italic;
}
.thinking-dots::after {
  content: '...';
  animation: dots 1.2s steps(4, end) infinite;
}
@keyframes dots {
  0%, 100% { content: '.'; }
  33% { content: '..'; }
  66% { content: '...'; }
}

#chat-input-area { padding: 10px; border-top: 1px solid var(--border); display: flex; gap: 8px; align-items: flex-end; background: var(--bg); }
#chat-input { flex: 1; min-height: 36px; max-height: 100px; background: var(--card); border: 1px solid var(--border); border-radius: 18px; padding: 10px 14px; color: var(--fg); font-family: inherit; font-size: 12px; resize: none; outline: none; }
#chat-input:focus { border-color: var(--accent); }
#send-btn { width: 36px; height: 36px; border-radius: 18px; background: var(--accent); color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

.entry { background: var(--card); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; transition: all 0.2s; cursor: pointer; overflow: hidden; position: relative; }
.entry:hover { border-color: var(--accent); background: rgba(255, 255, 255, 0.03); }
.entry.err { border-left: 3px solid var(--err); }
.entry.warn { border-left: 3px solid var(--warn); }
.entry.ok { border-left: 3px solid var(--ok); }

.entry-header { padding: 10px; display: flex; align-items: center; gap: 10px; }
.entry-status-icon { font-size: 12px; min-width: 14px; text-align: center; }
.entry-summary { flex: 1; min-width: 0; }
.entry-cmd-text { font-family: var(--mono); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); }
.entry-sub { font-size: 9px; color: var(--dim); margin-top: 2px; display: flex; gap: 8px; }

.entry-details { display: none; padding: 0 10px 10px 34px; border-top: 1px solid rgba(255, 255, 255, 0.03); animation: slideDown 0.2s ease-out; }
.entry.expanded .entry-details { display: block; }
.entry.expanded .entry-cmd-text { white-space: normal; }

@keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }

.entry-full-cmd { background: rgba(0, 0, 0, 0.2); padding: 6px; border-radius: 4px; font-family: var(--mono); font-size: 10px; margin-top: 8px; word-break: break-all; color: var(--accent); }
.entry-footer { margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px; }

.card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin-bottom: 8px; }
.ask-btn { background: var(--agl); color: var(--accent); border: none; padding: 2px 8px; border-radius: 10px; font-size: 10px; cursor: pointer; }
.run-btn { background: var(--ok); color: #fff; border: none; padding: 4px 10px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: bold; }
.kill-btn { background: var(--err); color: #fff; border: none; padding: 4px 10px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: bold; }

.branch-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; background: var(--card2); font-weight: 600; margin-bottom: 8px; font-size: 11px; }
.git-file { display: flex; gap: 8px; font-size: 11px; font-family: var(--mono); margin-bottom: 4px; }
.git-s { min-width: 14px; font-weight: bold; }
.git-s.M { color: var(--warn); }
.git-s.A { color: var(--ok); }
.git-s.D { color: var(--err); }
.git-tip { margin-top: 12px; padding: 10px; background: rgba(88, 166, 255, .08); border: 1px solid rgba(88, 166, 255, .2); border-radius: 6px; font-size: 11px; }

.explain-card { margin-top: 4px; }
.ec-label { font-size: 10px; font-weight: 700; color: var(--accent); text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; }
.ec-fix { margin-top: 8px; padding: 8px; background: rgba(63, 185, 80, .1); border: 1px solid rgba(63, 185, 80, .2); border-radius: 6px; }
.sug-btn { display: inline-block; margin: 4px 4px 0 0; padding: 4px 10px; background: var(--card2); border: 1px solid var(--border); border-radius: 4px; font-family: var(--mono); cursor: pointer; font-size: 10px; }
.sug-btn:hover { border-color: var(--accent); }

.spin { width: 12px; height: 12px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg) } }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 5px var(--ok); }

#safety-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(4px); z-index: 999; display: none; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
#safety-overlay.show { display: flex; }
.s-box { background: var(--card); border: 1px solid var(--err); border-radius: 12px; padding: 20px; max-width: 300px; width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(248, 81, 73, 0.2); }
.s-icon { font-size: 40px; margin-bottom: 10px; }
.s-title { font-size: 16px; font-weight: 700; color: var(--err); margin-bottom: 8px; }
#safety-msg { font-size: 12px; color: var(--fg); margin-bottom: 12px; line-height: 1.5; }
#safety-cmd-preview { background: var(--bg); color: var(--err); font-family: var(--mono); font-size: 11px; padding: 8px; border-radius: 6px; margin-bottom: 16px; word-break: break-all; border: 1px solid rgba(248, 81, 73, 0.3); }
.s-btns { display: flex; gap: 10px; justify-content: center; }
.s-btn { flex: 1; padding: 8px; border-radius: 6px; border: none; font-weight: 600; cursor: pointer; }
#s-cancel { background: var(--card2); color: var(--fg); }
#s-run { background: var(--err); color: #fff; }

/* FIX: log panel — filter bar must be outside .scroll but inside .panel flex column */
#panel-log { flex-direction: column; }
.log-filter-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap; }
#log-search {
  flex: 1; min-width: 100px; background: var(--card); border: 1px solid var(--border); border-radius: 8px;
  padding: 6px 10px; font-size: 11px; color: var(--fg); outline: none; transition: border-color 0.2s;
}
#log-search:focus { border-color: var(--accent); }
#filter-toggle-btn {
  background: var(--card2); border: 1px solid var(--border); border-radius: 8px;
  padding: 5px 8px; cursor: pointer; color: var(--dim); transition: all 0.2s; font-size: 12px;
}
#filter-toggle-btn:hover { color: var(--fg); border-color: var(--dim); }
#filter-toggle-btn.active { background: var(--agl); color: var(--accent); border-color: var(--accent); }
.log-filters {
  display: none;
  width: 100%;
  gap: 8px;
  margin-top: 8px;
  grid-template-columns: repeat(2, 1fr);
  animation: slideDown 0.2s ease-out;
}
.log-filters.active { display: grid; }
.filter-select { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 10px; color: var(--fg); outline: none; width: 100%; }

.ai-mover { padding: 12px; background: var(--bg); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ai-mover-input {
  width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 10px;
  padding: 8px 12px 8px 34px; color: var(--fg); font-size: 11px; outline: none; transition: all 0.2s;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2358a6ff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: 10px center;
}
.ai-mover-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--agl); }
.explorer-tree { font-family: var(--mono); font-size: 0.9em; padding: 4px; }
.tree-node { font-size: 11px; padding: 2px 0; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background .1s; border-radius: 4px; padding: 4px 6px; }
.tree-node:hover { background: var(--agl); }
.tree-node.file { color: var(--fg); opacity: 0.8; }
.tree-node.folder { color: var(--accent); font-weight: 600; }

.terminal-list { padding: 10px; }
.terminal-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px; margin-bottom: 8px; padding: 10px; transition: transform 0.2s, background 0.2s;
}
.terminal-card:hover { background: rgba(255, 255, 255, 0.07); transform: translateY(-1px); }
.terminal-card.active { border-color: var(--accent); background: rgba(0, 122, 204, 0.1); }
.term-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.term-name { font-weight: bold; font-size: 0.9em; }
.term-purpose { font-size: 0.8em; opacity: 0.6; font-style: italic; }
.term-status { width: 8px; height: 8px; border-radius: 50%; background: #ccc; flex-shrink: 0; }
.term-status.executing { background: #4ec9b0; box-shadow: 0 0 8px #4ec9b0; }
.term-actions { display: flex; gap: 8px; margin-top: 8px; }

.tree-node-icon { width: 14px; text-align: center; }

.live-entry {
  background: var(--card); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px; transition: all 0.2s;
}
.live-entry:hover { border-color: var(--accent); background: var(--agl); }

.pkg-header { font-size: 10px; font-weight: 700; color: var(--accent); text-transform: uppercase; margin: 14px 4px 6px; letter-spacing: 0.5px; opacity: 0.8; }
.pkg-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pkg-name { font-weight: 600; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); }
.pkg-type { opacity: 0.5; font-size: 10px; }
.btn-sm.run-btn {
  background: var(--agl); color: var(--accent); border: 1px solid rgba(88, 166, 255, 0.2);
  text-transform: none; padding: 3px 8px;
}
.btn-sm.run-btn:hover { background: var(--accent); color: #fff; }

/* log-entry (used in renderLog) */
.log-entry { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: all 0.2s; position: relative; overflow: hidden; }
.log-entry:hover { border-color: var(--accent); background: var(--agl); transform: translateX(2px); }
.log-entry::after { content: '✨ explain'; position: absolute; right: 8px; top: 8px; font-size: 9px; color: var(--accent); opacity: 0; transition: opacity 0.2s; font-weight: 700; text-transform: uppercase; }
.log-entry:hover::after { opacity: 0.8; }
.log-entry.ok { border-left: 3px solid var(--ok); }
.log-entry.err { border-left: 3px solid var(--err); }
.log-cmd { font-family: var(--mono); font-size: 11px; word-break: break-all; padding-right: 60px; }

.pkg-group { margin-bottom: 16px; }
.pkg-group-header { font-size: 10px; font-weight: 700; color: var(--accent); text-transform: uppercase; padding: 4px 6px; background: var(--agl); border-radius: 4px; margin-bottom: 8px; letter-spacing: 0.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* chat live token */
.chat-live-token { background: var(--agl); color: var(--accent); border: 1px solid rgba(88,166,255,.2); border-radius: 4px; padding: 1px 6px; font-size: 11px; cursor: pointer; }

.empty { padding: 40px 20px; text-align: center; opacity: 0.5; }
.empty-icon { font-size: 32px; margin-bottom: 8px; }
.empty-text { font-size: 12px; }
`;