import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CommandLogger } from '../core/CommandLogger';
import { RuleEngine } from '../core/RuleEngine';
import { DependencyDetector } from '../core/DependencyDetector';
import { ProjectScanner } from '../core/ProjectScanner';
import { GitHelper } from '../core/GitHelper';
import { SuggestionEngine } from '../core/SuggestionEngine';
import { PetManager } from '../pet/PetManager';
import { AIClient } from '../ai/AIClient';
import { TerminalWatcher } from '../core/TerminalWatcher';
import { PortMonitor, ActivePort } from '../core/PortMonitor';
import { ExecutableScanner, Executable } from '../core/ExecutableScanner';
import { CommandEntry, WorkspaceMap, GitStatus, ErrorExplanation, Suggestion, ActiveCommand, PetState, AI_PROVIDERS, PetType, AIProviderType } from '../types';

interface PanelMessage {
  type: string;
  payload?: any;
}

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
    private readonly portMonitor: PortMonitor,
    private readonly executableScanner: ExecutableScanner
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: PanelMessage) => this.handleMessage(msg));

    this.sendInitialState();
    this.startBackgroundScans();
  }

  post(message: PanelMessage): void {
    this.view?.webview.postMessage(message);
  }

  sendLog(logs: CommandEntry[]): void {
    this.post({ type: 'updateLog', payload: logs });
  }

  sendPetState(state: PetState): void {
    this.post({ type: 'updatePetState', payload: state });
  }

  sendGitStatus(status: GitStatus | null): void {
    this.post({ type: 'updateGitStatus', payload: status });
  }

  sendActiveCommands(): void {
    const active = this.terminalWatcher.getActiveCommands();
    this.post({ type: 'updateActiveCommands', payload: active });
  }

  sendPorts(ports: ActivePort[]): void {
    this.post({ type: 'updatePorts', payload: ports });
  }

  sendAiInfo(provider: string): void {
    this.post({ type: 'updateAiInfo', payload: provider });
  }

  sendAiThinking(): void {
    this.post({ type: 'aiThinking' });
  }

  sendExplanation(explanation: any): void {
    this.post({ type: 'aiExplanation', payload: explanation });
  }

  sendSuggestions(suggestions: Suggestion[]): void {
    this.post({ type: 'updateSuggestions', payload: suggestions });
  }

  sendWorkspaceMap(map: WorkspaceMap): void {
    this.post({ type: 'updateWorkspaceMap', payload: map });
  }

  sendTerminalData(data: string): void {
    this.post({ type: 'terminalData', payload: data });
  }

  sendSafetyAlert(alert: any, cmd: string): void {
    this.post({ type: 'safetyAlert', payload: { alert, cmd } });
  }

  sendWarning(warning: string): void {
    this.post({ type: 'warning', payload: warning });
  }

  sendStats(stats: any): void {
    this.post({ type: 'updateStats', payload: stats });
  }

  playAlertSound(): void {
    this.post({ type: 'playSound', payload: 'alert' });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-sideBar-foreground);
      --accent: var(--vscode-button-background);
      --border: var(--vscode-sideBar-border, rgba(128,128,128,0.2));
      --glass: rgba(255, 255, 255, 0.04);
      --bubble-buddy: var(--vscode-editor-background);
      --bubble-me: var(--vscode-button-background);
      --error: #f87171;
    }
    * { box-sizing: border-box; }
    body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); margin: 0; padding: 0; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
    
    .header-fixed { flex-shrink: 0; position: sticky; top: 0; background: var(--bg); z-index: 1000; border-bottom: 1px solid var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
    .header { padding: 16px; display: flex; align-items: center; gap: 12px; background: var(--glass); backdrop-filter: blur(10px); position: relative; }
    
    #ai-pill { position: absolute; top: 6px; right: 10px; font-size: 8px; font-weight: 900; background: var(--accent); color: white; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; opacity: 0.8; letter-spacing: 0.5px; }
    
    #pet-container { font-size: 32px; filter: drop-shadow(0 0 5px var(--accent)); transition: 0.3s; cursor: pointer; }
    
    .pillars { display: flex; background: var(--bg); border-bottom: 1px solid var(--border); }
    .pillar-btn { flex: 1; padding: 12px 2px; text-align: center; cursor: pointer; font-size: 9px; opacity: 0.6; transition: 0.2s; border-bottom: 2px solid transparent; font-weight: 800; }
    .pillar-btn:hover { opacity: 1; background: var(--glass); }
    .pillar-btn.active { opacity: 1; border-color: var(--accent); color: var(--accent); background: var(--glass); }
    
    #main-content { flex: 1; overflow-y: auto; padding: 12px; scroll-behavior: smooth; }
    
    .bubble { max-width: 90%; padding: 10px 14px; border-radius: 12px; font-size: 11px; line-height: 1.5; box-shadow: 0 4px 10px -2px rgba(0,0,0,0.2); word-wrap: break-word; position: relative; animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .bubble.buddy { background: var(--bubble-buddy); align-self: flex-start; border-bottom-left-radius: 2px; border: 1px solid var(--border); }
    .bubble.me { background: var(--bubble-me); color: white; align-self: flex-end; border-bottom-right-radius: 2px; }
    
    .cmd-block { background: rgba(128,128,128,0.1); padding: 8px; border-radius: 6px; font-size: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; border: 1px solid rgba(128,128,128,0.1); }
    .cmd-run { background: var(--accent); color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 9px; cursor: pointer; font-weight: 700; white-space: nowrap; }
    .cmd-run:hover { filter: brightness(1.2); }

    .chat-footer { flex-shrink: 0; padding: 12px; border-top: 1px solid var(--border); display: flex; gap: 8px; background: var(--bg); }
    #chat-input { flex: 1; background: var(--glass); border: 1px solid var(--border); color: var(--fg); padding: 8px 16px; border-radius: 20px; outline: none; font-size: 11px; }

    .list-card { padding: 12px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; background: var(--glass); border-radius: 8px; border: 1px solid rgba(128,128,128,0.1); }
    
    .repo-link { font-size: 10px; color: var(--accent); cursor: pointer; text-decoration: none; opacity: 0.7; font-weight: bold; display: inline-flex; align-items: center; gap: 3px; }
    .repo-link:hover { opacity: 1; text-decoration: underline; }
    .hidden { display: none !important; }

    @keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-4px); } 100% { transform: translateY(0px); } }
    .pet-floating { animation: float 3s ease-in-out infinite; }
    @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-7px); } }
    .pet-bounce { animation: bounce 0.4s ease infinite alternate; }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
    .pet-fail { animation: shake 0.2s ease infinite; }
  </style>
