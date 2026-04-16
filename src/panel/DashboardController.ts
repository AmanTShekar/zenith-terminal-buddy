import * as vscode from 'vscode';
import { getDashboardHtml } from './DashboardHtml';
import { JiraClient } from '../core/JiraClient';

export class DashboardController implements vscode.Disposable {
  private static instance: DashboardController | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly jiraClient: JiraClient
  ) {}

  public static getInstance(extensionUri: vscode.Uri, jiraClient: JiraClient): DashboardController {
    if (!DashboardController.instance) {
      DashboardController.instance = new DashboardController(extensionUri, jiraClient);
    }
    return DashboardController.instance;
  }

  public show(): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (this.panel) {
      this.panel.reveal(column);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'zenithDashboard',
      'Zenith Command Center',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri]
      }
    );

    this.panel.webview.html = getDashboardHtml(this.panel.webview, this.extensionUri);

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    // Initial state sync
    this.syncJiraState();
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'refreshJira':
        await this.syncJiraState();
        break;
      case 'getIssue':
        try {
          const issue = await this.jiraClient.getIssue(message.payload.key);
          this.panel?.webview.postMessage({ type: 'issueDetails', payload: issue });
        } catch (e: any) {
          vscode.window.showErrorMessage(`Jira Error: ${e.message}`);
        }
        break;
      case 'doTransition':
        try {
          await this.jiraClient.doTransition(message.payload.key, message.payload.transitionId);
          vscode.window.showInformationMessage(`Moved ${message.payload.key} successfully.`);
          await this.syncJiraState();
        } catch (e: any) {
          vscode.window.showErrorMessage(`Jira Transition Error: ${e.message}`);
        }
        break;
    }
  }

  private async syncJiraState(): Promise<void> {
    if (!this.panel) { return; }
    
    if (this.jiraClient.isConfigured()) {
       // Placeholder for fetching a list of issues or my issues
       this.panel.webview.postMessage({ type: 'jiraStatus', payload: { configured: true } });
    } else {
       this.panel.webview.postMessage({ type: 'jiraStatus', payload: { configured: false } });
    }
  }

  public dispose() {
    DashboardController.instance = undefined;
    if (this.panel) {
      this.panel.dispose();
    }
    this.disposables.forEach(d => d.dispose());
  }
}
