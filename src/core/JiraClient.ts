import * as vscode from 'vscode';

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  status: string;
  statusId: string;
  priority: string;
  assignee: string;
  url: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

export class JiraClient {
  private host: string = '';
  private email: string = '';
  private token: string = '';

  constructor() {
    this.refreshConfig();
  }

  public refreshConfig() {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    this.host = config.get<string>('jiraHost', '').trim();
    this.email = config.get<string>('jiraEmail', '').trim();
    this.token = config.get<string>('jiraToken', '').trim();
  }

  private get authHeader(): string {
    const credentials = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    return `Basic ${credentials}`;
  }

  public isConfigured(): boolean {
    return !!(this.host && this.email && this.token);
  }

  private async fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Jira is not configured. Please add Host, Email, and API Token in Settings.');
    }

    const url = `${this.host.replace(/\/$/, '')}/rest/api/3${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API Error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return await response.json() as T;
  }

  public async getIssue(issueKey: string): Promise<JiraIssue> {
    const data: any = await this.fetchApi(`/issue/${issueKey}`);
    return {
      key: data.key,
      summary: data.fields.summary,
      description: this.extractDescription(data.fields.description),
      status: data.fields.status.name,
      statusId: data.fields.status.id,
      priority: data.fields.priority.name,
      assignee: data.fields.assignee?.displayName || 'Unassigned',
      url: `${this.host.replace(/\/$/, '')}/browse/${data.key}`,
    };
  }

  public async listTransitions(issueKey: string): Promise<JiraTransition[]> {
    const data: any = await this.fetchApi(`/issue/${issueKey}/transitions`);
    return data.transitions || [];
  }

  public async doTransition(issueKey: string, transitionId: string): Promise<void> {
    await this.fetchApi(`/issue/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }

  public async addComment(issueKey: string, text: string): Promise<void> {
    await this.fetchApi(`/issue/${issueKey}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: text }]
            }
          ]
        }
      }),
    });
  }

  private extractDescription(description: any): string {
    if (!description) { return ''; }
    if (typeof description === 'string') { return description; }
    
    // Simple ADF (Atlassian Document Format) to text conversion
    try {
      if (description.type === 'doc' && description.content) {
        return description.content
          .map((c: any) => c.content?.map((inner: any) => inner.text).join('') || '')
          .join('\n');
      }
    } catch (e) {
      return 'Complex description (ADF format)';
    }
    return String(description);
  }
}
