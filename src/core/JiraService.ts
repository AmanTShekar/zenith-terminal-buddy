import * as vscode from 'vscode';
import { JiraClient, JiraIssue } from './JiraClient';
import { TerminalWatcher } from './TerminalWatcher';

export class JiraService implements vscode.Disposable {
  private activeTicketKey: string | undefined;
  private cachedTickets: Map<string, JiraIssue> = new Map();
  private disposables: vscode.Disposable[] = [];

  private readonly _onActiveTicketChanged = new vscode.EventEmitter<string | undefined>();
  public readonly onActiveTicketChanged = this._onActiveTicketChanged.event;

  constructor(
    private readonly jiraClient: JiraClient,
    private readonly terminalWatcher: TerminalWatcher
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.disposables.push(this.terminalWatcher.onJiraIssueDetected((key) => {
      this.handleIssueDetected(key);
    }));
  }

  private async handleIssueDetected(key: string) {
    if (this.activeTicketKey === key) { return; }
    
    this.activeTicketKey = key;
    this._onActiveTicketChanged.fire(key);
    
    // Proactively fetch details if not cached
    if (!this.cachedTickets.has(key)) {
      try {
        const issue = await this.jiraClient.getIssue(key);
        this.cachedTickets.set(key, issue);
        vscode.window.showInformationMessage(`Zenith: Found active ticket ${key}: ${issue.summary}`);
      } catch (e) {
        console.error(`[Zenith Jira] Failed to fetch ${key}`, e);
      }
    }
  }

  public getActiveTicket(): string | undefined {
    return this.activeTicketKey;
  }

  public async getTicketDetails(key: string): Promise<JiraIssue | undefined> {
    if (this.cachedTickets.has(key)) { return this.cachedTickets.get(key); }
    
    try {
      const issue = await this.jiraClient.getIssue(key);
      this.cachedTickets.set(key, issue);
      return issue;
    } catch (e) {
      return undefined;
    }
  }

  public async transitionTicket(key: string, transitionId: string): Promise<void> {
    await this.jiraClient.doTransition(key, transitionId);
    // Invalidate cache on transition
    this.cachedTickets.delete(key);
    const updated = await this.getTicketDetails(key);
    if (updated) {
       vscode.window.showInformationMessage(`Zenith: ${key} is now ${updated.status}`);
    }
  }

  public dispose() {
    this.disposables.forEach(d => d.dispose());
    this._onActiveTicketChanged.dispose();
  }
}
