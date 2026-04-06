import * as vscode from 'vscode';
import { KeyVault } from '../utils/KeyVault';
import { TerminalWatcher } from './TerminalWatcher';

export class TerminalAuthBuddy implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private lastPromptTime = new Map<vscode.Terminal, number>();

  constructor(
    private terminalWatcher: TerminalWatcher,
    private keyVault: KeyVault
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.disposables.push(
      this.terminalWatcher.onData(async ({ terminal, data }) => {
        await this.detectPrompt(terminal, data);
      })
    );
  }

  private async detectPrompt(terminal: vscode.Terminal, data: string) {
    const now = Date.now();
    const lastTime = this.lastPromptTime.get(terminal) || 0;
    
    // Throttle prompt detection to avoid spamming (e.g. once per 2 seconds per terminal)
    if (now - lastTime < 2000) {
      return;
    }

    // Patterns for common auth prompts
    const promptPatterns = [
      { pattern: /[Tt]oken: ?$/, id: 'token' },
      { pattern: /API [Kk]ey: ?$/, id: 'api_key' },
      { pattern: /Access [Tt]oken: ?$/, id: 'access_token' },
      { pattern: /Enter Hugging Face token: ?$/i, id: 'hf' },
      { pattern: /GitHub [Pp]ersonal [Aa]ccess [Tt]oken: ?$/i, id: 'gh' },
      { pattern: /AWS Access Key ID: ?$/, id: 'aws_id' },
      { pattern: /AWS Secret Access Key: ?$/, id: 'aws_secret' }
    ];

    for (const p of promptPatterns) {
      if (p.pattern.test(data.trim())) {
        const config = vscode.workspace.getConfiguration('terminalBuddy');
        if (!config.get<boolean>('enableAuthDetection', true)) {
          return;
        }
        this.lastPromptTime.set(terminal, now);
        await this.handleDetectedPrompt(terminal, p.id);
        break;
      }
    }
  }

  private async handleDetectedPrompt(terminal: vscode.Terminal, promptId: string) {
    const keys = await this.keyVault.listKeys();
    
    // Try to find a matching key by prompt ID first
    let matchingKey = keys.find(k => k.id === promptId && k.hasValue);
    
    // If no direct match, look for any key that might fit (e.g. generic 'token' -> 'hf' if it's the only one)
    if (!matchingKey) {
        if (promptId === 'token' || promptId === 'api_key') {
           const availableKeys = keys.filter(k => k.hasValue);
           if (availableKeys.length === 1) {
              matchingKey = availableKeys[0];
           }
        }
    }

    if (matchingKey) {
      const action = `Inject ${matchingKey.name}`;
      const result = await vscode.window.showInformationMessage(
        `Buddy detected an auth prompt. Should I inject your saved ${matchingKey.name}?`,
        action,
        'Manage Vault'
      );

      if (result === action) {
        await this.injectKey(terminal, matchingKey.id);
      } else if (result === 'Manage Vault') {
        vscode.commands.executeCommand('terminalBuddy.openPanel', 'vault');
      }
    }
  }

  public async injectKey(terminal: vscode.Terminal, keyId: string) {
    const val = await this.keyVault.getKey(keyId);
    if (val) {
      // Send raw text to terminal. We don't add \n because the user might need to press enter themselves
      // or the UI might handle it. But usually for tokens, a newline is expected.
      terminal.sendText(val, true);
      vscode.window.showInformationMessage(`✅ ${keyId.toUpperCase()} injected. ✨`);
    } else {
      vscode.window.showErrorMessage(`❌ Key not found in vault.`);
    }
  }

  dispose() {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
