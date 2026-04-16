import * as vscode from 'vscode';
import * as path from 'path';
import { PanelProvider } from './panel/PanelProvider';
import { TerminalWatcher } from './core/TerminalWatcher';
import { ProjectScanner } from './core/ProjectScanner';
import { CommandLogger } from './core/CommandLogger';
import { RuleEngine } from './core/RuleEngine';
import { DependencyDetector } from './core/DependencyDetector';
import { GitHelper } from './core/GitHelper';
import { SuggestionEngine } from './core/SuggestionEngine';
import { PetManager } from './pet/PetManager';
import { AIClient } from './ai/AIClient';
import { SafetyEngine } from './core/SafetyEngine';
import { TerminalPetProvider } from './ui/TerminalPetProvider';
import { SystemPortMonitor } from './core/PortMonitor';
import { ExecutableScanner } from './core/ExecutableScanner';
import { TerminalCompletionProvider, TerminalInlineCompletionProvider } from './core/TerminalCompletionProvider';
import { KeyVault } from './utils/KeyVault';
import { TerminalAuthBuddy } from './core/TerminalAuthBuddy';
import { AgentSync } from './core/AgentSync';
import { ChatParticipant } from './core/ChatParticipant';
import { DiagnosticProvider } from './core/DiagnosticProvider';
import { JiraClient } from './core/JiraClient';
import { JiraService } from './core/JiraService';
import { DashboardController } from './panel/DashboardController';
import { SCANNER_DELAY_MS, CommandEntry, WorkspaceMap, AIProviderType } from './types';

let panelProvider: PanelProvider;

