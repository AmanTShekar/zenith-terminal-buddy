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
import { AgentProcedures } from '../ai/AgentProcedures';
import { KeyVault } from '../utils/KeyVault';
import { TerminalAuthBuddy } from '../core/TerminalAuthBuddy';
import { CommandEntry, WorkspaceMap, GitStatus, Suggestion, PetState, AIProviderType } from '../types';
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
  private agentProcedures: AgentProcedures;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly commandLogger: CommandLogger,
    private readonly ruleEngine: RuleEngine,
    private readonly dependencyDetector: DependencyDetector,
    private readonly projectScanner: ProjectScanner,
    private readonly gitHelper: GitHelper,
    private readonly suggestionEngine: SuggestionEngine,
    private readonly petManager: PetManager,
    private aiClient: AIClient,
    private terminalWatcher: TerminalWatcher,
    private portMonitor: SystemPortMonitor,
    private executableScanner: ExecutableScanner,
    private keyVault: KeyVault,
    private authBuddy: TerminalAuthBuddy
  ) {
    this.agentProcedures = new AgentProcedures(this.aiClient);
  }

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

    // Listen for config changes to sync UI toggles instantly
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('terminalBuddy')) {
        this.sendConfig();
        this.sendAiInfo();
      }
    });

    // Start background activity only once
    if (!this.isScanning) {
      this.startBackgroundScans();
    }
  }

  public post(msg: PanelMessage): void {
    if (!this.view) { return; }
    
    if (!this.isWebviewReady && msg.type !== 'init') {
      this.messageBuffer.push(msg);
      return;
    }

    // 🛡️ Stability: Sanitize payload to prevent DataCloneError or circular refs
    let sanitizedMsg = msg;
    try {
      sanitizedMsg = JSON.parse(JSON.stringify(msg));
    } catch (e) {
      console.error('[Terminal Buddy] Failed to sanitize message:', msg.type, e);
    }

    this.view.webview.postMessage(sanitizedMsg);
  }

  private flushBuffer(): void {
    while (this.messageBuffer.length > 0) {
      const msg = this.messageBuffer.shift();
      if (msg && this.view) {
        this.post(msg);
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

  public sendPetState(): void {
    const s = this.petManager.getState();
    this.post({ 
      type: 'updatePetState', 
      payload: { ...s, emoji: this.petManager.getEmoji() } 
    }); 
  }

  sendGitStatus(s: GitStatus | null): void { 
    this.post({ type: 'updateGitStatus', payload: s }); 
  }

  sendPorts(ports: ActivePort[] | null): void { 
    this.post({ type: 'updatePorts', payload: ports || [] }); 
  }

  public async sendAiInfo(): Promise<void> {
    const config = await this.aiClient.getApiKey();
    const tbConfig = vscode.workspace.getConfiguration('terminalBuddy');
    const hasKey = !!config && !!config.key;
    const provider = config?.provider || 'gemini';
    const model = this.aiClient.getActiveModelName();

    this.post({
      type: 'updateAiInfo',
      payload: {
        provider,
        model,
        isOffline: !hasKey || !tbConfig.get<boolean>('enabled', true),
        reason: !tbConfig.get<boolean>('enabled', true) ? 'Extension Disabled' : (!hasKey ? 'Missing API Key' : '')
      }
    });
  }

  public async sendConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    
    this.post({
      type: 'updateConfig',
      payload: {
        enabled: config.get<boolean>('enabled', true),
        petEnabled: config.get<boolean>('petEnabled', true),
        petType: config.get<string>('petType', 'cat'),
        petName: config.get<string>('petName', 'Buddy'),
        aiEnabled: config.get<boolean>('aiEnabled', false),
        aiProvider: config.get<string>('aiProvider', 'gemini'),
        endpoint: config.get<string>('customEndpoint', ''),
        warnOnMainPush: config.get('warnOnMainPush'),
        enableTerminalSafety: config.get<boolean>('enableTerminalSafety', true),
        enableInterception: config.get('enableInterception'),
        scanAllPorts: config.get('scanAllPorts'),
        autoInjectEnvVars: config.get('autoInjectEnvVars'),
        enableVault: config.get('enableVault'),
        enableAuthDetection: config.get('enableAuthDetection'),
        keys: { }
      }
    });
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
    const logs = this.commandLogger.getAll();
    this.sendLog(logs); 
    this.sendPetState();
    this.sendActiveCommands();
    
    await this.sendConfig();
    this.sendAiInfo();
    this.sendTerminalSelector();

    if (vscode.workspace.workspaceFolders) {
      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      
      this.projectScanner.scan(true).then(() => {
        this.sendWorkspaceMap(this.projectScanner.getMap());
      }).catch(() => {});

      // Immediate triggers for Git and Pkgs
      this.updateGit(root).catch(() => {});
      this.scanExecutables().catch(() => {});
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
          await this.scanExecutables();
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

  private async handleMessage(msg: PanelMessage): Promise<void> {
    const data = msg;
    try {
      switch (msg.type) {
        case 'ready': {
          console.log('[Terminal Buddy] Webview READY signal received.');
          this.isWebviewReady = true;
          this.flushBuffer();

          if (!this.initialStateSent) {
            this.initialStateSent = true;
            this.sendInitialState();
            this.scanExecutables();
          }
          break;
        }
        case 'error': {
          console.error('[Terminal Buddy] Webview signaled high-level error:', msg.payload);
          break;
        }
        case 'getUsage':
          this.sendUsage();
          break;
        case 'clearUsage': {
          (async () => {
            await this.aiClient.clearUsageHistory();
            this.sendWarning('Usage history cleared. ✨');
            const summary = await this.aiClient.getUsageSummary();
            this.post({ type: 'updateUsage', payload: summary });
          })();
          break;
        }
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
            const configObj = vscode.workspace.getConfiguration('terminalBuddy');
            const isEnabled = configObj.get<boolean>('enabled', true);
            if (!isEnabled) {
               this.sendWarning('Terminal Buddy is currently disabled. Please enable it in settings to use AI analysis.');
               return;
            }

            const config = await this.aiClient.getApiKey();
            const hasKey = !!config && !!config.key;
            this.post({ type: 'aiThinking' });
            try {
              if (hasKey) {
                this.post({ type: 'agentThought', payload: 'Analyzing logs...' });
                const projectInfo = this.projectScanner.getCurrentProject(entry.cwd);
                const explanation = await this.aiClient.explain(entry, projectInfo ?? undefined);
                if (explanation) {
                  this.post({ type: 'aiExplanation', payload: { id: entry.id, explanation: explanation } });
                } else {
                  this.sendWarning("Buddy couldn't find a clear explanation for this command. Try re-running it or checking logs.");
                  this.post({ type: 'aiStreamDone' });
                }
              } else {
                this.sendWarning('AI is offline. Please configure your API key in the badge above.');
                const ruleEx = await this.ruleEngine.check(entry.cmd, entry.errorOutput || '', entry.exitCode || 1, entry.cwd);
                this.sendExplanation(ruleEx || {
                  summary: 'No local explanation found for this error.',
                  cause: 'Unknown',
                  fix: 'Consult official documentation for this command.',
                  suggestedCommands: [],
                  source: 'fallback'
                });
              }
            } catch (err) {
              this.sendWarning(`AI Analysis failed: ${(err as Error).message}`);
              this.post({ type: 'aiStreamDone' }); // Clear thinking state
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
            } catch (err: any) {
              const errMsg = err?.message || String(err);
              if (errMsg.includes('localhost') || errMsg.includes('127.0.0.1')) {
                this.post({ 
                  type: 'aiStreamChunk', 
                  payload: `⚠️ **AI Connection Failed**: I couldn't reach your local AI server (Ollama/LocalAI) at \`localhost:11434\`. \n\n Would you like to switch to **Google Gemini** (Cloud) instead?` 
                });
                this.post({ type: 'aiActionableError', payload: { action: 'switchToGemini', label: 'Switch to Gemini' } });
              } else {
                this.post({ type: 'aiStreamChunk', payload: `❌ AI Error: ${errMsg}` });
              }
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
        case 'fixEntry': {
          const entry = msg.payload as CommandEntry;
          if (!entry) { break; }
          (async () => {
            const projectInfo = this.projectScanner.getCurrentProject(entry.cwd);
            await this.agentProcedures.runAgentFix(
              entry,
              projectInfo ?? undefined,
              (thought) => this.post({ type: 'agentThought', payload: thought }),
              (suggestion) => this.post({ type: 'agentFixSuggestion', payload: suggestion })
            );
          })();
          break;
        }
        case 'copyFix': {
          if (msg.payload && msg.payload.diff) {
            vscode.env.clipboard.writeText(msg.payload.diff);
            this.sendWarning('Fix copied to clipboard! ✨');
          }
          break;
        }
        case 'clearHistory':
          vscode.commands.executeCommand('terminalBuddy.clearHistory');
          break;
        case 'getVault':
          this.sendVaultInfo();
          break;
        case 'addVaultKey':
          await this.keyVault.addKey(data.payload.name, data.payload.envVar);
          this.sendVaultInfo();
          break;
        case 'updateVaultKey':
          await this.keyVault.setKey(data.payload.id, data.payload.value);
          this.sendVaultInfo();
          break;
        case 'deleteVaultKey':
          await this.keyVault.deleteKey(data.payload);
          this.sendVaultInfo();
          break;
        case 'injectVaultKey':
          vscode.commands.executeCommand('terminalBuddy.injectVaultKey', data.payload);
          break;
        case 'setApiKey': {
          vscode.commands.executeCommand('terminalBuddy.setApiKey');
          break;
        }
        case 'handleAIAction': {
          if (msg.payload === 'switchToGemini') {
            const config = vscode.workspace.getConfiguration('terminalBuddy');
            config.update('aiProvider', 'gemini', vscode.ConfigurationTarget.Global);
            this.sendAiInfo(); // Refresh UI instantly
            this.sendWarning('Switched to Gemini! Try chatting again. ✨');
          }
          break;
        }
        case 'updateSetting': {
          if (msg.payload && msg.payload.key) {
            const key = msg.payload.key;
            const value = msg.payload.value;
            const config = vscode.workspace.getConfiguration('terminalBuddy');
            const targetKey = key === 'endpoint' ? 'customEndpoint' : key;
            config.update(targetKey, value, vscode.ConfigurationTarget.Global);
          }
          break;
        }
        case 'updateProviderKey': {
          if (msg.payload && msg.payload.provider && msg.payload.key) {
            this.aiClient.setApiKey(msg.payload.provider, msg.payload.key);
          }
          break;
        }
        case 'updateApiKey': {
          if (msg.payload) {
            const currentProvider = vscode.workspace.getConfiguration('terminalBuddy').get<AIProviderType>('aiProvider', 'gemini');
            this.aiClient.setApiKey(currentProvider, msg.payload as string);
          }
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

  public async sendUsage(): Promise<void> {
    const usage = await this.aiClient.getUsageSummary();
    this.post({ type: 'updateUsage', payload: usage });
  }

  public async sendVaultInfo(): Promise<void> {
    const keys = await this.keyVault.listKeys();
    this.post({ type: 'updateVault', payload: keys });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-eval'; img-src ${webview.cspSource} https: data:;`;
    
    const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="{{CSP}}">
  <style nonce="{{NONCE}}">{{CSS}}</style>
</head>
<body id="buddy-body">
  {{CONTENT}}
  <script nonce="{{NONCE}}">{{JS}}</script>
</body>
</html>`;

    // Use a custom replacement loop to avoid String.replace's '$' parsing issues
    let html = template;
    html = html.split('{{CSP}}').join(csp);
    html = html.split('{{NONCE}}').join(nonce);
    html = html.split('{{CSS}}').join(PANEL_CSS);
    html = html.split('{{CONTENT}}').join(getPanelContent());
    html = html.split('{{JS}}').join(PANEL_JS);
    return html;
  }
}
