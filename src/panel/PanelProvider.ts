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
import { SystemPortMonitor, ActivePort } from '../core/PortMonitor';
import { ExecutableScanner } from '../core/ExecutableScanner';
import { EnvDiffChecker } from '../core/EnvDiffChecker';
import { CommandEntry, WorkspaceMap, GitStatus, Suggestion, PetState } from '../types';
import { PANEL_CSS } from './PanelStyles';
import { PANEL_JS } from './PanelScripts';
import { getPanelContent } from './PanelHtml';

interface PanelMessage { 
  type: string; 
  payload?: any; 
}

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private initialStateSent = false;
  private isScanning = false;
  private isWebviewReady = false;
  private messageBuffer: PanelMessage[] = [];

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
    private readonly portMonitor: SystemPortMonitor,
    private readonly executableScanner: ExecutableScanner
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView, 
    _context: vscode.WebviewViewResolveContext, 
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    this.initialStateSent = false;
    this.isWebviewReady = false;
    this.messageBuffer = [];

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.onDidReceiveMessage((msg: PanelMessage) => this.handleMessage(msg));
    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Send a heartbeat init message immediately to signal host availability
    this.post({ type: 'init' });
  }

  public post(msg: PanelMessage): void {
    if (!this.view) { return; }
    
    if (!this.isWebviewReady && msg.type !== 'init') {
      this.messageBuffer.push(msg);
      return;
    }

    this.view.webview.postMessage(msg);
  }

  private flushBuffer(): void {
    while (this.messageBuffer.length > 0) {
      const msg = this.messageBuffer.shift();
      if (msg && this.view) {
        this.view.webview.postMessage(msg);
      }
    }
  }

  sendLog(logs: CommandEntry[]): void { 
    this.post({ 
      type: 'updateLog', 
      payload: logs.slice(0, 100).map(l => ({ 
        ...l, 
        errorOutput: l.errorOutput?.slice(0, 500) 
      })) 
    }); 
  }

  sendPetState(s: PetState): void { 
    this.post({ type: 'updatePetState', payload: s }); 
  }

  sendGitStatus(s: GitStatus | null): void { 
    this.post({ type: 'updateGitStatus', payload: s }); 
  }

  sendPorts(ports: ActivePort[] | null): void { 
    this.post({ type: 'updatePorts', payload: ports || [] }); 
  }

  sendAiInfo(provider: string, model: string): void { 
    this.post({ type: 'updateAiInfo', payload: { provider, model } }); 
  }

  sendAiThinking(): void { 
    this.post({ type: 'aiThinking' }); 
  }

  sendExplanation(ex: any): void { 
    this.post({ type: 'aiExplanation', payload: ex }); 
  }

  sendSuggestions(s: Suggestion[]): void { 
    this.post({ type: 'updateSuggestions', payload: s }); 
  }

  sendWorkspaceMap(m: WorkspaceMap): void { 
    this.post({ type: 'updateWorkspaceMap', payload: m }); 
  }

  sendTerminalData(d: string): void { 
    this.post({ type: 'terminalData', payload: d }); 
  }

  sendSafetyAlert(alert: any, cmd: string): void { 
    this.post({ type: 'safetyAlert', payload: { alert, cmd } }); 
  }

  sendWarning(w: string): void { 
    this.post({ type: 'warning', payload: w }); 
  }

  sendStats(s: any): void { 
    this.post({ type: 'updateStats', payload: s }); 
  }

  sendStreamChunk(c: string): void { 
    this.post({ type: 'aiStreamChunk', payload: c }); 
  }

  sendStreamDone(): void { 
    this.post({ type: 'aiStreamDone' }); 
  }

  playAlertSound(): void { 
    this.post({ type: 'playSound', payload: 'alert' }); 
  }

  private async updateGit(root: string): Promise<void> {
    try {
      const git = await this.gitHelper.getStatus(root).catch(() => null);
      if (git) {
        const tree = await this.gitHelper.getDetailedTree(root).catch(() => null);
        const remoteUrl = await this.gitHelper.getRemoteUrl(root).catch(() => null);
        const guide = this.gitHelper.getGuide(git);
        this.sendGitStatus(git);
        this.post({ 
          type: 'updateGitTree', 
          payload: { tree, remoteUrl, branch: git.branch, guide } 
        });
      } else {
        this.sendGitStatus(null);
      }
    } catch (err) {
      console.error('[Terminal Buddy] Git background update error:', err);
    }
  }

  private async sendInitialState(): Promise<void> {
    // PHASE 1: Immediate & Lightweight (Triggers hatching and interaction)
    const logs = this.commandLogger.getAll();
    this.sendLog(logs); 
    this.sendPetState(this.petManager.getState());
    this.sendActiveCommands();
    
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    const provider = config.get<string>('aiProvider', 'gemini');
    this.sendAiInfo(provider.toUpperCase(), this.aiClient.getActiveModelName());
    
    // PHASE 2: Background & Scanning
    this.sendTerminalSelector();

    if (vscode.workspace.workspaceFolders) {
      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      
      const m = this.projectScanner.getMap();
      this.sendWorkspaceMap(m);
      
      this.projectScanner.scan().then(() => {
        this.sendWorkspaceMap(this.projectScanner.getMap());
      }).catch(() => {});

      // Use a brief timeout for Git to avoid blocking the main initialization response
      setTimeout(() => {
         this.updateGit(root).catch(() => {});
      }, 500);
    }
  }

  private startBackgroundScans(): void {
    setInterval(async () => {
      if (this.isScanning) { return; }
      this.isScanning = true;
      try {
        const ports = await this.portMonitor.getActivePorts().catch(() => []);
        const projects = this.projectScanner.getMap().projects;

        const enriched = ports.map(p => {
          let label = 'Active Process';
          if (p.port === 3000 || p.port === 3001) { label = 'React/Next Dev'; }
          else if (p.port === 5173) { label = 'Vite Dev'; }
          else if (p.port === 8000 || p.port === 8080) { label = 'API Server'; }
          else if (p.port === 5000) { label = 'Flask/Express'; }
          
          const matchingProject = projects.find(proj => 
            (p.name || '').toLowerCase().includes(proj.name.toLowerCase())
          );
          if (matchingProject) { label = `${matchingProject.name} (${matchingProject.type})`; }
          return { ...p, label };
        });
        
        this.sendPorts(enriched);
        this.sendActiveCommands();
        
        if (vscode.workspace.workspaceFolders) {
          const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
          const envDiff = EnvDiffChecker.check(root);
          if (envDiff.hasExample && envDiff.hasLocal && envDiff.missingKeys.length > 0) {
            const sample = envDiff.missingKeys.slice(0, 3).join(', ') + 
                          (envDiff.missingKeys.length > 3 ? '...' : '');
            this.sendWarning(`.env missing keys: ${sample}`);
          }
          await this.updateGit(root);
        }
      } catch (err) {
        console.error('[Terminal Buddy] Background scan error:', err);
      } finally {
        this.isScanning = false;
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
      console.log('[Terminal Buddy] Webview READY received.');
      this.isWebviewReady = true;
      this.flushBuffer();

      if (!this.initialStateSent) {
        this.initialStateSent = true;
        this.startBackgroundScans();
      }
      this.sendInitialState();
      this.scanExecutables();
      return;
    }

    try {
      switch (msg.type) {
        case 'runCommand': {
          const t = vscode.window.terminals[0] || vscode.window.createTerminal('Buddy');
          t.show();
          t.sendText(msg.payload as string);
          break;
        }
        case 'killPort':
          if (msg.payload) {
            this.portMonitor.killPort(msg.payload.port, msg.payload.pid);
          }
          break;
        case 'openExternal':
          if (msg.payload) {
            vscode.env.openExternal(vscode.Uri.parse(msg.payload));
          }
          break;
        case 'runExecutable':
          vscode.commands.executeCommand('terminalBuddy.runExecutable', msg.payload);
          break;
        case 'openFile':
          if (msg.payload) {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.payload));
          }
          break;
        case 'focusTerminal':
          if (msg.payload) {
            const t = vscode.window.terminals.find(term => 
              this.terminalWatcher.getTerminalId(term) === msg.payload
            );
            if (t) { t.show(); }
          }
          break;
        case 'killTerminal':
          if (msg.payload) {
            const t = vscode.window.terminals.find(term => 
              this.terminalWatcher.getTerminalId(term) === msg.payload
            );
            if (t) { t.dispose(); }
          }
          break;
        case 'explainEntry': {
          const entry = msg.payload as CommandEntry;
          if (!entry) { break; }
          (async () => {
            this.post({ type: 'aiThinking' });
            const projectInfo = this.projectScanner.getCurrentProject(entry.cwd);
            const ex = await this.aiClient.explain(entry, projectInfo ?? undefined);
            if (ex) { 
              this.sendExplanation(ex); 
            } else { 
              this.sendWarning('AI offline, checking local rules...');
              const ruleEx = await this.ruleEngine.check(entry.cmd, entry.errorOutput || '', entry.exitCode || 1, entry.cwd);
              this.sendExplanation(ruleEx || { 
                summary: 'No local explanation found for this error.',
                cause: 'Unknown',
                fix: 'Consult official documentation for this command.',
                suggestedCommands: [],
                source: 'fallback'
              });
            }
          })();
          break;
        }
        case 'askBuddy': {
          (async () => {
            this.post({ type: 'aiThinking' });
            try {
              const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
              const projectsMap = this.projectScanner.getMap();
              const terminals = this.terminalWatcher.getAllTerminals();
              const projectStr = projectsMap.projects.map(p => `${p.name}(${p.type})`).join(', ') || 'none';
              const topFiles = projectsMap.projects[0]?.topLevelFiles || [];
              
              for await (const chunk of this.aiClient.chatStream(
                msg.payload as string, projectStr, wsPath, topFiles, terminals
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
    } catch (err) {
      console.error('[Terminal Buddy] Message handler crash:', err);
    }
  }

  private sendTerminalSelector(): void {
    const list = this.terminalWatcher.getAllTerminals();
    this.post({ type: 'updateTerminalSelector', payload: list });
  }

  public sendActiveCommands(): void {
    const list = this.terminalWatcher.getActiveCommands();
    this.post({ type: 'updateActiveCommands', payload: list });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-eval'; img-src ${webview.cspSource} https: data:;`;
    
    const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="{{CSP}}">
  <style>{{CSS}}</style>
</head>
<body id="buddy-body">
  {{CONTENT}}
  <script nonce="{{NONCE}}">{{JS}}</script>
</body>
</html>`;

    return template
      .replace('{{CSP}}', () => csp)
      .replace('{{CSS}}', () => PANEL_CSS)
      .replace('{{CONTENT}}', () => getPanelContent())
      .replace('{{NONCE}}', () => nonce)
      .replace('{{JS}}', () => PANEL_JS);
  }

}
