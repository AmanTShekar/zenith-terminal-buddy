
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
import { SCANNER_DELAY_MS, CommandEntry, WorkspaceMap, AIProviderType } from './types';

let panelProvider: PanelProvider;

export function activate(context: vscode.ExtensionContext): void {
  try {
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
    const terminalWatcher = new TerminalWatcher(100, aiClient);
    const safetyEngine = new SafetyEngine(aiClient);
    const petProvider = new TerminalPetProvider(commandLogger);
    const portMonitor = new SystemPortMonitor();
    const executableScanner = new ExecutableScanner();
    const keyVault = new KeyVault(context);
    const authBuddy = new TerminalAuthBuddy(terminalWatcher, keyVault);

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

    // 🚀 Register commands AFTER provider is ready to avoid "undefined" crash
    context.subscriptions.push(
      vscode.commands.registerCommand('terminalBuddy.openPanel', () => {
        vscode.commands.executeCommand('terminalBuddy.panel.focus');
      }),
      vscode.commands.registerCommand('terminalBuddy.clearHistory', async () => {
        await commandLogger.clear();
        panelProvider.sendLog([]);
        vscode.window.showInformationMessage('Terminal Buddy: History cleared.');
      }),
      vscode.commands.registerCommand('terminalBuddy.setProviderApiKey', async () => {
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
          vscode.window.showInformationMessage('✅ Terminal Buddy: Ollama is automatically configured for localhost:11434. No API key needed!');
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
        await vscode.workspace.getConfiguration('terminalBuddy').update('aiEnabled', true, vscode.ConfigurationTarget.Global);

        const result = await aiClient.validateKey(selected.id, key);
        if (result.success) {
          vscode.window.showInformationMessage(`✅ Terminal Buddy: ${selected.label} key saved and verified!`);
        } else {
          vscode.window.showWarningMessage(`⚠️ Terminal Buddy: Key saved but verification failed: ${result.error || 'Check your internet or key.'}`);
        }
        panelProvider.sendAiInfo();
      }),
      vscode.commands.registerCommand('terminalBuddy.setApiKey', async () => {
        // Wrapper for current provider
        const config = vscode.workspace.getConfiguration('terminalBuddy');
        const provider = config.get<AIProviderType>('aiProvider', 'gemini');
        
        const key = await vscode.window.showInputBox({
          prompt: `Enter your AI API key for the current provider (${provider})`,
          password: true,
          placeHolder: 'Paste your API key here...',
          ignoreFocusOut: true,
        });

        if (!key) { return; }

        await aiClient.setApiKey(provider, key);
        await config.update('aiEnabled', true, vscode.ConfigurationTarget.Global);

        const result = await aiClient.validateKey(provider, key);
        if (result.success) {
          vscode.window.showInformationMessage(`✅ Terminal Buddy: API key saved and verified!`);
        } else {
          vscode.window.showWarningMessage(`⚠️ Terminal Buddy: Key saved but verification failed: ${result.error || 'Check your internet or key.'}`);
        }
        panelProvider.sendAiInfo();
      }),
      vscode.commands.registerCommand('terminalBuddy.togglePet', async () => {
        const config = vscode.workspace.getConfiguration('terminalBuddy');
        const current = config.get<boolean>('petEnabled', true);
        await config.update('petEnabled', !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          current ? 'Terminal Buddy: Pet hidden. 😿' : 'Terminal Buddy: Pet is back! 😸',
        );
        panelProvider.sendPetState();
      }),
      vscode.commands.registerCommand('terminalBuddy.explainError', async (cmd, error) => {
        const explanation = await aiClient.explain(cmd, error);
        if (explanation) {
          panelProvider.sendAiThinking();
          panelProvider.sendExplanation(explanation);
        }
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
      vscode.commands.registerCommand('terminalBuddy.moveToDirectory', async (dirPath: string) => {
        if (!dirPath) { return; }
        const terminalName = `Buddy: Path Navigator`;
        let terminal = vscode.window.terminals.find(t => t.name === terminalName);
        if (!terminal) {
          terminal = vscode.window.createTerminal({ name: terminalName, cwd: dirPath });
        } else {
          terminal.sendText(`cd "${dirPath}"`);
        }
        terminal.show();
      }),
      vscode.commands.registerCommand('terminalBuddy.analyzeTerminal', async () => {
        const terminal = vscode.window.activeTerminal;
        if (!terminal) {
          vscode.window.showWarningMessage('No active terminal to analyze.');
          return;
        }
        // Focus panel and trigger analysis logic if needed, or just show the panel
        vscode.commands.executeCommand('terminalBuddy.panel.focus');
        panelProvider.sendWarning('Analyzing current terminal session...');
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

    // 🛡️ Proposed API Check (Terminal Decoration Providers are experimental)
    if ((vscode.window as any).registerTerminalDecorationProvider) {
      context.subscriptions.push(
        (vscode.window as any).registerTerminalDecorationProvider(petProvider)
      );
    } else {
      console.warn('[Terminal Buddy] registerTerminalDecorationProvider not found. Gutter pet icons disabled.');
    }

    // 📝 Register Terminal Completion Provider (Proposed API)
    if ((vscode.languages as any).registerTerminalInlineCompletionItemProvider) {
      context.subscriptions.push(
        (vscode.languages as any).registerTerminalInlineCompletionItemProvider(
          new TerminalInlineCompletionProvider(terminalWatcher, aiClient)
        )
      );
    }

    // ── Wire up terminal events → everything else ────────────────────────────
    context.subscriptions.push(
      terminalWatcher.onCommandStart((evt) => {
        try {
          petManager.onCommandStart(evt.cmd, evt.isAgentRun);
          panelProvider.sendActiveCommands();

          // 🛡️ Real-Time Terminal Safety 
          const config = vscode.workspace.getConfiguration('terminalBuddy');
          if (!config.get<boolean>('enabled', true)) {
            return; // 🛑 Master Switch: Exit early
          }
          if (config.get<boolean>('enableTerminalSafety')) {
            (async () => {
              try {
                const projectInfo = projectScanner.getCurrentProject(evt.cwd);
                const audit = await safetyEngine.audit(evt.cmd, evt.cwd, projectInfo?.type ?? 'unknown');

                if (audit.isDangerous) {
                  if (audit.requiresConfirmation && config.get<boolean>('enableInterception')) {
                    terminalWatcher.stopCommand(evt.id);
                    panelProvider.sendSafetyAlert(audit, evt.cmd);
                  }
                  vscode.window.showWarningMessage(`🛡️ Terminal Buddy Safety Alert: ${audit.explanation}`);
                  panelProvider.playAlertSound();
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
      })
    );

    context.subscriptions.push(
      terminalWatcher.onCommandFinished(async (entry) => {
        await commandLogger.add(entry);
        petManager.onCommand(entry);
        petProvider.refresh();

        const config = vscode.workspace.getConfiguration('terminalBuddy');
        if (!config.get<boolean>('enabled', true)) {
          return; // 🛑 Master Switch: Exit early
        }

        if (entry.status === 'error' && entry.errorOutput) {
          // 🤖 Agent Awareness: Silent Mode for agents to avoid UI lag
          if (entry.isAgentRun) {
            const shortErr = entry.errorOutput.split('\n')[0].slice(0, 80);
            panelProvider.sendWarning(`🤖 Agent Issue: ${shortErr}... (Check logs)`);
          } else {
            const explanation = await ruleEngine.check(entry.cmd, entry.errorOutput, entry.exitCode ?? 1, entry.cwd);

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
                  } else {
                    panelProvider.sendExplanation({
                      summary: "I'm having trouble analyzing this error right now.",
                      cause: '', fix: '', suggestedCommands: [], source: 'ai', fromCache: false
                    });
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
        if (gitStatus) {
          const tree = await gitHelper.getDetailedTree(entry.cwd);
          const remoteUrl = await gitHelper.getRemoteUrl(entry.cwd);
          panelProvider.post({ 
            type: 'updateGitTree', 
            payload: { tree, remoteUrl, branch: gitStatus.branch } 
          });
        }
        panelProvider.sendWorkspaceMap(workspaceMap);

        if (gitStatus && entry.tag === 'git' && entry.cmd.includes('push')) {
          const config = vscode.workspace.getConfiguration('terminalBuddy');
          if (config.get<boolean>('warnOnMainPush') && gitStatus.isMainOrMaster) {
            panelProvider.sendWarning('⚠️ You just pushed to ' + gitStatus.branch + '! Consider using a feature branch.');
            petManager.onMainPush();
          }
        }

        panelProvider.sendLog(commandLogger.getRecent(100));
        panelProvider.sendStats(commandLogger.getStats());
        panelProvider.sendPetState();
        panelProvider.sendActiveCommands();
      }),
      terminalWatcher.onSensitivityDetected((terminal) => {
        panelProvider.sendWarning(`⚠️ Sensitivity detected in terminal "${terminal.name}". Pausing logs for safety.`);
      }),
      vscode.window.onDidOpenTerminal(async (terminal) => {
        const config = vscode.workspace.getConfiguration('terminalBuddy');
        if (config.get<boolean>('autoInjectEnvVars', true)) {
           // Note: We can't easily modify the environment of an ALREADY OPENED terminal 
           // through the standard API once createTerminal is called. 
           // However, for terminals created by the user, we can't inject.
           // But we CAN provide a helpful message or use shell integration if available.
        }
      })
    );

    // 🔔 Listen for settings changes to update UI
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('terminalBuddy.selectedModel') || e.affectsConfiguration('terminalBuddy.aiProvider')) {
         const provider = vscode.workspace.getConfiguration('terminalBuddy').get<string>('aiProvider', 'gemini');
         const modelName = aiClient.getActiveModelName();
          panelProvider.sendAiInfo();
      }
    });

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
                errorText: lineText 
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

    context.subscriptions.push(terminalWatcher, petManager, authBuddy);
    
    // 🐾 Listen for pet changes 
    context.subscriptions.push(
      petManager.onDidChange((state) => {
        panelProvider.sendPetState();
      })
    );

    console.log('[Terminal Buddy] Activated successfully.');
  } catch (err) {
    vscode.window.showErrorMessage(`Terminal Buddy Activation Failed: ${err}`);
    console.error('[Terminal Buddy] Activation Error:', err);
  }
}

export function deactivate(): void {
  console.log('[Terminal Buddy] Deactivated.');
}
