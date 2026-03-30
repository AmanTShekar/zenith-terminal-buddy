
import * as vscode from 'vscode';
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
import { SCANNER_DELAY_MS, CommandEntry } from './types';

let panelProvider: PanelProvider;

export function activate(context: vscode.ExtensionContext): void {
  console.log('[Terminal Buddy] Activating...');

  // ── Core services ────────────────────────────────────────────────────────
  const commandLogger = new CommandLogger(context);
  const ruleEngine = new RuleEngine();
  const dependencyDetector = new DependencyDetector();
  const projectScanner = new ProjectScanner();
  const gitHelper = new GitHelper();
  const suggestionEngine = new SuggestionEngine();
  const petManager = new PetManager(context);
  const aiClient = new AIClient(context);
  const terminalWatcher = new TerminalWatcher();
  const safetyEngine = new SafetyEngine(aiClient);
  const petProvider = new TerminalPetProvider(commandLogger);

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
    terminalWatcher
  );

  // 🚀 Register commands AFTER provider is ready to avoid "undefined" crash
  context.subscriptions.push(
    vscode.commands.registerCommand('terminalBuddy.openPanel', () => {
      vscode.commands.executeCommand('terminalBuddy.panel.focus');
    }),
    vscode.commands.registerCommand('terminalBuddy.clearHistory', async () => {
      await commandLogger.clear();
      panelProvider.sendLog([]);
      panelProvider.sendStats(commandLogger.getStats());
      vscode.window.showInformationMessage('Terminal Buddy: History cleared.');
    }),
    vscode.commands.registerCommand('terminalBuddy.setApiKey', async () => {
      const config = vscode.workspace.getConfiguration('terminalBuddy');
      const provider = config.get<string>('aiProvider', 'gemini');

      const key = await vscode.window.showInputBox({
        prompt: `Enter your AI API key (currently using ${provider})`,
        password: true,
        placeHolder: 'Paste your API key here...',
        ignoreFocusOut: true,
      });

      if (!key) { return; }

      await aiClient.setApiKey(key);
      await config.update('aiEnabled', true, vscode.ConfigurationTarget.Global);

      const valid = await aiClient.validateKey(provider as any, key);
      if (valid) {
        vscode.window.showInformationMessage(`✅ Terminal Buddy: API key saved and verified!`);
      } else {
        vscode.window.showWarningMessage(`⚠️ Terminal Buddy: Key saved but verification failed.`);
      }
    }),
    vscode.commands.registerCommand('terminalBuddy.togglePet', async () => {
      const config = vscode.workspace.getConfiguration('terminalBuddy');
      const current = config.get<boolean>('petEnabled', true);
      await config.update('petEnabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        current ? 'Terminal Buddy: Pet hidden. 😿' : 'Terminal Buddy: Pet is back! 😸',
      );
      panelProvider.sendPetState(petManager.getState());
    }),
    vscode.commands.registerCommand('terminalBuddy.explainError', async (cmd, error) => {
      const explanation = await aiClient.explain(cmd, error);
      if (explanation) {
        panelProvider.sendAiThinking();
        panelProvider.sendExplanation(explanation);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('terminalBuddy.panel', panelProvider)
  );

  // 🛡️ Proposed API Check (Terminal Decoration Providers are experimental)
  if ((vscode.window as any).registerTerminalDecorationProvider) {
    context.subscriptions.push(
      (vscode.window as any).registerTerminalDecorationProvider(petProvider)
    );
  } else {
    console.warn('[Terminal Buddy] registerTerminalDecorationProvider not found. Gutter pet icons disabled.');
  }

  // ── Wire up terminal events → everything else ────────────────────────────
  context.subscriptions.push(
    terminalWatcher.onCommandStart(async (evt) => {
      petManager.onCommandStart(evt.cmd);
      panelProvider.sendActiveCommands();

      // 1. Real-Time Terminal Safety (Interception)
      const config = vscode.workspace.getConfiguration('terminalBuddy');
      if (config.get<boolean>('enableTerminalSafety')) {
        const projectInfo = projectScanner.getCurrentProject(evt.cwd);
        const audit = await safetyEngine.audit(evt.cmd, evt.cwd, projectInfo?.type ?? 'unknown');

        if (audit.isDangerous) {
          // INTERCEPTION: Kill the command if interception is enabled and it requires confirmation
          if (audit.requiresConfirmation && config.get<boolean>('enableInterception')) {
            terminalWatcher.stopCommand(evt.id);
            panelProvider.sendSafetyAlert(audit, evt.cmd);
          }

          vscode.window.showWarningMessage(`🛡️ Terminal Buddy Safety Alert: ${audit.explanation}`);
          panelProvider.playAlertSound();
          petProvider.refresh();
        }
      }
    })
  );

  context.subscriptions.push(
    terminalWatcher.onCommandFinished(async (entry) => {
      await commandLogger.add(entry);
      petManager.onCommand(entry);
      petProvider.refresh();

      if (entry.status === 'error' && entry.errorOutput) {
        let explanation = ruleEngine.check(entry.cmd, entry.errorOutput, entry.exitCode ?? 1, entry.cwd);

        if (!explanation) {
          const depSuggestion = dependencyDetector.check(entry.cmd, entry.errorOutput);
          if (depSuggestion) {
            panelProvider.sendSuggestions([depSuggestion]);
          }

          const config = vscode.workspace.getConfiguration('terminalBuddy');
          if (config.get<boolean>('aiEnabled')) {
            if (pendingAiTimeout) { clearTimeout(pendingAiTimeout); }

            const cooldown = config.get<number>('aiCooldownMs', 1000);
            const now = Date.now();
            const timeSinceLast = now - lastAiCallTime;

            const triggerAi = async () => {
              lastAiCallTime = Date.now();
              panelProvider.sendAiThinking();
              const projectInfo = projectScanner.getCurrentProject(entry.cwd);
              const aiExplanation = await aiClient.explain(entry, projectInfo ?? undefined);
              if (aiExplanation) {
                panelProvider.sendExplanation(aiExplanation);
                petManager.onErrorExplained();
              }
            };

            if (timeSinceLast < cooldown) {
              pendingAiTimeout = setTimeout(triggerAi, cooldown);
            } else {
              await triggerAi();
            }
          }
        } else {
          panelProvider.sendExplanation(explanation);
          petManager.onErrorExplained();
        }
      }

      const workspaceMap = projectScanner.getMap();
      const gitStatus = await gitHelper.getStatus(entry.cwd);
      const suggestions = suggestionEngine.generate(workspaceMap, entry.cwd, entry, gitStatus);

      const depSuggestion = entry.errorOutput ? dependencyDetector.check(entry.cmd, entry.errorOutput) : null;
      if (depSuggestion) {
        suggestions.unshift(depSuggestion);
      }

      panelProvider.sendSuggestions(suggestions);
      panelProvider.sendGitStatus(gitStatus);
      panelProvider.sendWorkspaceMap(workspaceMap);

      if (gitStatus && entry.tag === 'git' && entry.cmd.includes('push')) {
        const config = vscode.workspace.getConfiguration('terminalBuddy');
        if (config.get<boolean>('warnOnMainPush') && gitStatus.isMainOrMaster) {
          panelProvider.sendWarning('⚠️ You just pushed to ' + gitStatus.branch + '! Consider using a feature branch.');
          petManager.onMainPush();
        }
      }

      panelProvider.sendLog(commandLogger.getRecent(50));
      panelProvider.sendStats(commandLogger.getStats());
      panelProvider.sendPetState(petManager.getState());
      panelProvider.sendActiveCommands();
    }),
  );

  // ── Terminal Links (Underline errors) ────────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerTerminalLinkProvider({
      provideTerminalLinks: (linkContext, token) => {
        const lineText = linkContext.line;
        const match = /(?:\b|^)(error|exception|failed|traceback|cannot find)(?:\b|:)/i.exec(lineText);
        if (match) {
          return [
            {
              startIndex: match.index,
              length: match[0].length,
              tooltip: '✨ Ask Terminal Buddy to analyze this error',
              errorText: lineText // Custom property
            } as vscode.TerminalLink & { errorText: string }
          ];
        }
        return [];
      },
      handleTerminalLink: async (link: vscode.TerminalLink & { errorText?: string }) => {
        vscode.commands.executeCommand('terminalBuddy.panel.focus');

        const config = vscode.workspace.getConfiguration('terminalBuddy');
        if (config.get<boolean>('aiEnabled') && link.errorText) {
          panelProvider.sendAiThinking();

          const fakeEntry: CommandEntry = {
            id: `link-${Date.now()}`,
            cmd: '(Click Analysis)',
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
            project: 'Workspace',
            status: 'error' as const,
            exitCode: 1,
            tag: 'other' as const,
            timestamp: Date.now(),
            isAgentRun: false,
            errorOutput: link.errorText.trim()
          };

          const projectInfo = projectScanner.getCurrentProject(fakeEntry.cwd);
          const exp = await aiClient.explain(fakeEntry, projectInfo ?? undefined);
          if (exp) {
            panelProvider.sendExplanation(exp);
            petManager.onErrorExplained();
          }
        } else if (!config.get<boolean>('aiEnabled')) {
          panelProvider.sendWarning('Enable AI in settings to analyze specific errors!');
        }
      }
    })
  );

  setTimeout(async () => {
    await projectScanner.scan();
    const map = projectScanner.getMap();
    panelProvider.sendWorkspaceMap(map);
    
    if (vscode.workspace.workspaceFolders) {
        const git = await gitHelper.getStatus(vscode.workspace.workspaceFolders[0].uri.fsPath);
        panelProvider.sendGitStatus(git);
    }
  }, SCANNER_DELAY_MS);

  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
  context.subscriptions.push(
    fsWatcher,
    fsWatcher.onDidChange(() => projectScanner.scan()),
    fsWatcher.onDidCreate(() => projectScanner.scan()),
  );

  context.subscriptions.push(terminalWatcher, petManager);

  console.log('[Terminal Buddy] Activated successfully.');
}

export function deactivate(): void {
  console.log('[Terminal Buddy] Deactivated.');
}
