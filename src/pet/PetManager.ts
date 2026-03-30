import * as vscode from 'vscode';
import { PetState, PetType, PetMood, CommandEntry } from '../types';

const STORAGE_KEY = 'terminalBuddy.petState';

const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000];
const MAX_LEVEL = 5;

const PET_EMOJIS: Record<PetType, Record<PetMood, string>> = {
  cat: {
    happy: '😸', worried: '😿', sleeping: '😴',
    excited: '🙀', scared: '🫣', neutral: '🐱',
  },
  dog: {
    happy: '🐶', worried: '🥺', sleeping: '💤',
    excited: '🐕', scared: '😰', neutral: '🐕‍🦺',
  },
  robot: {
    happy: '🤖', worried: '⚠️', sleeping: '💤',
    excited: '🚀', scared: '🔧', neutral: '🤖',
  },
  ghost: {
    happy: '👻', worried: '😶‍🌫️', sleeping: '💤',
    excited: '🎃', scared: '💀', neutral: '👻',
  },
};

export class PetManager implements vscode.Disposable {
  private state: PetState;
  private context: vscode.ExtensionContext;
  private moodTimer: NodeJS.Timeout | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private recentStatuses: CommandEntry['status'][] = [];
  private saveDebounce: NodeJS.Timeout | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private _onDidChange = new vscode.EventEmitter<PetState>();
  readonly onDidChange = this._onDidChange.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Load persisted state or create default
    const saved = context.globalState.get<PetState>(STORAGE_KEY);
    if (saved) {
      this.state = saved;
    } else {
      const config = vscode.workspace.getConfiguration('terminalBuddy');
      this.state = {
        type: config.get<PetType>('petType', 'cat'),
        name: config.get<string>('petName', 'Buddy'),
        mood: 'excited', // new workspace = excited!
        xp: 0,
        level: 1,
        errorsFixed: 0,
        lastActiveAt: Date.now(),
      };
    }

    // Setup Status Bar Item first before any state changes
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'terminalBuddy.openPanel';
    this.statusBarItem.tooltip = 'Click to open Terminal Buddy helper';
    context.subscriptions.push(this.statusBarItem);

    // Set excited mood for new workspace
    this.setTemporaryMood('excited', 5000);

    // Start inactivity timer
    this.resetInactivityTimer();
    this.updateStatusBar();

    // Listen for config changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('terminalBuddy.petType')) {
          this.state.type = vscode.workspace.getConfiguration('terminalBuddy')
            .get<PetType>('petType', 'cat');
          this.save();
        }
        if (e.affectsConfiguration('terminalBuddy.petName')) {
          this.state.name = vscode.workspace.getConfiguration('terminalBuddy')
            .get<string>('petName', 'Buddy');
          this.save();
        }
      }),
    );
  }

  // ── Event handlers (called from extension.ts) ──────────────────────────

  onCommandStart(cmd: string): void {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    if (/npm\s+run|python|node|go\s+run/i.test(cmd)) {
      this.setTemporaryMood('excited', -1); // Indefinite excited (running) until finished
    } else {
      this.setTemporaryMood('excited', 3000);
    }
  }

  onCommand(entry: CommandEntry): void {
    // Clear indefinite "running" mood if set
    if (this.moodTimer === null && this.state.mood === 'excited') {
       this.state.mood = 'neutral';
    } else if (this.moodTimer) {
       clearTimeout(this.moodTimer);
       this.moodTimer = null;
    }

    this.state.lastActiveAt = Date.now();
    this.resetInactivityTimer();

    this.recentStatuses.push(entry.status);
    if (this.recentStatuses.length > 5) {
      this.recentStatuses.shift();
    }

    // Mood: rm -rf → scared
    if (/rm\s+-rf|del\s+\/s|rmdir\s+\/s/i.test(entry.cmd)) {
      this.setTemporaryMood('scared', 5000);
      return;
    }

    // Mood: Error → worried
    if (entry.status === 'error') {
      this.setTemporaryMood('worried', 10000);
      return;
    }

    // Mood: OK → happy
    if (entry.status === 'ok') {
      this.addXP(5);
      this.setTemporaryMood('happy', 5000);
      return;
    }

    // Default: neutral
    this.state.mood = 'neutral';
    this.save();
  }

  onErrorExplained(): void {
    this.addXP(5);
    this.state.errorsFixed++;
    this.save();
  }

  onSuggestionFollowed(): void {
    this.addXP(10);
    this.setTemporaryMood('happy', 5000);
  }

  onMainPush(): void {
    this.setTemporaryMood('worried', 5000);
  }

  // ── Public getters ─────────────────────────────────────────────────────

  getState(): PetState {
    return { ...this.state };
  }

  getEmoji(): string {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    if (!config.get<boolean>('petEnabled', true)) {
      return '';
    }
    return PET_EMOJIS[this.state.type]?.[this.state.mood] ?? '🐱';
  }

  private updateStatusBar(): void {
    const config = vscode.workspace.getConfiguration('terminalBuddy');
    if (!config.get<boolean>('petEnabled', true)) {
      this.statusBarItem.hide();
      return;
    }
    
    const emoji = this.getEmoji();
    let text = `${emoji} ${this.state.name} Lv.${this.state.level}`;
    
    // Animate or explicitly show errors
    if (this.state.mood === 'worried') {
      text = `$(error) ${text}`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.statusBarItem.backgroundColor = undefined;
    }

    this.statusBarItem.text = text;
    this.statusBarItem.show();
  }

  static getEmojiStatic(type: PetType, mood: PetMood): string {
    return PET_EMOJIS[type]?.[mood] ?? '🐱';
  }

  // ── XP & Leveling ─────────────────────────────────────────────────────

  private addXP(amount: number): void {
    this.state.xp += amount;

    // Check level up
    const oldLevel = this.state.level;
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.state.xp >= LEVEL_THRESHOLDS[i]) {
        this.state.level = Math.min(i + 1, MAX_LEVEL);
        break;
      }
    }

    if (this.state.level > oldLevel && this.state.level <= MAX_LEVEL) {
      vscode.window.showInformationMessage(
        `🎉 ${this.state.name} leveled up to level ${this.state.level}!`,
      );
      this.setTemporaryMood('excited', 5000);
    }

    this.save();
  }

  // ── Mood management ────────────────────────────────────────────────────

  private setTemporaryMood(mood: PetMood, durationMs: number): void {
    if (this.moodTimer) {
      clearTimeout(this.moodTimer);
    }

    this.state.mood = mood;
    this.save();

    this.moodTimer = setTimeout(() => {
      this.moodTimer = null;
      this.state.mood = 'neutral';
      this.save();
    }, durationMs);
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(() => {
      if (!this.moodTimer) {
        this.state.mood = 'sleeping';
        this.save();
      }
    }, 10 * 60 * 1000); // 10 minutes
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private save(): void {
    if (this.saveDebounce) {
      clearTimeout(this.saveDebounce);
    }
    
    this.updateStatusBar();

    this.saveDebounce = setTimeout(() => {
      this.context.globalState.update(STORAGE_KEY, this.state).then(
        () => this._onDidChange.fire(this.getState()),
        (err) => console.error('[Terminal Buddy] Failed to save pet state:', err),
      );
    }, 1000);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.moodTimer) { clearTimeout(this.moodTimer); }
    if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); }
    if (this.saveDebounce) { clearTimeout(this.saveDebounce); }
  }
}