</head>
<body>
  <div id="dashboard-ui">
    <div class="header-fixed">
      <div class="header">
        <div id="ai-pill">AI READY</div>
        <div id="pet-container" class="pet-floating" onclick="vscode.postMessage({type:'runCommand',payload:'echo Hello!'})">🐱</div>
        <div style="flex:1; overflow:hidden">
          <div style="font-weight: 800; font-size: 14px" id="pet-name">Buddy</div>
          <div id="repo-container"></div>
        </div>
        <div style="text-align: right">
           <div style="opacity: 0.6; font-size: 9px; font-weight: bold" id="pet-status">Lv.1 • IDLE</div>
           <div style="font-size: 8px; opacity: 0.4">TOTAL BUDDY v2</div>
        </div>
      </div>

      <div class="pillars">
        <div class="pillar-btn active" id="pill-chat" onclick="setTab('chat')">💬 CHAT</div>
        <div class="pillar-btn" id="pill-history" onclick="setTab('history')">📜 HISTORY</div>
        <div class="pillar-btn" id="pill-running" onclick="setTab('running')">🏃 RUNNING</div>
        <div class="pillar-btn" id="pill-git" onclick="setTab('git')">🌿 GIT</div>
      </div>
    </div>

    <div id="main-content">
      <div id="view-chat">
         <div id="chat-messages" style="display:flex; flex-direction:column; gap:12px">
            <div class="bubble buddy">I'm watching your terminal! If a command crashes, I'll explain why and help you fix it.</div>
         </div>
      </div>

      <div id="view-history" class="hidden">
         <div style="display:flex; gap:8px; margin-bottom:12px; align-items:center; flex-wrap:wrap;">
            <input type="text" id="history-filter" placeholder="Search history..." oninput="renderHistory()" style="flex:1; background:var(--glass); border:1px solid var(--border); padding:6px 12px; border-radius:4px; color:var(--fg); font-size:10px; min-width: 120px;">
            <select id="history-sort" onchange="renderHistory()" style="background:var(--glass); border:1px solid var(--border); padding:6px; border-radius:4px; color:var(--fg); font-size:10px; outline:none; max-width: 90px;">
               <option value="newest">Latest</option>
               <option value="oldest">Oldest</option>
               <option value="error">Failed</option>
            </select>
            <label style="font-size:9px; display:flex; align-items:center; gap:4px; opacity:0.7; cursor:pointer">
               <input type="checkbox" id="smart-history" onchange="renderHistory()" checked> SMART
            </label>
         </div>
         <div id="history-list"></div>
      </div>

      <div id="view-running" class="hidden">
         <div style="font-weight:800; opacity:0.4; font-size:9px; margin-bottom:12px">ACTIVE PROCESSES</div>
         <div id="running-list"></div>
         <div style="font-weight:800; opacity:0.4; font-size:9px; margin:20px 0 12px 0">OPEN PORTS (DEV)</div>
         <div id="port-list"></div>
      </div>

      <div id="view-git" class="hidden">
         <div style="background:var(--glass); padding:16px; border-radius:12px; margin-bottom:12px">
            <div style="font-weight:800; font-size:14px" id="git-branch">Scanning...</div>
            <div style="opacity:0.6; font-size:10px" id="git-status-text">Detecting repository changes...</div>
         </div>
         <div id="git-tree"></div>
      </div>
    </div>

    <div class="chat-footer" id="chat-footer">
      <input type="text" id="chat-input" placeholder="Ask Buddy...">
      <button class="cmd-run" id="send-btn" style="border-radius:50%; width:34px; height:34px; padding:0">➔</button>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const chatInput = document.getElementById('chat-input');
      const chatMessages = document.getElementById('chat-messages');
      const mainContent = document.getElementById('main-content');
      
      const petEmojis = {
        'cat': '🐱',
        'dog': '🐶',
        'robot': '🤖',
        'ghost': '👻'
      };

      let fullHistory = [];
      const NOISE_COMMANDS = ['ls', 'cd', 'clear', 'pwd', 'history', 'cls', 'dir'];

      window.setTab = function(tab) {
        document.querySelectorAll('.pillar-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('pill-' + tab).classList.add('active');
        ['chat', 'running', 'history', 'git'].forEach(v => {
           document.getElementById('view-' + v).classList.add('hidden');
        });
        document.getElementById('view-' + tab).classList.remove('hidden');
        document.getElementById('chat-footer').classList.toggle('hidden', tab !== 'chat');
      };

      window.addEventListener('message', event => {
        const { type, payload } = event.data;
        if (!type) return;

        switch(type) {
          case 'updateAiInfo':
            const pill = document.getElementById('ai-pill');
            if (pill) pill.innerText = payload;
            break;
          case 'updatePetState':
            const emoji = petEmojis[payload.type] || '🐱';
            const petCont = document.getElementById('pet-container');
            if (petCont) petCont.innerText = emoji;
            const petName = document.getElementById('pet-name');
            if (petName) petName.innerText = payload.name;
            const petStatus = document.getElementById('pet-status');
            if (petStatus) petStatus.innerText = 'Lv.' + payload.level + ' • ' + payload.mood.toUpperCase();
            updatePetAnimation(payload.mood);
            break;
          case 'updateLog':
            fullHistory = payload || [];
            renderHistory();
            break;
          case 'updatePorts': renderPorts(payload); break;
          case 'updateActiveCommands': renderRunning(payload); break;
          case 'updateGitStatus':
            const gitBranch = document.getElementById('git-branch');
            if (gitBranch) gitBranch.innerText = '🌿 ' + (payload?.branch || 'No Repo');
            const repoDiv = document.getElementById('repo-container');
            if (repoDiv) {
               if (payload?.remoteUrl) {
                  repoDiv.innerHTML = '';
                  const link = document.createElement('a');
                  link.className = 'repo-link';
                  link.title = 'Open Repository';
                  link.innerText = '🌍 Open Repo';
                  link.onclick = function() { vscode.postMessage({ type: 'openRepo', payload: payload.remoteUrl }); };
                  repoDiv.appendChild(link);
               } else {
                  repoDiv.innerHTML = '';
               }
            }
            break;
          case 'aiThinking':
            addBuddyThinking();
            break;
          case 'aiExplanation':
            removeBuddyThinking();
            addBuddyMessage(payload.summary, payload.suggestedCommands);
            break;
        }
      });

      function addBuddyThinking() {
        if (document.getElementById('buddy-thinking')) return;
        const div = document.createElement('div');
        div.className = 'bubble buddy';
        div.id = 'buddy-thinking';
        div.innerText = 'Thinking...';
        chatMessages.appendChild(div);
        mainContent.scrollTop = mainContent.scrollHeight;
      }

      function removeBuddyThinking() {
        const thinking = document.getElementById('buddy-thinking');
        if (thinking) thinking.remove();
      }

      function addBuddyMessage(text, commands = []) {
        const div = document.createElement('div');
        div.className = 'bubble buddy';
        
        const textDiv = document.createElement('div');
        textDiv.style.whiteSpace = 'pre-wrap';
        textDiv.innerText = text || '';
        div.appendChild(textDiv);

        if (commands && commands.length > 0) {
           const cmdContainer = document.createElement('div');
           cmdContainer.style.marginTop = '12px';
           cmdContainer.style.display = 'flex';
           cmdContainer.style.flexDirection = 'column';
           cmdContainer.style.gap = '8px';
           
           commands.forEach(cmd => {
              const cmdBlock = document.createElement('div');
              cmdBlock.className = 'cmd-block';
              
              const cmdSpan = document.createElement('span');
              cmdSpan.style.opacity = '0.8';
              cmdSpan.style.fontFamily = 'var(--vscode-editor-font-family)';
              cmdSpan.style.fontSize = '10px';
              cmdSpan.innerText = cmd;
              
              const runBtn = document.createElement('button');
              runBtn.className = 'cmd-run';
              runBtn.innerText = 'RUN';
              runBtn.onclick = function() { vscode.postMessage({ type: 'runCommand', payload: cmd }); };
              
              cmdBlock.appendChild(cmdSpan);
              cmdBlock.appendChild(runBtn);
              cmdContainer.appendChild(cmdBlock);
           });
           div.appendChild(cmdContainer);
        }
        
        chatMessages.appendChild(div);
        mainContent.scrollTop = mainContent.scrollHeight;
      }

      function renderHistory() {
        const filterInput = document.getElementById('history-filter');
        const filterStr = filterInput ? filterInput.value.toLowerCase() : '';
        const smartCheck = document.getElementById('smart-history');
        const isSmart = smartCheck ? smartCheck.checked : true;
        const sortSel = document.getElementById('history-sort');
        const sortVal = sortSel ? sortSel.value : 'newest';
        const list = document.getElementById('history-list');
        if (!list) return;

        let filtered = fullHistory.filter(h => (h.cmd || '').toLowerCase().includes(filterStr));
        if (isSmart) filtered = filtered.filter(h => !NOISE_COMMANDS.includes(h.cmd.trim().split(' ')[0]));
        
        if (sortVal === 'oldest') {
           filtered.reverse(); // Since it comes newest-first
        } else if (sortVal === 'error') {
           filtered.sort((a, b) => {
              if (a.status === 'error' && b.status !== 'error') return -1;
              if (b.status === 'error' && a.status !== 'error') return 1;
              return 0; // preserve newest-first order
           });
        }
        
        if (filtered.length === 0) {
           list.innerHTML = '<div style="text-align:center; opacity:0.3; padding:20px; font-size:10px">No history found.</div>';
           return;
        }

        list.innerHTML = '';
        filtered.forEach(h => {
           const card = document.createElement('div');
           card.className = 'list-card';
           card.style.cursor = 'pointer';
           card.style.borderLeft = h.status === 'error' ? '3px solid #ff4444' : (h.status === 'warning' ? '3px solid #ffaa00' : '3px solid transparent');
           card.onclick = function() { vscode.postMessage({ type: 'runCommand', payload: h.cmd }); };
           
           const info = document.createElement('div');
           info.style.flex = '1';
           info.style.overflow = 'hidden';
           
           const cmdLine = document.createElement('div');
           cmdLine.style.fontWeight = '700';
           cmdLine.style.whiteSpace = 'nowrap';
           cmdLine.style.overflow = 'hidden';
           cmdLine.style.textOverflow = 'ellipsis';
           cmdLine.innerText = h.cmd;
           
           const cwdLine = document.createElement('div');
           cwdLine.style.fontSize = '8px';
           cwdLine.style.opacity = '0.4';
           cwdLine.innerText = h.cwd;
           
           info.appendChild(cmdLine);
           info.appendChild(cwdLine);
           
           const btn = document.createElement('button');
           btn.className = 'cmd-run';
           btn.style.opacity = '0.4';
           btn.style.fontSize = '8px';
           btn.innerText = 'RE-RUN';
           
           card.appendChild(info);
           card.appendChild(btn);
           list.appendChild(card);
        });
      }

      function renderPorts(ports) {
         const list = document.getElementById('port-list');
         if (!list) return;
         if (!ports || !ports.length) { list.innerHTML = '<div style="opacity:0.3; font-size:10px">No open ports detected.</div>'; return; }
         list.innerHTML = '';
         ports.forEach(p => {
            const card = document.createElement('div');
            card.className = 'list-card';
            
            const portInfo = document.createElement('div');
            portInfo.style.fontWeight = '800';
            portInfo.style.color = 'var(--accent)';
            portInfo.innerText = ':' + p.port;
            
            const pidInfo = document.createElement('div');
            pidInfo.style.fontSize = '9px';
            pidInfo.style.opacity = '0.6';
            pidInfo.innerText = 'PID: ' + p.pid;
            
            const stopBtn = document.createElement('button');
            stopBtn.className = 'cmd-run';
            stopBtn.style.background = '#f87171';
            stopBtn.innerText = 'STOP';
            stopBtn.onclick = function() { vscode.postMessage({ type: 'runCommand', payload: 'taskkill /F /PID ' + p.pid }); };
            
            card.appendChild(portInfo);
            card.appendChild(pidInfo);
            card.appendChild(stopBtn);
            list.appendChild(card);
         });
      }

      function renderRunning(tasks) {
         const list = document.getElementById('running-list');
         if (!list) return;
         if (!tasks || !tasks.length) { list.innerHTML = '<div style="opacity:0.3; font-size:10px">No active processes.</div>'; return; }
         list.innerHTML = '';
         tasks.forEach(t => {
            const card = document.createElement('div');
            card.className = 'list-card';
            
            const cmdLine = document.createElement('div');
            cmdLine.style.fontWeight = '800';
            cmdLine.style.overflow = 'hidden';
            cmdLine.style.textOverflow = 'ellipsis';
            cmdLine.innerText = t.cmd;
            
            const termLine = document.createElement('div');
            termLine.style.fontSize = '9px';
            termLine.style.opacity = '0.6';
            termLine.innerText = t.terminalName;
            
            card.appendChild(cmdLine);
            card.appendChild(termLine);
            list.appendChild(card);
         });
      }

      function updatePetAnimation(mood) {
        const pet = document.getElementById('pet-container');
        if (!pet) return;
        pet.className = '';
        if (mood === 'excited' || mood === 'thinking') pet.classList.add('pet-bounce');
        else if (mood === 'sad') pet.classList.add('pet-fail');
        else pet.classList.add('pet-floating');
      }

      chatInput.onkeypress = function(e) {
        if (e.key === 'Enter') {
          const val = chatInput.value.trim();
          if (!val) return;
          vscode.postMessage({ type: 'askBuddy', payload: val });
          const div = document.createElement('div');
          div.className = 'bubble me';
          div.innerText = val;
          chatMessages.appendChild(div);
          chatInput.value = '';
          mainContent.scrollTop = mainContent.scrollHeight;
        }
      };

      const sendBtn = document.getElementById('send-btn');
      if (sendBtn) {
        sendBtn.onclick = function() {
           chatInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
        };
      }
      
      setTab('chat');
    }());
  </script>