export function activate(context: vscode.ExtensionContext): void {
  try {
    console.log('[Terminal Buddy] Activating...');
    const activationTime = Date.now();

    // ── Core services ────────────────────────────────────────────────────────
    const commandLogger = new CommandLogger(context);
    const ruleEngine = new RuleEngine();
    const dependencyDetector = new DependencyDetector();
    const projectScanner = new ProjectScanner();
    const gitHelper = new GitHelper();
    const suggestionEngine = new SuggestionEngine();
    const petManager = new PetManager(context);
    const aiClient = new AIClient(context);
    const terminalWatcher = new TerminalWatcher(100, aiClient);
    const safetyEngine = new SafetyEngine(aiClient);
    const petProvider = new TerminalPetProvider(commandLogger);
    const portMonitor = new SystemPortMonitor();
    const executableScanner = new ExecutableScanner();
    const keyVault = new KeyVault(context);
    const authBuddy = new TerminalAuthBuddy(terminalWatcher, keyVault);
    const agentSync = new AgentSync();
    const diagnosticProvider = new DiagnosticProvider();

    // ── Jira & Dashboard ──────────────────────────────────────────────────────
    const jiraClient = new JiraClient();
    const jiraService = new JiraService(jiraClient, terminalWatcher);
    const dashboardController = DashboardController.getInstance(context.extensionUri, jiraClient);
    
    // ── Chat Participant (@buddy) ─────────────────────────────────────────────
    const participantHandler = new ChatParticipant(commandLogger, gitHelper, aiClient);
    const participant = vscode.chat.createChatParticipant('terminalBuddy.chat', (request, context, progress, token) => {
      return participantHandler.handleRequest(request, context, progress, token);
    });
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'buddy.png');
    
    // ── Output Channel (for Agent Context) ────────────────────────────────────
    const outputChannel = vscode.window.createOutputChannel('Terminal Buddy AI');

    // ── AI Burst Protection State ─────────────────────────────────────────────
    let lastAiCallTime = 0;
    let pendingAiTimeout: NodeJS.Timeout | null = null;

    // ── Panel (webview) ──────────────────────────────────────────────────────
    panelProvider = new PanelProvider(
      context.extensionUri,
      commandLogger,
      ruleEngine,
      dependencyDetector,
      projectScanner,
      gitHelper,
      suggestionEngine,
      petManager,
      aiClient,
      terminalWatcher,
      portMonitor,
      executableScanner,
      keyVault,
      authBuddy
    );
    panelProvider.setServices(jiraService, dashboardController);

    // 🚀 Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('terminalBuddy.openPanel', () => {
        vscode.commands.executeCommand('terminalBuddy.panel.focus');
      }),
      vscode.commands.registerCommand('terminalBuddy.clearHistory', async () => {
        await commandLogger.clear();
        panelProvider.sendLog([]);
        vscode.window.showInformationMessage('Terminal Buddy: History cleared.');
      }),
      vscode.commands.registerCommand('terminalBuddy.setApiKey', async () => {
        const providers: { label: string, id: AIProviderType }[] = [
          { label: 'Google Gemini', id: 'gemini' },
          { label: 'OpenAI (GPT)', id: 'openai' },
          { label: 'Anthropic Claude', id: 'claude' },
          { label: 'Groq', id: 'groq' },
          { label: 'Ollama (Local)', id: 'ollama' },
          { label: 'Custom/Local AI', id: 'custom' }
        ];

        const selected = await vscode.window.showQuickPick(providers, {
          placeHolder: 'Select the AI provider you want to configure',
          title: 'Terminal Buddy: Configure Provider'
        });

        if (!selected) { return; }

        if (selected.id === 'ollama') {
          vscode.window.showInformationMessage('✅ Terminal Buddy: Ollama configured!');
          await vscode.workspace.getConfiguration('terminalBuddy').update('aiProvider', 'ollama', vscode.ConfigurationTarget.Global);
          return;
        }

        const key = await vscode.window.showInputBox({
          prompt: `Enter your API key for ${selected.label}`,
          password: true,
          placeHolder: 'Paste your API key here...',
          ignoreFocusOut: true,
        });

        if (!key) { return; }

        await aiClient.setApiKey(selected.id, key);
        await vscode.workspace.getConfiguration('terminalBuddy').update('aiProvider', selected.id, vscode.ConfigurationTarget.Global);
        panelProvider.sendAiInfo();
      }),
      vscode.commands.registerCommand('terminalBuddy.togglePet', async () => {
        const config = vscode.workspace.getConfiguration('terminalBuddy');
        const current = config.get<boolean>('petEnabled', true);
        await config.update('petEnabled', !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Terminal Buddy: Pet Mode ${!current ? 'Enabled' : 'Disabled'}`);
      }),
      vscode.commands.registerCommand('terminalBuddy.explainError', async (cmd, error) => {
        const explanation = await aiClient.explain(cmd, error);
        if (explanation) {
          panelProvider.sendAiThinking();
          panelProvider.sendExplanation(explanation);
        }
      }),
      vscode.commands.registerCommand('terminalBuddy.analyzeTerminal', async () => {
        panelProvider.openBuddySummary();
      }),
      vscode.commands.registerCommand('terminalBuddy.runExecutable', async (executable: any) => {
        if (!executable) { return; }
        const cmd: string = typeof executable === 'string' ? executable : (executable.command || '');
        if (!cmd) { return; }
        const label: string = typeof executable === 'string' ? executable : (executable.name || cmd);
        const cwd: string | undefined = executable.path
          ? path.dirname(executable.path)
          : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const terminalName = `Buddy: ${label}`;
        let terminal = vscode.window.terminals.find(t => t.name === terminalName);
        if (!terminal) { terminal = vscode.window.createTerminal({ name: terminalName, cwd }); }
        terminal.show();
        terminal.sendText(cmd);
      }),
      vscode.commands.registerCommand('terminalBuddy.moveToDirectory', async (targetPath: string) => {
        if (!targetPath) {
          const m = projectScanner.getMap();
          const selected = await vscode.window.showQuickPick(
            m.projects.map(p => ({ label: p.name, description: p.path, path: p.path })),
            { placeHolder: 'Select a project to navigate to' }
          );
          if (selected) { targetPath = selected.path; }
        }
        if (targetPath) {
          const t = vscode.window.activeTerminal || vscode.window.terminals[0] || vscode.window.createTerminal('Buddy');
          t.show();
          t.sendText(`cd "${targetPath}"`);
        }
      }),
      vscode.commands.registerCommand('terminalBuddy.injectVaultKey', async (keyId: string) => {
        const terminal = vscode.window.activeTerminal;
        if (terminal) {
          await authBuddy.injectKey(terminal, keyId);
        } else {
          vscode.window.showErrorMessage('No active terminal to inject key into.');
        }
      })
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('terminalBuddy.panel', panelProvider)
    );

    // 🛡️ Proposed API Check
    if ((vscode.window as any).registerTerminalDecorationProvider) {
      context.subscriptions.push(
        (vscode.window as any).registerTerminalDecorationProvider(petProvider)
      );
    }

    // ── Wire up terminal events ──────────────────────────────────────────────
    context.subscriptions.push(
      terminalWatcher.onCommandStart((evt) => {
        try {
          diagnosticProvider.clear();
          petManager.onCommandStart(evt.cmd, evt.isAgentRun);
          panelProvider.sendActiveCommands();

          const config = vscode.workspace.getConfiguration('terminalBuddy');
          if (!config.get<boolean>('enabled', true)) { return; }

          if (config.get<boolean>('enableTerminalSafety')) {
            (async () => {
              try {
                const projectInfo = projectScanner.getCurrentProject(evt.cwd);
                const audit = await safetyEngine.audit(evt.cmd, evt.cwd, projectInfo?.type ?? 'unknown');

                if (audit.isDangerous) {
                  const startupGrace = (Date.now() - activationTime) < 3000;
                  if (audit.requiresConfirmation && config.get<boolean>('enableInterception') && !startupGrace) {
                    terminalWatcher.stopCommand(evt.id);
                    panelProvider.sendSafetyAlert(audit, evt.cmd);
                  }
                  if (!startupGrace) {
                    vscode.window.showWarningMessage(`🛡️ Terminal Buddy Safety Alert: ${audit.explanation}`);
                    panelProvider.playAlertSound();
                  }
                  petProvider.refresh();
                }
              } catch (err) {
                console.warn('[Terminal Buddy] Safety audit failed:', err);
              }
            })();
          }
        } catch (err) {
          console.error('[Terminal Buddy] onCommandStart handler error:', err);
        }
      }),
      terminalWatcher.onCommandFinished(async (entry) => {
        await commandLogger.add(entry);
        petManager.onCommand(entry);
        petProvider.refresh();

        const config = vscode.workspace.getConfiguration('terminalBuddy');
        if (!config.get<boolean>('enabled', true)) { return; }

        if (entry.status === 'error' && entry.errorOutput) {
          const proactiveAi = config.get<boolean>('proactiveAi', false);
          let explanation = await ruleEngine.check(entry.cmd, entry.errorOutput, entry.exitCode ?? 1, entry.cwd);

          if (!explanation || proactiveAi) {
            const depSuggestion = dependencyDetector.check(entry.cmd, entry.errorOutput);
            if (depSuggestion && !explanation) { panelProvider.sendSuggestions([depSuggestion]); }

            if (config.get<boolean>('aiEnabled')) {
              if (pendingAiTimeout) { clearTimeout(pendingAiTimeout); }
              const cooldown = config.get<number>('aiCooldownMs', 1000);
              const now = Date.now();
              const triggerAi = async () => {
                lastAiCallTime = Date.now();
                panelProvider.sendAiThinking();
                const aiExplanation = await aiClient.explain(entry, projectScanner.getCurrentProject(entry.cwd) ?? undefined);
                if (aiExplanation) {
                  panelProvider.sendExplanation(aiExplanation);
                  petManager.onErrorExplained();
                  await agentSync.sync(entry, aiExplanation);
                  diagnosticProvider.reportError(entry);
                }
              };
              if (now - lastAiCallTime < cooldown) { pendingAiTimeout = setTimeout(triggerAi, cooldown); }
              else { await triggerAi(); }
            }
          } else {
            panelProvider.sendExplanation(explanation);
            petManager.onErrorExplained();
          }
        }

        const gitStatus = await gitHelper.getStatus(entry.cwd);
        const suggestions = suggestionEngine.generate(projectScanner.getMap(), entry.cwd, entry, gitStatus);
        
        panelProvider.sendSuggestions(suggestions);
        panelProvider.sendGitStatus(gitStatus);
        if (gitStatus) {
            const tree = await gitHelper.getDetailedTree(entry.cwd);
            panelProvider.post({ type: 'updateGitTree', payload: { tree, branch: gitStatus.branch } });
        }
        panelProvider.sendLog(commandLogger.getRecent(100));
        panelProvider.sendStats(commandLogger.getStats());
      })
    );

    // 🔔 Settings listener
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('terminalBuddy')) {
          panelProvider.sendAiInfo();
          panelProvider.sendPetState();
      }
    });

    setTimeout(async () => {
      await projectScanner.scan();
      panelProvider.sendWorkspaceMap(projectScanner.getMap());
    }, SCANNER_DELAY_MS);

    context.subscriptions.push(terminalWatcher, petManager, authBuddy);
    console.log('[Terminal Buddy] Activated successfully.');
  } catch (err) {
    vscode.window.showErrorMessage(`Terminal Buddy Activation Failed: ${err}`);
  }
}

export function deactivate(): void {}
