// @ts-nocheck — Webview JS inside template literals is not TypeScript; suppress false positives
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
import { ExecutableScanner } from '../core/ExecutableScanner';
import { EnvDiffChecker } from '../core/EnvDiffChecker';
import { CommandEntry, WorkspaceMap, GitStatus, Suggestion, PetState } from '../types';
import { chatPrompt } from '../ai/prompts';

interface PanelMessage { type: string; payload?: any; }

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private initialStateSent = false;

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

  resolveWebviewView(webviewView: vscode.WebviewView, _c: vscode.WebviewViewResolveContext, _t: vscode.CancellationToken): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.onDidReceiveMessage((msg: PanelMessage) => this.handleMessage(msg));
    webviewView.webview.html = this.getHtml(webviewView.webview);
    
    // Startup Smoke Test
    try {
      const dummy = webviewView.webview.html;
      if (!dummy.includes('<body') || !dummy.includes('<style>')) {
        throw new Error('Struct error');
      }
    } catch (e) {
      vscode.window.showWarningMessage('Terminal Buddy UI Regression Detected: WebView failed structural check.');
    }
  }

  post(msg: PanelMessage): void { this.view?.webview.postMessage(msg); }
  sendLog(logs: CommandEntry[]): void { this.post({ type: 'updateLog', payload: logs.slice(0, 100).map(l => ({ ...l, errorOutput: l.errorOutput?.slice(0, 500) })) }); }
  sendPetState(s: PetState): void { this.post({ type: 'updatePetState', payload: s }); }
  sendGitStatus(s: GitStatus | null): void { this.post({ type: 'updateGitStatus', payload: s }); }

  sendPorts(ports: ActivePort[] | null): void { this.post({ type: 'updatePorts', payload: ports || [] }); }
  sendAiInfo(provider: string, model: string): void { this.post({ type: 'updateAiInfo', payload: { provider, model } }); }
  sendAiThinking(): void { this.post({ type: 'aiThinking' }); }
  sendExplanation(ex: any): void { this.post({ type: 'aiExplanation', payload: ex }); }
  sendSuggestions(s: Suggestion[]): void { this.post({ type: 'updateSuggestions', payload: s }); }

  sendWorkspaceMap(m: WorkspaceMap): void { this.post({ type: 'updateWorkspaceMap', payload: m }); }
  sendTerminalData(d: string): void { this.post({ type: 'terminalData', payload: d }); }
  sendSafetyAlert(alert: any, cmd: string): void { this.post({ type: 'safetyAlert', payload: { alert, cmd } }); }
  sendWarning(w: string): void { this.post({ type: 'warning', payload: w }); }
  sendStats(s: any): void { this.post({ type: 'updateStats', payload: s }); }
  sendStreamChunk(c: string): void { this.post({ type: 'aiStreamChunk', payload: c }); }
  sendStreamDone(): void { this.post({ type: 'aiStreamDone' }); }
  playAlertSound(): void { this.post({ type: 'playSound', payload: 'alert' }); }
  
  private updateGit(root: string) {
    this.gitHelper.getStatus(root).then(async (git) => {
      if (!git) {
        this.sendGitStatus(null);
        return;
      }
      const tree = await this.gitHelper.getDetailedTree(root).catch(() => null);
      const guide = this.gitHelper.getGuide(git);
      this.sendGitStatus({ ...git, tree, guide } as any);
    }).catch(() => {});
  }

  private async sendInitialState(): Promise<void> {
    this.sendLog(this.commandLogger.getAll());
    this.sendPetState(this.petManager.getState());
    this.sendActiveCommands();
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const provider = config.get<string>('aiProvider', 'gemini');
    this.sendAiInfo(provider.toUpperCase(), this.aiClient.getActiveModelName());
    
    // Send Latest Terminal Info
    this.sendTerminalSelector();

    if (vscode.workspace.workspaceFolders) {
      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      
      // Ensure we have a map
      let m = this.projectScanner.getMap();
      if (!m.rootPath || m.projects.length === 0) {
        await this.projectScanner.scan();
        m = this.projectScanner.getMap();
      }
      this.sendWorkspaceMap(m);

      // Detailed Git Sync
      const git = await this.gitHelper.getStatus(root).catch(() => null);
      if (git) {
        const tree = await this.gitHelper.getDetailedTree(root).catch(() => null);
        const remoteUrl = await this.gitHelper.getRemoteUrl(root).catch(() => null);
        this.sendGitStatus(git);
        this.post({ 
          type: 'updateGitTree', 
          payload: { tree, remoteUrl, branch: git.branch } 
        });
      } else {
        this.sendGitStatus(null);
      }
    }
  }

  private startBackgroundScans(): void {
    setInterval(() => {
      this.sendActiveCommands();
      this.portMonitor.getActivePorts().then(ports => {
        const projects = this.projectScanner.getMap().projects;
        const enriched = ports.map(p => {
          let label = 'Active Process';
          if (p.port === 3000 || p.port === 3001) label = 'React/Next Dev';
          else if (p.port === 5173) label = 'Vite Dev';
          else if (p.port === 8000 || p.port === 8080) label = 'API Server';
          else if (p.port === 5000) label = 'Flask/Express';
          const m = projects.find(proj => (p.name || '').toLowerCase().includes(proj.name.toLowerCase()));
          if (m) label = `${m.name} (${m.type})`;
          return { ...p, label };
        });
        this.sendPorts(enriched);
      }).catch(() => {});
      if (vscode.workspace.workspaceFolders) {
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        
        const envDiff = EnvDiffChecker.check(root);
        if (envDiff.hasExample && envDiff.hasLocal && envDiff.missingKeys.length > 0) {
          const sample = envDiff.missingKeys.slice(0, 3).join(', ') + (envDiff.missingKeys.length > 3 ? '...' : '');
          this.sendWarning(`.env missing keys: ${sample}`);
        }

        this.updateGit(root);
      }
    }, 8000);

    setInterval(() => {
      this.sendTerminalSelector();
    }, 4000);
  }

  private async scanExecutables(): Promise<void> {
    if (vscode.workspace.workspaceFolders) {
      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      const list = await this.executableScanner.scan(root);
      this.post({ type: 'updateExecutables', payload: list });
    }
  }

  private handleMessage(msg: PanelMessage): void {
    if (msg.type === 'ready') {
      if (this.initialStateSent) { this.sendInitialState(); return; }
      this.initialStateSent = true;
      this.sendInitialState();
      this.scanExecutables();
      this.startBackgroundScans();
      return;
    }
    switch (msg.type) {
      case 'runCommand': {
        const t = vscode.window.terminals[0] || vscode.window.createTerminal('Buddy');
        t.show(); t.sendText(msg.payload as string);
        break;
      }
      case 'killPort':
        if (msg.payload) this.portMonitor.killPort(msg.payload.port, msg.payload.pid);
        break;
      case 'openExternal':
        if (msg.payload) vscode.env.openExternal(vscode.Uri.parse(msg.payload));
        break;
      case 'runExecutable':
        vscode.commands.executeCommand('terminalBuddy.runExecutable', msg.payload);
        break;
      case 'openFile':
        if (msg.payload) vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.payload));
        break;
      case 'focusTerminal':
        if (msg.payload) {
          const t = vscode.window.terminals.find(term => this.terminalWatcher.getTerminalId(term) === msg.payload);
          if (t) t.show();
        }
        break;
      case 'killTerminal':
        if (msg.payload) {
          const t = vscode.window.terminals.find(term => this.terminalWatcher.getTerminalId(term) === msg.payload);
          if (t) t.dispose();
        }
        break;
      case 'explainEntry': {
        const entry = msg.payload as CommandEntry;
        if (!entry) break;
        (async () => {
          this.post({ type: 'aiThinking' });
          const projectInfo = this.projectScanner.getCurrentProject(entry.cwd);
          const ex = await this.aiClient.explain(entry, projectInfo ?? undefined);
          if (ex) { 
            this.sendExplanation(ex); 
          } else { 
            this.sendWarning('AI offline, using built-in rules');
            const ruleEx = this.ruleEngine.check(entry.cmd, entry.errorOutput || '', entry.exitCode || 1, entry.cwd);
            if (ruleEx) {
              this.sendExplanation(ruleEx);
            } else {
              this.sendExplanation({ summary: 'AI offline and no matching rule found.', cause: '', fix: '', suggestedCommands: [], source: 'rule', fromCache: false }); 
            }
          }
        })();
        break;
      }      case 'askBuddy': {
        (async () => {
          this.post({ type: 'aiThinking' });
          try {
            const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const projectsMap = this.projectScanner.getMap();
            const terminals = this.terminalWatcher.getAllTerminals();
            
            const projectStr = projectsMap.projects.map(p => `${p.name}(${p.type})`).join(', ') || 'none';
            const topFiles = projectsMap.projects[0]?.topLevelFiles || [];
            
            for await (const chunk of this.aiClient.chatStream(
              msg.payload as string, 
              projectStr, 
              wsPath, 
              topFiles,
              terminals
            )) {
              this.post({ type: 'aiStreamChunk', payload: chunk });
            }
            this.post({ type: 'aiStreamDone' });
          } catch (err) {
            this.post({ type: 'aiStreamChunk', payload: `❌ Error: ${(err as Error).message}` });
            this.post({ type: 'aiStreamDone' });
          }
        })();
        break;
      }
      case 'aiMoveDirectory': {
        (async () => {
          try {
            const m = this.projectScanner.getMap();
            const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            const target = await this.aiClient.resolvePathQuery(msg.payload as string, m, wsPath);
            if (target) {
              const t = vscode.window.activeTerminal || vscode.window.terminals[0] || vscode.window.createTerminal('Buddy');
              t.show();
              t.sendText(`cd "${target}"`);
            } else {
              this.sendWarning(`Buddy couldn't find a directory for "${msg.payload}"`);
            }
          } catch (err) {
            this.sendWarning(`Move error: ${(err as Error).message}`);
          }
        })();
        break;
      }
    }
  }

  private sendTerminalSelector(): void {
    const list = this.terminalWatcher.getAllTerminals();
    this.post({ type: 'updateTerminalSelector', payload: list });
  }

  private sendActiveCommands(): void {
    const list = this.terminalWatcher.getActiveCommands();
    this.post({ type: 'updateActiveCommands', payload: list });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const src = webview.cspSource;
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline' " + src,
      "img-src " + src + " data: https:",
      "script-src 'nonce-" + nonce + "'",
    ].join('; ');
    const js = this.getWebviewScript();
    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1.0">',
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
      '<style>' + this.getCss() + '</style>',
      '</head>',
      this.getBody(),
      '<script nonce="' + nonce + '">',
      js,
      '</script>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  private getCss(): string {
    return `
:root{--bg:#0d1117;--card:#161b22;--card2:#1f2937;--border:#30363d;--fg:#c9d1d9;--dim:#8b949e;--accent:#58a6ff;--agl:rgba(88,166,255,.12);--ok:#3fb950;--warn:#d29922;--err:#f85149;--mono:'JetBrains Mono','Fira Code',monospace;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
#warn-bar{position:fixed;top:0;left:0;right:0;background:var(--warn);color:#000;padding:4px 12px;font-size:11px;font-weight:600;text-align:center;z-index:101;display:none;}
#hdr{padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);flex-shrink:0;}
.logo{font-weight:700;font-size:13px;background:linear-gradient(135deg,#fff,var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
#ai-badge{font-size:10px;padding:2px 8px;border-radius:20px;background:var(--agl);color:var(--accent);border:1px solid rgba(88,166,255,.25);white-space:nowrap;overflow:hidden;max-width:130px;text-overflow:ellipsis;}
#pet{margin:10px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px;display:flex;align-items:center;gap:10px;flex-shrink:0;}
#pet-emoji{font-size:26px;line-height:1;transition:transform .2s;}
.pet-bounce{animation:bounce .4s cubic-bezier(.36,0,.66,-.56);}
@keyframes bounce{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
#pet-info{flex:1;min-width:0;}
#pet-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;}
#pet-name{font-weight:600;font-size:12px;}
#pet-lv{font-size:10px;background:var(--border);padding:1px 6px;border-radius:10px;color:var(--dim);}
#pet-mood{font-size:11px;color:var(--dim);text-transform:capitalize;margin-bottom:4px;}
#xp-track{height:3px;background:rgba(255,255,255,.07);border-radius:2px;overflow:hidden;}
#xp-fill{height:100%;width:0;background:var(--accent);transition:width .5s ease;border-radius:2px;}
#stats-bar{display:flex;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);flex-shrink:0;}
.stat{font-size:10px;color:var(--dim);}.stat span{font-weight:600;}
.stat.ok span{color:var(--ok)}.stat.err span{color:var(--err)}
#tabs{display:flex;padding:0 8px;border-bottom:1px solid var(--border);gap:2px;overflow-x:auto;scrollbar-width:none;flex-shrink:0;}
#tabs::-webkit-scrollbar{display:none;}
.tab{padding:8px 10px;font-size:11px;font-weight:500;color:var(--dim);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:color .15s;}
.tab:hover{color:var(--fg);}.tab.active{color:var(--accent);border-bottom-color:var(--accent);}
.tab-badge{display:inline-block;background:var(--err);color:#fff;font-size:9px;padding:0 4px;border-radius:8px;margin-left:3px;line-height:14px;}
#panels{flex:1;position:relative;overflow:hidden;}
.panel{position:absolute;inset:0;display:none;flex-direction:column;overflow:hidden;}.panel.active{display:flex;}
.scroll{flex:1;overflow-y:auto;padding:10px;}
.scroll::-webkit-scrollbar{width:4px;}.scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}
#panel-chat{padding:0; display:none; flex-direction:column;}
#panel-chat.active{display:flex;}
#chat-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;}
#chat-msgs::-webkit-scrollbar{width:4px;}
#chat-msgs::-webkit-scrollbar-thumb{background:var(--border);}
.msg{max-width:88%;padding:8px 12px;border-radius:10px;font-size:12px;line-height:1.6;word-break:break-word;}
.msg.buddy{align-self:flex-start;background:var(--card);border:1px solid var(--border);border-bottom-left-radius:2px;}
.msg.user{align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:2px;}
#chat-input-area{padding:10px;border-top:1px solid var(--border);display:flex;gap:8px;align-items:flex-end;background:var(--bg);}
#chat-input{flex:1;min-height:36px;max-height:100px;background:var(--card);border:1px solid var(--border);border-radius:18px;padding:10px 14px;color:var(--fg);font-family:inherit;font-size:12px;resize:none;outline:none;}
#send-btn{width:36px;height:36px;border-radius:18px;background:var(--accent);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.entry{background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;transition:all 0.2s;cursor:pointer;overflow:hidden;position:relative;}
.entry:hover{border-color:var(--accent);background:rgba(255,255,255,0.03);}
.entry.err{border-left:3px solid var(--err);}
.entry.warn{border-left:3px solid var(--warn);}
.entry.ok{border-left:3px solid var(--ok);}

.entry-header{padding:10px;display:flex;align-items:center;gap:10px;}
.entry-status-icon{font-size:12px;min-width:14px;text-align:center;}
.entry-summary{flex:1;min-width:0;}
.entry-cmd-text{font-family:var(--mono);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--fg);}
.entry-sub{font-size:9px;color:var(--dim);margin-top:2px;display:flex;gap:8px;}

.entry-details{display:none;padding:0 10px 10px 34px;border-top:1px solid rgba(255,255,255,0.03);animation: slideDown 0.2s ease-out;}
.entry.expanded .entry-details{display:block;}
.entry.expanded .entry-cmd-text{white-space:normal;}

@keyframes slideDown{from{opacity:0;transform:translateY(-5px);}to{opacity:1;transform:translateY(0);}}

.entry-full-cmd{background:rgba(0,0,0,0.2);padding:6px;border-radius:4px;font-family:var(--mono);font-size:10px;margin-top:8px;word-break:break-all;color:var(--accent);}
.entry-footer{margin-top:10px;display:flex;justify-content:flex-end;gap:8px;}

/* Cards */
.card{background:var(--card);border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px;}
.ask-btn{background:var(--agl);color:var(--accent);border:none;padding:2px 8px;border-radius:10px;font-size:10px;cursor:pointer;}
.run-btn{background:var(--ok);color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:bold;}
.kill-btn{background:var(--err);color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:bold;}
/* Git */
.branch-badge{display:inline-block;padding:2px 8px;border-radius:10px;background:var(--card2);font-weight:600;margin-bottom:8px;font-size:11px;}
.git-file{display:flex;gap:8px;font-size:11px;font-family:var(--mono);margin-bottom:4px;}
.git-s{min-width:14px;font-weight:bold;}
.git-s.M{color:var(--warn);}
.git-s.A{color:var(--ok);}
.git-s.D{color:var(--err);}
.git-tip{margin-top:12px;padding:10px;background:rgba(88,166,255,.08);border:1px solid rgba(88,166,255,.2);border-radius:6px;font-size:11px;}
/* AI Explanations */
.explain-card{margin-top:4px;}
.ec-label{font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;margin-bottom:6px;letter-spacing:0.5px;}
.ec-fix{margin-top:8px;padding:8px;background:rgba(63,185,80,.1);border:1px solid rgba(63,185,80,.2);border-radius:6px;}
.sug-btn{display:inline-block;margin:4px 4px 0 0;padding:4px 10px;background:var(--card2);border:1px solid var(--border);border-radius:4px;font-family:var(--mono);cursor:pointer;font-size:10px;}
.sug-btn:hover{border-color:var(--accent);}
/* Spin and dot */
.spin{width:12px;height:12px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 5px var(--ok);}
/* Safety Overlay */
#safety-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);z-index:999;display:none;flex-direction:column;align-items:center;justify-content:center;padding:20px;}
#safety-overlay.show{display:flex;}
.s-box{background:var(--card);border:1px solid var(--err);border-radius:12px;padding:20px;max-width:300px;width:100%;text-align:center;box-shadow:0 10px 30px rgba(248,81,73,0.2);}
.s-icon{font-size:40px;margin-bottom:10px;}
.s-title{font-size:16px;font-weight:700;color:var(--err);margin-bottom:8px;}
#safety-msg{font-size:12px;color:var(--fg);margin-bottom:12px;line-height:1.5;}
#safety-cmd-preview{background:var(--bg);color:var(--err);font-family:var(--mono);font-size:11px;padding:8px;border-radius:6px;margin-bottom:16px;word-break:break-all;border:1px solid rgba(248,81,73,0.3);}
.s-btns{display:flex;gap:10px;justify-content:center;}
.s-btn{flex:1;padding:8px;border-radius:6px;border:none;font-weight:600;cursor:pointer;}
#s-cancel{background:var(--card2);color:var(--fg);}
#s-run{background:var(--err);color:#fff;}
    .log-filter-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 0 4px; }
    #log-search { 
      flex: 1; background: var(--card); border: 1px solid var(--border); border-radius: 8px; 
      padding: 6px 10px; font-size: 11px; color: var(--fg); outline: none;
      transition: border-color 0.2s;
    }
    #log-search:focus { border-color: var(--accent); }
    #filter-toggle-btn { 
      background: var(--card2); border: 1px solid var(--border); border-radius: 8px; 
      padding: 5px 8px; cursor: pointer; color: var(--dim); transition: all 0.2s;
      font-size: 12px;
    }
    #filter-toggle-btn:hover { color: var(--fg); border-color: var(--dim); }
    #filter-toggle-btn.active { background: var(--agl); color: var(--accent); border-color: var(--accent); }
    .log-filters { display: none; margin-top: 8px; gap: 8px; flex-wrap: wrap; animation: slideDown 0.2s ease-out; }
    .log-filters.show { display: flex; }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
    .filter-select { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 10px; color: var(--fg); outline: none; flex: 1; min-width: 100px; }
    
    /* Explorer & AI Mover */
    .ai-mover { padding: 12px; background: var(--bg); border-bottom: 1px solid var(--border); box-shadow: inset 0 2px 10px rgba(0,0,0,0.1); }
    .ai-mover-input { 
      width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 10px; 
      padding: 8px 12px 8px 34px; color: var(--fg); font-size: 11px; outline: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2358a6ff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: 10px center;
    }
    .ai-mover-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--agl); transform: scale(1.01); }
    .explorer-tree { font-family: var(--vscode-editor-font-family); font-size: 0.9em; padding: 4px; }
    .tree-item { display: flex; align-items: center; padding: 4px 10px; cursor: pointer; border-radius: 6px; transition: all 0.15s; margin: 1px 4px; }
    .tree-item:hover { background: var(--agl); }
    .tree-item.hidden { display: none; }
    .tree-item .actions { margin-left: auto; display: none; gap: 4px; }
    .tree-item:hover .actions { display: flex; }
    .action-btn { font-size: 0.8em; padding: 2px 4px; opacity: 0.6; }
    .action-btn:hover { opacity: 1; color: var(--vscode-button-background); }

    /* Terminal Selector */
    .terminal-list { padding: 10px; }
    .terminal-card { 
      background: rgba(255, 255, 255, 0.03); 
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px; margin-bottom: 8px; padding: 10px; transition: transform 0.2s, background 0.2s;
    }
    .terminal-card:hover { background: rgba(255, 255, 255, 0.07); transform: translateY(-1px); }
    .terminal-card.active { border-color: var(--accent); background: rgba(0, 122, 204, 0.1); }
.tree-item:hover { background: rgba(255, 255, 255, 0.05); }
.tree-item i { margin-right: 8px; opacity: 0.7; }
.terminal-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; margin-bottom: 8px; padding: 10px; transition: transform 0.2s, background 0.2s; }
.terminal-card:hover { background: rgba(255, 255, 255, 0.07); transform: translateY(-1px); }
.terminal-card.active { border-color: var(--accent); background: rgba(0, 122, 204, 0.1); }
.term-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.term-name { font-weight: bold; font-size: 0.9em; }
.term-purpose { font-size: 0.8em; opacity: 0.6; font-style: italic; }
.term-status { width: 8px; height: 8px; border-radius: 50%; background: #ccc; }
.term-status.executing { background: #4ec9b0; box-shadow: 0 0 8px #4ec9b0; }
.term-actions { display: flex; gap: 8px; margin-top: 8px; }
.tree-node{font-size:11px;padding:2px 0;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .1s;}
.tree-node:hover{background:var(--agl);}
.tree-node.file{color:var(--fg);opacity:0.8;}
.tree-node.folder{color:var(--accent);font-weight:600;}
.tree-node-icon{width:14px;text-align:center;}
.live-entry { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px; transition: all 0.2s; }
.live-entry:hover { border-color: var(--accent); background: var(--agl); }
.dim{color:var(--dim);}
.pkg-header { font-size: 10px; font-weight: 700; color: var(--accent); text-transform: uppercase; margin: 14px 4px 6px; letter-spacing: 0.5px; opacity: 0.8; }
.pkg-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pkg-name { font-weight: 600; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg); }
.pkg-type { opacity: 0.5; font-size: 10px; }
.btn-sm.run-btn { background: var(--agl); color: var(--accent); border: 1px solid rgba(88,166,255,0.2); text-transform: none; padding: 3px 8px; }
.btn-sm.run-btn:hover { background: var(--accent); color: #fff; }
  `;
  }

  private getBody(): string {
    return [
      '<body>',
      '  <div id="warn-bar"></div>',
      '  <div id="hdr">',
      '    <div class="logo">Terminal Buddy</div>',
      '    <div id="ai-badge">Waiting...</div>',
      '  </div>',
      '  <div id="pet">',
      '    <div id="pet-emoji">🥚</div>',
      '    <div id="pet-info">',
      '      <div id="pet-row">',
      '        <div id="pet-name">Buddy</div>',
      '        <div id="pet-lv">Lv.1</div>',
      '      </div>',
      '      <div id="pet-mood">Hatching...</div>',
      '      <div id="xp-track"><div id="xp-fill"></div></div>',
      '    </div>',
      '  </div>',
      '  <div id="stats-bar">',
      '    <div class="st-item" id="st-ok"><span class="st-val">0</span><span class="st-label">Success</span></div>',
      '    <div class="st-item" id="st-err"><span class="st-val">0</span><span class="st-label">Errors</span></div>',
      '    <div class="st-item" id="st-total"><span class="st-val">0</span><span class="st-label">Total</span></div>',
      '  </div>',
      '  <div id="tabs">',
      '    <div class="tab active" data-tab="chat">Chat</div>',
      '    <div class="tab" data-tab="log">Log</div>',
      '    <div class="tab" data-tab="live">Live</div>',
      '    <div class="tab" data-tab="explorer">Explorer</div>',
      '    <div class="tab" data-tab="ports">Ports</div>',
      '    <div class="tab" data-tab="git">Git</div>',
      '    <div class="tab" data-tab="pkgs">Pkgs</div>',
      '  </div>',
      '  <div id="panels">',
      '    <div class="panel active" id="panel-chat">',
      '      <div id="chat-msgs"><div class="msg buddy">👋 Hi! I\'m Buddy. Ask me anything.</div></div>',
      '      <div id="ai-expl" style="display:none; padding:10px;"></div>',
      '      <div id="chat-input-area">',
      '        <textarea id="chat-input" placeholder="Ask Buddy..." rows="1"></textarea>',
      '        <button id="send-btn" title="Send (Enter)">➤</button>',
      '      </div>',
      '    </div>',
      '    <div class="panel" id="panel-log">',
      '      <div class="log-filter-bar">',
      '        <input type="text" id="log-search" placeholder="Search logs...">',
      '        <button id="filter-toggle-btn" title="Toggle Filters">⚙️</button>',
      '        <div class="log-filters" id="log-filters-box">',
      '          <select id="term-filter" class="filter-select"><option value="all">All Terms</option></select>',
      '          <select id="status-filter" class="filter-select">',
      '            <option value="all">Status</option>',
      '            <option value="ok">Success</option>',
      '            <option value="warn">Warn</option>',
      '            <option value="err">Error</option>',
      '          </select>',
      '        </div>',
      '      </div>',
      '      <div class="scroll" id="log-list"><div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No commands yet.</div></div></div>',
      '    </div>',
      '    <div class="panel" id="panel-live">',
      '      <div class="scroll" id="live-list">',
      '        <div class="empty"><div class="empty-icon">⚡</div><div class="empty-text">No active commands.</div></div>',
      '      </div>',
      '      <div id="terminal-selector" class="terminal-selector scroll"></div>',
      '    </div>',
      '    <div class="panel" id="panel-explorer">',
      '      <div class="ai-mover">',
      '        <input type="text" id="ai-mover-input" class="ai-mover-input" placeholder="AI Mover: e.g. \'go to components\'">',
      '      </div>',
      '      <div class="scroll" id="explorer-tree">',
      '        <div class="empty"><div class="empty-icon">📂</div><div class="empty-text">Loading workspace...</div></div>',
      '      </div>',
      '    </div>',
      '    <div class="panel" id="panel-ports"><div class="scroll" id="ports-list"><div class="empty"><div class="empty-icon">🔌</div><div class="empty-text">No dev servers detected.</div></div></div></div>',
      '    <div class="panel" id="panel-git"><div class="scroll" id="git-content"><div class="empty"><div class="empty-icon">🌿</div><div class="empty-text">No git repository.</div></div></div></div>',
      '    <div class="panel" id="panel-pkgs"><div class="scroll" id="pkgs-list"><div class="empty"><div class="empty-icon">📦</div><div class="empty-text">Scanning scripts...</div></div></div></div>',
      '  </div>',
      '  <div id="safety-overlay">',
      '    <div class="s-box">',
      '      <div class="s-icon">🛡️</div>',
      '      <div class="s-title">Dangerous Command</div>',
      '      <div id="safety-msg">This command might be destructive.</div>',
      '      <div id="safety-cmd-preview"></div>',
      '      <div class="s-btns">',
      '        <button id="s-cancel" class="s-btn">Cancel</button>',
      '        <button id="s-run" class="s-btn">Run Anyway</button>',
      '      </div>',
      '    </div>',
      '  </div>'
    ].join('\n');
  }
  private getWebviewScript(): string {
    return [
      `(function(){`,
      `'use strict';`,
      `const vsc=acquireVsCodeApi();`,
      `const T3='\\x60\\x60\\x60',T1='\\x60';`,
      `let streamEl=null,pendingCmd=null,currentLogs=[],terminalsMap={};`,
      `const petEmojis={cat:{happy:'😸',worried:'😿',sleeping:'😴',excited:'🙀',scared:'🫣',neutral:'🐱'},dog:{happy:'🐶',worried:'🥺',sleeping:'💤',excited:'🐕',scared:'😰',neutral:'🐕'},robot:{happy:'🤖',worried:'⚠️',sleeping:'💤',excited:'🚀',scared:'🔧',neutral:'🤖'},ghost:{happy:'👻',worried:'😶‍🌫️',sleeping:'💤',excited:'🎃',scared:'💀',neutral:'👻'}};`,
      ``,
      `// ── Helpers ──`,
      `function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}`,
      `function md(t){`,
      `  if(!t)return'';`,
      `  try{`,
      `    let p=t.split(T3),o='';`,
      `    for(let i=0;i<p.length;i++){`,
      `      if(i%2===1){o+='<pre><code>'+esc(p[i].replace(/^\\w+\\n/,'').trim())+'</code></pre>';}`,
      `      else{`,
      `        let s=esc(p[i]);`,
      `        s=s.replace(/\\[LIVE:([^\\]]+)\\]/g, (m, id) => {`,
      `          const term = terminalsMap[id];`,
      `          if(!term) return \`<span class="dim">[Terminal \${id} stopped]</span>\`;`,
      `          return \`<div class="chat-live-card">`,
      `            <div class="chat-live-header">`,
      `              <span>📺 \${esc(term.name)}</span>`,
      `              <span class="dim">ID: \${esc(id)}</span>`,
      `            </div>`,
      `            <div class="chat-live-btns">`,
      `              <button class="chat-live-btn chat-live-focus" data-id="\${esc(id)}"><span class="chat-live-icon">🎯</span> Focus</button>`,
      `              <button class="chat-live-btn chat-live-kill" data-id="\${esc(id)}"><span class="chat-live-icon">💀</span> Kill</button>`,
      `              \${term.port ? \`<button class="chat-live-btn chat-live-link" data-url="http://localhost:\${term.port}"><span class="chat-live-icon">🌐</span> Port \${term.port}</button>\` : ''}`,
      `            </div>`,
      `          </div>\`;`,
      `        });`,
      `        s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>\$1</strong>');`,
      `        s=s.replace(/\\*([^*]+)\\*/g,'<em>\$1</em>');`,
      `        s=s.replace(new RegExp(T1+'([^'+T1+']+)'+T1,'g'),'<code>\$1</code>');`,
      `        s=s.replace(/\\n/g,'<br>');`,
      `        o+=s;`,
      `      }`,
      `    }`,
      `    return o;`,
      `  }catch(e){return esc(t);}`,
      `}`,
      `function ago(ts){if(!ts)return'';const d=Math.floor((Date.now()-ts)/1000);if(d<60)return d+'s ago';if(d<3600)return Math.floor(d/60)+'m ago';return Math.floor(d/3600)+'h ago';}`,
      `function badge(n){return n>0?\`<span class="tab-badge">\${n}</span>\`:''}`,
      ``,
      `// ── Tabs ──`,
      `let errCount=0;`,
      `document.querySelectorAll('.tab').forEach(tab=>{`,
      `  tab.addEventListener('click',()=>{`,
      `    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));`,
      `    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));`,
      `    tab.classList.add('active');`,
      `    const id='panel-'+tab.dataset.tab;`,
      `    const panel=document.getElementById(id);`,
      `    if(panel)panel.classList.add('active');`,
      `    if(tab.dataset.tab==='log'){errCount=0;updateErrTab();}`,
      `  });`,
      `});`,
      `function updateErrTab(){const t=document.querySelector('[data-tab="log"]');if(t)t.innerHTML='Log'+(errCount>0?badge(errCount):'');}`,
      ``,
      `// ── Pet ──`,
      `function updatePet(s){`,
      `  const em=document.getElementById('pet-emoji');`,
      `  const mo=document.getElementById('pet-mood');`,
      `  const lv=document.getElementById('pet-lv');`,
      `  const fill=document.getElementById('xp-fill');`,
      `  const name=document.getElementById('pet-name');`,
      `  if(s.type&&s.mood){`,
      `    const emo=petEmojis[s.type]?.[s.mood]||'🐱';`,
      `    if(em)em.textContent=emo;`,
      `  }`,
      `  if(mo)mo.textContent=s.mood||'ready';`,
      `  if(lv)lv.textContent='Lv.'+(s.level||1);`,
      `  if(name)name.textContent=s.name||'Buddy';`,
      `  if(fill)fill.style.width=(s.xp%100)+'%';`,
      `}`,
      ``,
      `// ── Chat ──`,
      `const chatMsgs=document.getElementById('chat-msgs');`,
      `const chatInput=document.getElementById('chat-input');`,
      `const sendBtn=document.getElementById('send-btn');`,
      `function appendMsg(html,role){`,
      `  if(!chatMsgs)return null;`,
      `  const d=document.createElement('div');`,
      `  d.className='msg '+role;`,
      `  if(typeof html==='string'&&role==='user')d.innerHTML=esc(html);`,
      `  else if(typeof html==='string')d.innerHTML=html;`,
      `  chatMsgs.appendChild(d);`,
      `  chatMsgs.scrollTop=chatMsgs.scrollHeight;`,
      `  return d;`,
      `}`,
      `function sendChat(){`,
      `  const txt=(chatInput.value||'').trim();`,
      `  if(!txt)return;`,
      `  appendMsg(txt,'user');`,
      `  chatInput.value='';chatInput.style.height='auto';`,
      `  vsc.postMessage({type:'askBuddy',payload:txt});`,
      `}`,
      `if(sendBtn)sendBtn.addEventListener('click',sendChat);`,
      `if(chatInput){`,
      `  chatInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}});`,
      `  chatInput.addEventListener('input',()=>{chatInput.style.height='auto';chatInput.style.height=Math.min(chatInput.scrollHeight,100)+'px';});`,
      `}`,
      ``,
      `// ── Log ──`,
      `    let currentLogData = [];`,
      `    function updateTermFilter(logs) {`,
      `      if(!logs) return;`,
      `      const sel = document.getElementById('term-filter');`,
      `      if(!sel) return;`,
      `      const activeTerm = sel.value;`,
      `      const terms = new Set();`,
      `      logs.forEach(l => { if(l.terminalName) terms.add(l.terminalName); });`,
      `      let h = '<option value="all">All Terms</option>';`,
      `      Array.from(terms).sort().forEach(t => {`,
      `        h += \`<option value="\${esc(t)}">\${esc(t)}</option>\`;`,
      `      });`,
      `      sel.innerHTML = h;`,
      `      sel.value = activeTerm;`,
      `    }`,
      ``,
      `    function renderLog(logs) {`,
      `      if (!logs) return;`,
      `      currentLogData = logs;`,
      `      updateTermFilter(logs);`,
      `      const list = document.getElementById('log-list');`,
      `      const search = (document.getElementById('log-search')?.value || '').toLowerCase();`,
      `      const termF = document.getElementById('term-filter')?.value || 'all';`,
      `      const statF = document.getElementById('status-filter')?.value || 'all';`,
      `      `,
      `      const filtered = logs.filter(e => {`,
      `        const matchesSearch = e.cmd.toLowerCase().includes(search) || (e.projectName||'').toLowerCase().includes(search);`,
      `        const matchesTerm = termF === 'all' || e.terminalName === termF;`,
      `        const matchesStatus = statF === 'all' || (statF === 'err' && e.status === 'error') || (statF === 'warn' && e.status === 'warning') || (statF === 'ok' && e.status === 'ok');`,
      `        return matchesSearch && matchesTerm && matchesStatus;`,
      `      });`,
      ``,
      `      if (filtered.length === 0) {`,
      `        list.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No matching logs.</div></div>';`,
      `        return;`,
      `      }`,
      ``,
      `      list.innerHTML = filtered.reverse().map(e => {`,
      `        const cls = e.status === 'ok' ? 'ok' : e.status === 'warning' ? 'warn' : 'err';`,
      `        const icon = cls === 'ok' ? '✓' : cls === 'warn' ? '⚠' : '✗';`,
      `        return \``,
      `          <div class="entry \${cls}" data-entry='\${esc(JSON.stringify(e))}'>`,
      `            <div class="entry-header">`,
      `              <div class="entry-status-icon">\${icon}</div>`,
      `              <div class="entry-summary">`,
      `                <div class="entry-cmd-text">\${esc(e.cmd)}</div>`,
      `                <div class="entry-sub">`,
      `                  <span>\${ago(e.timestamp)}</span>`,
      `                  <span>•</span>`,
      `                  <span>\${esc(e.terminalName || 'terminal')}</span>`,
      `                </div>`,
      `              </div>`,
      `            </div>`,
      `            <div class="entry-details">`,
      `              <div class="entry-full-cmd">\${esc(e.cmd)}</div>`,
      `              \${e.errorOutput ? '<div style="font-size:10px; color:var(--dim); margin-top:8px; opacity:0.7">Snippet: ' + esc(e.errorOutput.slice(0, 80)) + '...</div>' : ''}`,
      `              <div class="entry-footer">`,
      `                \${e.errorOutput ? '<button class="btn-sm focus ask-explain-btn">🤖 Ask Buddy</button>' : ''}`,
      `              </div>`,
      `            </div>`,
      `          </div>\`;`,
      `      }).join('');`,
      `    }`,
      ``,
      `    document.getElementById('log-search')?.addEventListener('input', () => renderLog(currentLogData));`,
      `    document.getElementById('term-filter')?.addEventListener('change', () => renderLog(currentLogData));`,
      `    document.getElementById('status-filter')?.addEventListener('change', () => renderLog(currentLogData));`,
      `    document.getElementById('filter-toggle-btn')?.addEventListener('click', () => {`,
      `      document.getElementById('log-filters-box')?.classList.toggle('show');`,
      `      document.getElementById('filter-toggle-btn')?.classList.toggle('active');`,
      `    });`,
      ``,
      `document.getElementById('log-list')?.addEventListener('click',e=>{`,
      `  const btn=e.target.closest('.ask-explain-btn');`,
      `  if(btn){`,
      `    const entry=btn.closest('.entry');`,
      `    if(entry){`,
      `      try{`,
      `        const data=JSON.parse(entry.dataset.entry||'{}');`,
      `        document.querySelector('[data-tab="chat"]')?.click();`,
      `        vsc.postMessage({type:'explainEntry',payload:data});`,
      `      }catch(err){}`,
      `    }`,
      `    return;`,
      `  }`,
      `  const entry=e.target.closest('.entry');`,
      `  if(entry) entry.classList.toggle('expanded');`,
      `});`,
      ``,
      `// ── Live ──`,
      `function renderLive(cmds){`,
      `  const c=document.getElementById('live-list');if(!c)return;`,
      `  if(!cmds||!cmds.length){c.innerHTML='<div class="empty"><div class="empty-icon">⚡</div><div class="empty-text">No active commands.</div></div>';return;}`,
      `  c.innerHTML=cmds.map(cmd=>\`<div class="live-entry">`,
      `      <div class="live-info">`,
      `        <div class="spin"></div>`,
      `        <div style="flex:1;min-width:0">`,
      `          <div class="entry-cmd" style="font-family:var(--mono);font-size:11px">\${esc(cmd.cmd||'Running…')}</div>`,
      `          <div class="live-status">`,
      `            <span>\${ago(cmd.startTime)}</span>`,
      `            <span>•</span>`,
      `            <span>PID: \${cmd.pid||'?'}</span>`,
      `          </div>`,
      `        </div>`,
      `      </div>`,
      `      <div class="live-btns">`,
      `        <button class="btn-sm kill live-kill-btn" data-id="\${cmd.terminalId}">⏹ End</button>`,
      `        <button class="btn-sm focus live-focus-btn" data-id="\${cmd.terminalId}">👁 Focus</button>`,
      `        \${cmd.port ? \`<button class="btn-sm link live-link-btn" data-url="http://localhost:\${cmd.port}">🚀 Link</button>\` : ''}`,
      `      </div>`,
      `    </div>\`).join('');`,
      `}`,
      ``,
      `document.getElementById('live-list')?.addEventListener('click', e => {`,
      `  const btn = e.target.closest('.btn-sm');`,
      `  if (!btn) return;`,
      `  const id = btn.dataset.id;`,
      `  if (btn.classList.contains('live-kill-btn')) vsc.postMessage({ type: 'killTerminal', payload: id });`,
      `  if (btn.classList.contains('live-focus-btn')) vsc.postMessage({ type: 'focusTerminal', payload: id });`,
      `  if (btn.classList.contains('live-link-btn')) vsc.postMessage({ type: 'openExternal', payload: btn.dataset.url });`,
      `});`,
      ``,
      `// ── Ports ──`,
      `function renderPorts(ports){`,
      `  const c=document.getElementById('ports-list');if(!c)return;`,
      `  if(!ports||!ports.length){c.innerHTML='<div class="empty"><div class="empty-icon">🔌</div><div class="empty-text">No dev servers detected.</div></div>';return;}`,
      `  c.innerHTML=ports.map(p=>\`<div class="card" style="display:flex;align-items:center;gap:10px"><div class="dot"></div><div style="flex:1"><div style="font-size:12px;font-weight:600">:\${p.port}</div><div style="font-size:10px;color:var(--dim)">\${esc(p.label||'Active')}</div></div>\${p.pid?\`<button class="kill-btn" data-port="\${p.port}" data-pid="\${p.pid}">Kill</button>\`:''}</div>\`).join('');`,
      `}`,
      `document.getElementById('ports-list')?.addEventListener('click',e=>{`,
      `  const btn=e.target.closest('.kill-btn');`,
      `  if(btn)vsc.postMessage({type:'killPort',payload:{port:+btn.dataset.port,pid:+btn.dataset.pid}});`,
      `});`,
      ``,
      `// ── Git ──`,
      `function renderGit(payload){`,
      `  const c=document.getElementById('git-content');if(!c)return;`,
      `  if(!payload){c.innerHTML='<div class="empty"><div class="empty-icon">🌿</div><div class="empty-text">No git repository detected.</div></div>';return;}`,
      `  const existingTree = c.querySelector('.git-tree-container')?.innerHTML;`,
      `  let h=\`<div class="branch-badge">🌿 \${esc(payload.branch||'?')}\`;`,
      `  if(payload.aheadCount>0)h+=\` · <span style="color:var(--ok)">↑\${payload.aheadCount}</span>\`;`,
      `  if(payload.behindCount>0)h+=\` · <span style="color:var(--warn)">↓\${payload.behindCount}</span>\`;`,
      `  if(payload.uncommittedCount>0)h+=\` · <span style="color:var(--warn)">\${payload.uncommittedCount} changed</span>\`;`,
      `  h+='</div>';`,
      `  function renderNode(node,depth=0){`,
      `    if(!node)return'';`,
      `    let html='';`,
      `    if(node.name!=='root'){`,
      `      const isFolder=node.children&&node.children.length>0;`,
      `      if(isFolder){`,
      `        const folderStatus = node.status !== 'clean' ? \`status-\${node.status}\` : '';`,
      `        html+=\`<div class="tree-node folder \${folderStatus}" style="margin-left:\${depth * 8}px">📁 \${esc(node.name)}</div>\`;`,
      `      }else{`,
      `        const stRaw = (node.status||'').trim().charAt(0).toUpperCase();`,
      `        const stClass = stRaw === 'M' ? 'M' : stRaw === 'A' ? 'A' : stRaw === 'D' ? 'D' : '';`,
      `        html+=\`<div class="tree-node file" style="margin-left:\${depth * 8}px">`,
      `          <div class="git-file">`,
      `            <span class="git-s \${stClass}">\${esc(stRaw || ' ')}</span>`,
      `            <span class="file-name" style="\${stClass ? \`color: var(--\${stClass === 'M' ? 'warn' : stClass === 'A' ? 'ok' : 'err'})\` : ''}">\${esc(node.name)}</span>`,
      `          </div>`,
      `        </div>\`;`,
      `      }`,
      `    }`,
      `    if(node.children){`,
      `      node.children.forEach(ch=>html+=renderNode(ch,node.name==='root'?0:depth+1));`,
      `    }`,
      `    return html;`,
      `  }`,
      `  if(payload.tree){`,
      `    h+='<div class="git-tree-container" style="margin-bottom:12px; border-top:1px solid var(--border); padding-top:4px;">';`,
      `    h+=renderNode(payload.tree);`,
      `    h+='</div>';`,
      `  } else if (existingTree) {`,
      `    h+='<div class="git-tree-container" style="margin-bottom:12px; border-top:1px solid var(--border); padding-top:4px;">' + existingTree + '</div>';`,
      `  }`,
      `  if(payload.lastCommitMessage)h+=\`<div style="font-size:10px;color:var(--dim);margin-bottom:6px">Last: \${esc(payload.lastCommitMessage)} · \${esc(payload.lastCommitTime)}</div>\`;`,
      `  if(payload.guide)h+=\`<div class="git-tip">\${md(payload.guide)}</div>\`;`,
      `  c.innerHTML=h;`,
      `}`,
      ``,
      `// ── Pkgs ──`,
      `function renderPkgs(list){`,
      `  const c=document.getElementById('pkgs-list');if(!c)return;`,
      `  if(!list||!list.length){c.innerHTML='<div class="empty"><div class="empty-icon">📦</div><div class="empty-text">No scripts found.</div></div>';return;}`,
      `  const groups={};`,
      `  list.forEach(i=>{const g=i.group||'Other'; if(!groups[g])groups[g]=[]; groups[g].push(i);});`,
      `  const typeIcon={npm:'📦',python:'🐍',script:'⚙️',binary:'🐳',go:'🐹'};`,
      `  let h='';`,
      `  Object.keys(groups).sort((a,b)=>a==='Root'?-1:b==='Root'?1:a.localeCompare(b)).forEach(g=>{`,
      `    h+=\`<div class="pkg-header">\${esc(g)}</div>\`;`,
      `    groups[g].forEach(item=>{`,
      `      h+=\`<div class="card"><div class="pkg-row"><span class="pkg-name" title="\${esc(item.command)}">\${esc(item.name)}</span><span class="pkg-type">\${typeIcon[item.type]||'▶'}</span><button class="run-btn" data-cmd="\${esc(item.command)}" data-path="\${esc(item.path)}">▶ Run</button></div></div>\`;`,
      `    });`,
      `  });`,
      `  c.innerHTML=h;`,
      `}`,
      `document.getElementById('pkgs-list')?.addEventListener('click',e=>{`,
      `  const btn=e.target.closest('.run-btn');`,
      `  if(btn)vsc.postMessage({type:'runExecutable',payload:{command:btn.dataset.cmd,path:btn.dataset.path,name:btn.dataset.cmd}});`,
      `});`,
      ``,
      `// ── AI ──`,
      `function updateAiInfo(info){`,
      `  const b=document.getElementById('ai-badge');if(!b||!info)return;`,
      `  const txt=\`\${(info.provider||'AI').toUpperCase()} · \${info.model||''}\`;`,
      `  b.textContent=txt.length>22?txt.slice(0,19)+'…':txt;`,
      `  b.title=txt;`,
      `}`,
      `function renderExplanation(ex){`,
      `  if (!ex) return;`,
      `  const el = document.getElementById("ai-expl");`,
      `  if (el) {`,
      `    el.innerHTML = \`<div class="explain-card">\` +`,
      `      \`<div class="ec-label">Analysis</div>\` +`,
      `      \`<div>\${md(ex.summary||'')}</div>\` +`,
      `      (ex.fix ? \`<div class="ec-fix"><strong>Fix:</strong> \${md(ex.fix)}</div>\` : "") +`,
      `    \`</div>\`;`,
      `    el.style.display = "block";`,
      `    el.scrollIntoView({ behavior: "smooth" });`,
      `  }`,
      `}`,
      `document.getElementById('chat-msgs')?.addEventListener('click',e=>{`,
      `  const rb=e.target.closest('.run-cmd-btn');`,
      `  if(rb)vsc.postMessage({type:'runCommand',payload:rb.dataset.cmd});`,
      `  const lb=e.target.closest('.chat-live-btn');`,
      `  if(lb){`,
      `    const id=lb.dataset.id;`,
      `    const url=lb.dataset.url;`,
      `    if(lb.classList.contains('chat-live-focus'))vsc.postMessage({type:'focusTerminal',payload:id});`,
      `    else if(lb.classList.contains('chat-live-kill'))vsc.postMessage({type:'killTerminal',payload:id});`,
      `    else if(lb.classList.contains('chat-live-link'))vsc.postMessage({type:'openExternal',payload:url});`,
      `  }`,
      `});`,
      ``,
      `// ── Explorer ──`,
      `function renderExplorer(tree) {`,
      `  const c = document.getElementById('explorer-tree');`,
      `  if (!c) return;`,
      `  if (!tree || !tree.length) {`,
      `    c.innerHTML = '<div class="empty"><div class="empty-icon">📁</div><div class="empty-text">Empty workspace.</div></div>';`,
      `    return;`,
      `  }`,
      ``,
      `  function buildNode(n, depth = 0) {`,
      `    const isDir = n.type === 'directory';`,
      `    const icon = isDir ? '📁' : '📄';`,
      `    let h = \`<div class="tree-item \${isDir ? 'folder' : 'file'}" style="padding-left: \${depth * 12}px" data-path="\${esc(n.path)}">`,
      `      <span class="item-icon">\${icon}</span>`,
      `      <span class="item-name">\${esc(n.name)}</span>`,
      `    </div>\`;`,
      `    if (isDir && n.children) {`,
      `      n.children.sort((a,b) => (a.type === b.type) ? a.name.localeCompare(b.name) : (a.type === 'directory' ? -1 : 1))`,
      `        .forEach(ch => h += buildNode(ch, depth + 1));`,
      `    }`,
      `    return h;`,
      `  }`,
      `  c.innerHTML = tree.map(n => buildNode(n)).join('');`,
      `}`,
      ``,
      `document.getElementById('explorer-tree')?.addEventListener('click', e => {`,
      `  const item = e.target.closest('.tree-item');`,
      `  if (item) vsc.postMessage({ type: 'openFile', payload: item.dataset.path });`,
      `});`,
      ``,
      `document.getElementById('ai-mover-input')?.addEventListener('input', e => {`,
      `  const query = e.target.value.trim().toLowerCase();`,
      `  if (query.startsWith('go ') || query.startsWith('cd ')) return;`,
      `  const items = document.querySelectorAll('.tree-item');`,
      `  items.forEach(item => {`,
      `    const name = item.querySelector('.item-name')?.textContent?.toLowerCase() || '';`,
      `    item.classList.toggle('hidden', query !== '' && !name.includes(query));`,
      `  });`,
      `});`,
      `document.getElementById('ai-mover-input')?.addEventListener('keydown', e => {`,
      `  if (e.key === 'Enter') {`,
      `    const query = e.target.value.trim();`,
      `    if (!query) return;`,
      `    if (query.startsWith('go ') || query.startsWith('cd ') || query.includes(' to ')) {`,
      `      vsc.postMessage({ type: 'aiMoveDirectory', payload: query });`,
      `      e.target.value = '';`,
      `      e.target.placeholder = 'Moving...';`,
      `    }`,
      `  }`,
      `});`,
      ``,
      `// ── Terminal Selector ──`,
      `function renderTerminalSelector(data){`,
      `  const list=document.getElementById('terminal-selector');`,
      `  if(!list)return;`,
      `  terminalsMap = {};`,
      `  data.forEach(t => terminalsMap[t.id] = t);`,
      `  list.innerHTML=data.map(t=>\``,
      `    <div class="terminal-card \${t.active?'active':''} fade-in">`,
      `      <div class="term-header">`,
      `        <div class="term-name">\${esc(t.name)}</div>`,
      `        <div class="term-status \${t.isExecuting?'executing':''}"></div>`,
      `      </div>`,
      `      <div class="term-purpose">\${esc(t.purpose)}</div>`,
      `      \${t.port ? \`<a href="http://localhost:\${t.port}" class="term-link">🚀 Open http://localhost:\${t.port}</a>\` : ''}`,
      `      <div class="term-actions">`,
      `        <button class="btn-sm focus term-focus-btn" data-id="\${t.id}">👁 Focus</button>`,
      `        <button class="btn-sm kill term-kill-btn" data-id="\${t.id}">⏹ Kill</button>`,
      `      </div>`,
      `    </div>`,
      `  \`).join('');`,
      `}`,
      ``,
      `document.getElementById('terminal-selector')?.addEventListener('click', e => {`,
      `  const btn = e.target.closest('.btn-sm');`,
      `  if (!btn) return;`,
      `  const id = btn.dataset.id;`,
      `  if (btn.classList.contains('term-focus-btn')) vsc.postMessage({ type: 'focusTerminal', payload: id });`,
      `  if (btn.classList.contains('term-kill-btn')) vsc.postMessage({ type: 'killTerminal', payload: id });`,
      `});`,
      ``,
      `function renderGitTree(payload) {`,
      `  renderGit(payload);`,
      `}`,
      ``,
      `// ── Stats ──`,
      `function updateStats(s){`,
      `  const ok=document.getElementById('st-ok');const err=document.getElementById('st-err');const tot=document.getElementById('st-total');`,
      `  if(ok)ok.querySelector('.st-val').textContent=s.ok||0;`,
      `  if(err)err.querySelector('.st-val').textContent=s.error||0;`,
      `  if(tot)tot.querySelector('.st-val').textContent=s.total||0;`,
      `}`,
      ``,
      `// ── Message Router ──`,
      `let hatched=false;`,
      `window.addEventListener('message',evt=>{`,
      `  const msg=evt.data;if(!msg||!msg.type)return;`,
      `  if(!hatched){`,
      `    hatched=true;`,
      `    const em=document.getElementById('pet-emoji');`,
      `    const mo=document.getElementById('pet-mood');`,
      `    if(em&&(em.textContent==='🥚'||em.textContent==='Hatching...'))em.textContent='🐱';`,
      `    if(mo&&mo.textContent.toLowerCase().includes('hatch'))mo.textContent='ready';`,
      `  }`,
      `  try {`,
      `    switch(msg.type){`,
      `      case 'updateLog': renderLog(msg.payload);break;`,
      `      case 'updatePetState': updatePet(msg.payload);break;`,
      `      case 'updateActiveCommands': renderLive(msg.payload);break;`,
      `      case 'updatePorts': renderPorts(msg.payload);break;`,
      `      case 'updateGitStatus': renderGit(msg.payload);break;`,
      `      case 'updateTerminalSelector': renderTerminalSelector(msg.payload);break;`,
      `      case 'updateGitTree': renderGit(msg.payload);break;`,
      `      case 'updateExecutables': renderPkgs(msg.payload);break;`,
      `      case 'updateStats': updateStats(msg.payload);break;`,
      `      case 'updateAiInfo': updateAiInfo(msg.payload);break;`,
      `      case 'updateWorkspaceMap': if(msg.payload.fileTree) renderExplorer([msg.payload.fileTree]); break;`,
      `      case 'aiThinking':`,
      `        streamEl=appendMsg('…','buddy thinking');break;`,
      `      case 'aiStreamChunk':`,
      `        if(!streamEl)streamEl=appendMsg('','buddy');`,
      `        if(streamEl.classList.contains('thinking')){streamEl.classList.remove('thinking');streamEl.dataset.raw='';streamEl.innerHTML='';}`,
      `        streamEl.dataset.raw=(streamEl.dataset.raw||'')+(msg.payload||'');`,
      `        streamEl.innerHTML=md(streamEl.dataset.raw);`,
      `        chatMsgs.scrollTop=chatMsgs.scrollHeight;break;`,
      `      case 'aiStreamDone':`,
      `        if(streamEl){streamEl.classList.remove('thinking');streamEl.innerHTML=md(streamEl.dataset.raw||'');}`,
      `        streamEl=null;break;`,
      `      case 'aiExplanation': renderExplanation(msg.payload);break;`,
      `      case 'warning':{const wb=document.getElementById('warn-bar');if(wb){wb.textContent=msg.payload;wb.style.display='block';setTimeout(()=>wb.style.display='none',5000);}break;}`,
      `      case 'safetyAlert':{`,
      `        const ov=document.getElementById('safety-overlay');`,
      `        const sm=document.getElementById('safety-msg');`,
      `        const sc=document.getElementById('safety-cmd-preview');`,
      `        if(ov&&sm&&sc){pendingCmd=msg.payload.cmd;sm.textContent=msg.payload.alert?.explanation||'Safety risk detected.';sc.textContent=msg.payload.cmd;ov.classList.add('show');}break;}`,
      `    }`,
      `  } catch (e) {`,
      `    console.error('Buddy Webview Error:', e);`,
      `  }`,
      `});`,
      ``,
      `// ── Safety Buttons ──`,
      `document.getElementById('s-cancel')?.addEventListener('click',()=>{document.getElementById('safety-overlay')?.classList.remove('show');pendingCmd=null;});`,
      `document.getElementById('s-run')?.addEventListener('click',()=>{if(pendingCmd)vsc.postMessage({type:'runCommand',payload:pendingCmd});document.getElementById('safety-overlay')?.classList.remove('show');pendingCmd=null;});`,
      ``,
      `// ── Handshake ──`,
      `vsc.postMessage({type:'ready'});`,
      `})();`
    ].join('\n');
  }
}
