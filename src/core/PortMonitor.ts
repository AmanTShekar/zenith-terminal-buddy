import * as child_process from 'child_process';
import * as util from 'util';
import * as vscode from 'vscode';

const exec = util.promisify(child_process.exec);

export interface ActivePort {
  port: number;
  pid: number;
  name?: string;
  protocol: 'TCP' | 'UDP';
}

export class PortMonitor {
  private static readonly COMMON_PORTS = [
    3000, 3001, 5000, 5001, 5173, 8000, 8080, 8888, 4200, 3333
  ];

  public async getActivePorts(scanAll: boolean = false): Promise<ActivePort[]> {
    try {
      if (process.platform === 'win32') {
        return await this.getWindowsPorts(scanAll);
      } else {
        return await this.getUnixPorts(scanAll);
      }
    } catch (err) {
      console.error('[Terminal Buddy] Failed to scan ports:', err);
      return [];
    }
  }

  private async getWindowsPorts(scanAll: boolean): Promise<ActivePort[]> {
    const { stdout } = await exec('netstat -ano -p tcp');
    const lines = stdout.split('\n');
    const ports: ActivePort[] = [];
    const seen = new Set<number>();

    for (const line of lines) {
      const match = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
      if (match) {
        const port = parseInt(match[1]);
        const pid = parseInt(match[2]);
        
        // Filter out system ports and common Windows service ports
        const isSystemPort = port < 1024;
        const isWindowsServiceRange = port >= 49664; // Common range for dynamic Windows services
        const isBlacklisted = [135, 445, 5040, 5357].includes(port);

        if (!seen.has(port) && !isSystemPort && !isWindowsServiceRange && !isBlacklisted) {
          if (scanAll || PortMonitor.COMMON_PORTS.includes(port) || port >= 3000) {
            ports.push({ port, pid, protocol: 'TCP' });
            seen.add(port);
          }
        }
      }
    }
    return ports;
  }

  private async getUnixPorts(scanAll: boolean): Promise<ActivePort[]> {
    // lsof -i -P -n | grep LISTEN
    const { stdout } = await exec('lsof -i -P -n | grep LISTEN');
    const lines = stdout.split('\n');
    const ports: ActivePort[] = [];
    const seen = new Set<number>();

    for (const line of lines) {
      // node      12345 user   22u  IPv6 0x...      0t0  TCP *:3000 (LISTEN)
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const name = parts[0];
      const pid = parseInt(parts[1]);
      const lastPart = parts[parts.length - 2]; // TCP *:3000
      const portMatch = lastPart.match(/:(\d+)$/);
      
      if (portMatch) {
        const port = parseInt(portMatch[1]);
        if (!seen.has(port) && (scanAll || PortMonitor.COMMON_PORTS.includes(port))) {
          ports.push({ port, pid, name, protocol: 'TCP' });
          seen.add(port);
        }
      }
    }
    return ports;
  }

  public async killPort(port: number, pid: number): Promise<boolean> {
    try {
      if (process.platform === 'win32') {
        await exec(`taskkill /F /PID ${pid}`);
      } else {
        await exec(`kill -9 ${pid}`);
      }
      return true;
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to kill process on port ${port}: ${err}`);
      return false;
    }
  }
}
