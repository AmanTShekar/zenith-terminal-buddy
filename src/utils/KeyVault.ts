import * as vscode from 'vscode';
import { VaultKey, PRESET_SERVICES } from '../types';

const VAULT_CONFIG_KEY = 'terminalBuddy.vaultSettings';

export interface VaultSettings {
  [id: string]: {
    name: string;
    envVar: string;
    autoInject: boolean;
  };
}

export class KeyVault {
  constructor(private context: vscode.ExtensionContext) {}

  public async saveKey(id: string, value: string): Promise<void> {
    await this.context.secrets.store(`terminalBuddy.vault.${id}`, value);
  }

  public async setKey(id: string, value: string): Promise<void> {
     await this.saveKey(id, value);
  }

  public async addKey(name: string, envVar: string): Promise<string> {
    const id = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    const settings = this.getSettings();
    settings[id] = { name, envVar, autoInject: true };
    await this.context.globalState.update(VAULT_CONFIG_KEY, settings);
    return id;
  }

  public async deleteKey(id: string): Promise<void> {
    await this.context.secrets.delete(`terminalBuddy.vault.${id}`);
    const settings = this.getSettings();
    delete settings[id];
    await this.context.globalState.update(VAULT_CONFIG_KEY, settings);
  }

  public async getKey(id: string): Promise<string | undefined> {
    return await this.context.secrets.get(`terminalBuddy.vault.${id}`);
  }

  public async listKeys(): Promise<VaultKey[]> {
    const settings = this.getSettings();
    const keys: VaultKey[] = [];

    // Get preset keys
    for (const preset of PRESET_SERVICES) {
      const secret = await this.getKey(preset.id);
      keys.push({
        ...preset,
        hasValue: !!secret,
        autoInject: settings[preset.id]?.autoInject ?? false
      });
    }

    // Get custom keys from settings
    const customIds = Object.keys(settings).filter(id => !PRESET_SERVICES.find(p => p.id === id));
    for (const id of customIds) {
        const secret = await this.getKey(id);
        const s = settings[id];
        keys.push({
            id,
            name: s.name,
            envVar: s.envVar,
            hasValue: !!secret,
            autoInject: s.autoInject
        });
    }

    return keys;
  }

  public async setAutoInject(id: string, enabled: boolean): Promise<void> {
    const settings = this.getSettings();
    if (settings[id]) {
      settings[id].autoInject = enabled;
      await this.context.globalState.update(VAULT_CONFIG_KEY, settings);
    }
  }

  private getSettings(): VaultSettings {
    return this.context.globalState.get<VaultSettings>(VAULT_CONFIG_KEY) || {};
  }

  public async getAutoInjectEnvVars(): Promise<Record<string, string>> {
     const keys = await this.listKeys();
     const env: Record<string, string> = {};
     for (const k of keys) {
        if (k.autoInject && k.hasValue) {
           const val = await this.getKey(k.id);
           if (val) {
              env[k.envVar] = val;
           }
        }
     }
     return env;
  }
}
