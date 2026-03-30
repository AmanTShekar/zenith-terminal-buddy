import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import {
  CommandEntry, Suggestion, GitStatus, WorkspaceMap,
  PetState, ErrorExplanation, PanelMessage,
} from '../types';
import { CommandLogger } from '../core/CommandLogger';
import { RuleEngine } from '../core/RuleEngine';
import { DependencyDetector } from '../core/DependencyDetector';
import { ProjectScanner } from '../core/ProjectScanner';
import { GitHelper } from '../core/GitHelper';
import { SuggestionEngine } from '../core/SuggestionEngine';
import { PetManager } from '../pet/PetManager';
import { AIClient } from '../ai/AIClient';
import { TerminalWatcher } from '../core/TerminalWatcher';
import { generateCommandPrompt } from '../ai/prompts';

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly commandLogger: CommandLogger,
    private readonly ruleEngine: RuleEngine,
    private readonly dependencyDetector: DependencyDetector,
    private readonly projectScanner: ProjectScanner,
    private readonly gitHelper: GitHelper,
    private readonly suggestionEngine: SuggestionEngine,
    private readonly petManager: PetManager,
    private readonly aiClient: AIClient,
    private readonly terminalWatcher: TerminalWatcher,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: PanelMessage) => {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        console.error('[Terminal Buddy] Panel message error:', err);
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendInitialState();
      }
    });

    const healthInterval = setInterval(() => {
      if (!this.view?.visible) return;
      const activeTerm = vscode.window.activeTerminal;
      const status = activeTerm ? (activeTerm.shellIntegration ? 'active' : 'warn') : 'error';
      this.post({ type: 'updateHealth', payload: { status } });
    }, 5000);

    webviewView.onDidDispose(() => clearInterval(healthInterval));

    this.petManager.onDidChange((state) => {
      this.sendPetState(state);
    });
  }

  private post(msg: PanelMessage): void {
    this.view?.webview.postMessage(msg).then(undefined, () => {});
  }

  sendLog(entries: CommandEntry[]): void {
    this.post({ type: 'updateLog', payload: entries });
  }

  sendSuggestions(suggestions: Suggestion[]): void {
    this.post({ type: 'updateSuggestions', payload: suggestions });
  }

  sendPetState(state: PetState): void {
    const avatar = this.petManager.getEmoji();
    this.post({ type: 'updatePetState', payload: { ...state, avatar } });
  }

  sendExplanation(explanation: ErrorExplanation): void {
    this.post({ type: 'showExplanation', payload: explanation });
  }

  sendGitStatus(status: GitStatus | null): void {
    this.post({ type: 'updateGitStatus', payload: status });
  }

  sendWorkspaceMap(map: WorkspaceMap): void {
    this.post({ type: 'updateWorkspaceMap', payload: map });
    this.post({ type: 'updateExplorer', payload: map });
  }

  sendStats(stats: { total: number; ok: number; error: number; warning: number }): void {
    this.post({ type: 'updateStats', payload: stats });
  }

  sendActiveCommands(): void {
    const active = this.terminalWatcher.getActiveCommands();
    this.post({ type: 'updateActiveCommands', payload: active });
  }

  sendAiThinking(): void {
    this.post({ type: 'aiThinking' });
  }

  playAlertSound(): void {
    this.post({ type: 'playAlert' });
  }

  sendWarning(message: string): void {
    this.post({ type: 'showWarning', payload: { message } });
  }

  sendSafetyAlert(audit: any, cmd: string): void {
    this.post({ type: 'safetyAlert', payload: { audit, cmd } });
  }

  private async sendInitialState(): Promise<void> {
    this.sendLog(this.commandLogger.getRecent(50));
    this.sendStats(this.commandLogger.getStats());
    this.sendPetState(this.petManager.getState());
    this.sendActiveCommands();
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
      const gitStatus = await this.gitHelper.getStatus(folders[0].uri.fsPath);
      this.sendGitStatus(gitStatus);
      this.sendWorkspaceMap(this.projectScanner.getMap());
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource} https:;">
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: rgba(128,128,128,0.2);
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --glass: rgba(128, 128, 128, 0.1);
      --success: #4ade80;
      --error: #f87171;
      --warn: #fbbf24;
      --font-mono: var(--vscode-editor-font-family);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    
    .header { 
      padding: 8px 12px; 
      border-bottom: 1px solid var(--border); 
      display: flex; 
      align-items: center; 
      justify-content: space-between; 
      background: var(--glass); 
      backdrop-filter: blur(10px);
      flex-shrink: 0; 
    }
    .pet-section { display: flex; align-items: center; gap: 8px; }
    .pet-avatar { font-size: 20px; animation: bounce 2s infinite; }
    @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    
    .header-actions { display: flex; gap: 8px; }
    .icon-btn { 
      background: transparent; 
      border: none; 
      color: var(--fg); 
      cursor: pointer; 
      opacity: 0.7; 
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover { opacity: 1; background: var(--glass); }

    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--border); flex-shrink: 0; gap: 1px; }
    .stat-item { display: flex; flex-direction: column; align-items: center; padding: 4px; background: var(--bg); }
    .stat-value { font-weight: 700; font-size: 10px; }
    .stat-label { font-size: 7px; text-transform: uppercase; opacity: 0.5; }

    .tabs-header { display: flex; border-bottom: 1px solid var(--border); background: var(--glass); flex-shrink: 0; }
    .tab-btn { flex: 1; padding: 10px; font-size: 10px; font-weight: 700; background: transparent; border: none; color: var(--fg); opacity: 0.6; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.2s; }
    .tab-btn.active { opacity: 1; border-bottom-color: var(--accent); background: rgba(128,128,128,0.05); }

    .tab-container { flex: 1; overflow: hidden; position: relative; }
    .tab-content { position: absolute; inset: 0; padding: 0; overflow-y: auto; display: none; }
    .tab-content.active { display: flex; flex-direction: column; }

    .scroll-area { flex: 1; overflow-y: auto; padding: 12px; }

    .card { background: var(--glass); border: 1px solid var(--border); border-radius: 6px; padding: 10px; margin-bottom: 8px; position: relative; overflow: hidden; }
    .card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--accent); opacity: 0.3; }
    .card.error::before { background: var(--error); opacity: 0.8; }
    .card-title { font-weight: 700; font-size: 11px; margin-bottom: 4px; font-family: var(--font-mono); }
    .card-body { font-size: 10px; opacity: 0.8; line-height: 1.4; white-space: pre-wrap; word-break: break-all; }

    .btn { padding: 6px 12px; border-radius: 4px; border: none; background: var(--accent); color: white; cursor: pointer; font-size: 10px; font-weight: 600; }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary { background: var(--glass); color: var(--fg); border: 1px solid var(--border); }

    .ai-chat-container { display: flex; flex-direction: column; height: 100%; }
    .chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .msg { padding: 10px 14px; border-radius: 12px; max-width: 90%; font-size: 11px; line-height: 1.5; }
    .msg-ai { align-self: flex-start; background: var(--glass); border: 1px solid var(--border); border-bottom-left-radius: 2px; }
    .msg-user { align-self: flex-end; background: var(--accent); color: white; border-bottom-right-radius: 2px; }

    .input-row { padding: 12px; background: var(--glass); border-top: 1px solid var(--border); display: flex; gap: 8px; }
    .input-row input { flex: 1; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 11px; outline: none; }
    .input-row input:focus { border-color: var(--accent); }

    .explorer-item { display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; font-size: 11px; border-radius: 6px; transition: background 0.2s; }
    .explorer-item:hover { background: var(--glass); }
    
    .safety-banner { background: rgba(239, 68, 68, 0.1); border: 1px solid var(--error); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
    .safety-title { color: var(--error); font-weight: 800; font-size: 11px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
    .safety-cmd { font-family: var(--font-mono); font-size: 10px; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; margin: 8px 0; word-break: break-all; }
    
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; opacity: 0.4; text-align: center; padding: 40px; }
    .empty-icon { font-size: 40px; margin-bottom: 12px; }
    
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  </style>
</head>
<body>
  <header class="header">
    <div class="pet-section">
      <div class="pet-avatar" id="petAvatar">🐾</div>
      <div>
        <div style="font-weight:700; font-size:11px" id="petName">Buddy</div>
        <div style="font-size:9px; opacity:0.6" id="petLevel">Connecting...</div>
      </div>
    </div>
    <div class="header-actions">
      <button class="icon-btn" title="Clear History" id="clearBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
      <button class="icon-btn" title="Settings" id="settingsBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  </header>

  <div class="stats-row">
    <div class="stat-item"><span class="stat-value" id="statTotal">0</span><span class="stat-label">Execs</span></div>
    <div class="stat-item"><span class="stat-value" id="statOk" style="color:var(--success)">0</span><span class="stat-label">OK</span></div>
    <div class="stat-item"><span class="stat-value" id="statFail" style="color:var(--error)">0</span><span class="stat-label">Fail</span></div>
    <div class="stat-item"><span class="stat-value" id="statSafety" style="color:var(--warn)">0</span><span class="stat-label">Risk</span></div>
  </div>

  <nav class="tabs-header">
    <button class="tab-btn active" data-tab="tab-logs">CONSOLE</button>
    <button class="tab-btn" data-tab="tab-explorer">NAVIGATOR</button>
    <button class="tab-btn" data-tab="tab-chat">ASK</button>
  </nav>

  <div class="tab-container">
    <div class="tab-content active" id="tab-logs">
      <div style="padding:10px; border-bottom:1px solid var(--border)">
        <input type="text" id="historySearch" style="width:100%; padding:8px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--fg); font-size:10px" placeholder="🔍 Search components or history...">
      </div>
      <div class="scroll-area" id="logList">
        <div class="empty-state"><div class="empty-icon">📂</div><div>No terminal history yet.</div></div>
      </div>
      <div id="safetyAlertArea" style="padding:0 12px"></div>
    </div>

    <div class="tab-content" id="tab-explorer">
      <div id="explorerPath" style="font-size:9px; opacity:0.6; padding:10px 12px 0"></div>
      <div class="scroll-area" id="explorerList"></div>
    </div>

    <div class="tab-content" id="tab-chat">
      <div class="ai-chat-container">
        <div class="chat-messages" id="chatList">
            <div class="msg msg-ai">Hello! I'm Buddy. I'm watching your terminal for any issues. Ask me anything!</div>
        </div>
        <div class="input-row">
          <input type="text" id="chatInput" placeholder="Ask about error, folder, etc...">
          <button class="btn" id="sendChatBtn">SEND</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const el = (id) => document.getElementById(id);
      let currentAiMsgEl = null;

      // Handle Tab Switching
      document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (btn) {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
          el(btn.dataset.tab).classList.add('active');
        }
      });

      // UI Action Listeners
      el('clearBtn').onclick = () => vscode.postMessage({ type: 'clearHistory' });
      el('settingsBtn').onclick = () => vscode.postMessage({ type: 'openSettings' });

      window.addEventListener('message', (e) => {
        const { type, payload } = e.data;
        
        switch (type) {
          case 'updateLog':
            if (payload.length === 0) {
              el('logList').innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><div>No terminal history yet.</div></div>';
            } else {
              el('logList').innerHTML = payload.map(log => {
                const isError = log.status === 'error';
                return '<div class="card ' + (isError ? 'error' : '') + '">' +
                  '<div class="card-title">' + log.cmd + '</div>' +
                  (log.errorOutput ? '<div class="card-body" style="color:var(--error); margin-top:4px">' + log.errorOutput.substring(0, 500) + '...</div>' : '') +
                  '<div style="font-size:8px; opacity:0.4; margin-top:6px">' + new Date(log.timestamp).toLocaleTimeString() + ' • ' + log.project + '</div>' +
                '</div>';
              }).join('');
            }
            break;

          case 'updateStats':
            el('statTotal').textContent = payload.total;
            el('statOk').textContent = payload.ok;
            el('statFail').textContent = payload.error;
            el('statSafety').textContent = payload.warning;
            break;

          case 'updatePetState':
            el('petLevel').textContent = 'Lv. ' + payload.level + ' • ' + payload.mood;
            el('petAvatar').textContent = payload.avatar;
            el('petName').textContent = payload.name;
            break;

          case 'updateExplorer':
            const project = payload.projects[0];
            if (project) {
              el('explorerPath').textContent = project.fsPath;
              el('explorerList').innerHTML = project.topLevelFiles.map(f => {
                const isDir = !f.includes('.');
                return '<div class="explorer-item" onclick="window.navTo(\\'' + project.fsPath.replace(/\\\\/g, '/') + '/' + f + '\\', ' + isDir + ')">' +
                  '<span>' + (isDir ? '📁' : '📄') + '</span>' +
                  '<span>' + f + '</span>' +
                '</div>';
              }).join('');
            }
            break;

          case 'safetyAlert':
            el('safetyAlertArea').innerHTML = 
              '<div class="safety-banner">' +
                '<div class="safety-title">⚠️ GUARDIAN INTERCEPT</div>' +
                '<div class="safety-cmd">' + payload.cmd + '</div>' +
                '<div style="font-size:10px; margin-bottom:10px">' + payload.audit.explanation + '</div>' +
                '<div style="display:flex; gap:8px">' +
                  '<button class="btn" onclick="window.confirmSafety(\\'' + payload.cmd + '\\')">RUN ANYWAY</button>' +
                  '<button class="btn btn-secondary" onclick="document.getElementById(\\'safetyAlertArea\\').innerHTML=\\'\\'">CANCEL</button>' +
                '</div>' +
              '</div>';
            el('tab-logs').scrollTop = 0;
            break;

          case 'aiChunk':
            if (!currentAiMsgEl) {
              currentAiMsgEl = document.createElement('div');
              currentAiMsgEl.className = 'msg msg-ai';
              el('chatList').appendChild(currentAiMsgEl);
            }
            currentAiMsgEl.innerHTML += payload.chunk.replace(/\\n/g, '<br>');
            el('chatList').scrollTop = el('chatList').scrollHeight;
            break;

          case 'aiStreamStart':
            currentAiMsgEl = null;
            break;

          case 'searchResult':
            el('logList').innerHTML = payload.results.map(log => 
              '<div class="card"><div class="card-title">' + log.cmd + '</div>' +
              '<div style="font-size:8px; opacity:0.4">' + log.project + '</div></div>'
            ).join('');
            break;
        }
      });

      window.navTo = (path, isDir) => {
        if (isDir) vscode.postMessage({ type: 'cd', payload: { dir: path } });
      };

      window.confirmSafety = (cmd) => {
        vscode.postMessage({ type: 'confirmDangerousCommand', payload: { cmd } });
        el('safetyAlertArea').innerHTML = '';
      };

      el('sendChatBtn').onclick = () => {
        const text = el('chatInput').value;
        if (!text) return;
        const umsg = document.createElement('div');
        umsg.className = 'msg msg-user';
        umsg.textContent = text;
        el('chatList').appendChild(umsg);
        el('chatInput').value = '';
        vscode.postMessage({ type: 'askDoubt', payload: { question: text } });
      };

      el('chatInput').onkeydown = (e) => {
        if (e.key === 'Enter') el('sendChatBtn').click();
      };

      el('historySearch').onkeydown = (e) => {
        if (e.key === 'Enter') vscode.postMessage({ type: 'searchHistory', payload: { query: e.target.value } });
      };

      // INIT SIGNAL
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }

  private async handleMessage(msg: PanelMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.sendInitialState();
        break;
      case 'clearHistory':
        await vscode.commands.executeCommand('terminalBuddy.clearHistory');
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'terminalBuddy');
        break;
      case 'copyToClipboard': {
        const { text } = msg.payload as { text: string };
        await vscode.env.clipboard.writeText(text);
        break;
      }
      case 'runCommand': {
        const { cmd, dir } = msg.payload as { cmd: string; dir?: string };
        let terminal = vscode.window.activeTerminal;
        if (!terminal) terminal = vscode.window.createTerminal('Terminal Buddy');
        terminal.show();
        if (dir) {
          const isWindows = process.platform === 'win32';
          const path = dir.replace(/\\/g, '/');
          terminal.sendText(`cd ${isWindows ? `"${path}"` : `'${path}'`}`);
        }
        terminal.sendText(cmd);
        break;
      }
      case 'askDoubt': {
        const { question } = msg.payload as { question: string };
        const lastError = this.commandLogger.getLastError();
        this.post({ type: 'aiStreamStart' });
        try {
          const cmd = lastError?.cmd || 'N/A';
          const output = lastError?.errorOutput || 'No recent errors.';
          for await (const chunk of this.aiClient.askDoubtStream(cmd, output, question)) {
            this.post({ type: 'aiChunk', payload: { chunk } });
          }
        } finally {
          this.post({ type: 'aiStreamEnd' });
        }
        break;
      }
      case 'cd': {
        const { dir } = msg.payload as { dir: string };
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Terminal Buddy');
        terminal.show();
        const isWindows = process.platform === 'win32';
        terminal.sendText(`cd ${isWindows ? `"${dir}"` : `'${dir}'`}`);
        break;
      }
      case 'confirmDangerousCommand': {
        const { cmd } = msg.payload as { cmd: string };
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Terminal Buddy');
        terminal.show();
        terminal.sendText(cmd);
        break;
      }
      case 'searchHistory': {
        const { query } = msg.payload as { query: string };
        const logs = this.commandLogger.getRecent(100);
        this.post({ type: 'aiThinking' });
        const result = await this.aiClient.searchHistory(query, logs);
        if (result) this.post({ type: 'searchResult', payload: { results: result } });
        break;
      }
    }
  }
}