</body>
</html>`;
  }

  private startBackgroundScans(): void {
    setInterval(() => {
      this.sendActiveCommands();
      this.portMonitor.getActivePorts().then((ports: ActivePort[]) => this.sendPorts(ports));
      this.sendInitialState();
    }, 5000);
  }

  private async sendInitialState(): Promise<void> {
    this.sendLog(this.commandLogger.getAll());
    this.sendPetState(this.petManager.getState());
    const gitStatus = await this.gitHelper.getStatus('./');
    this.sendGitStatus(gitStatus);
    this.sendActiveCommands();
    
    // Send AI info
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const provider = config.get<string>('aiProvider', 'gemini');
    this.sendAiInfo(provider.toUpperCase());
  }

  private handleMessage(message: PanelMessage): void {
    switch (message.type) {
      case 'runCommand':
        vscode.window.terminals[0]?.show();
        vscode.window.terminals[0]?.sendText(message.payload as string);
        break;
      case 'openRepo':
        if (message.payload) {
          vscode.env.openExternal(vscode.Uri.parse(message.payload as string));
        }
        break;
      case 'askBuddy':
        this.sendAiThinking();
        this.aiClient.askDoubt('', '', message.payload as string)
           .then(ans => {
              this.post({ type: 'aiExplanation', payload: { summary: ans || 'Buddy is thinking hard...', suggestedCommands: [] } });
           });
        break;
    }
  }
}
