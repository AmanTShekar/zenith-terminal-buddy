import * as childProcess from 'child_process';
import * as util from 'util';
import * as vscode from 'vscode';

const exec = util.promisify(childProcess.exec);
const EXEC_TIMEOUT_MS = 5000;

export interface ActivePort {
  port: number;
  pid: number;
  name?: string;
  protocol: 'TCP' | 'UDP';
}

export class SystemPortMonitor {
  private static readonly commonPorts = [
    3000, 3001, 5000, 5001, 5173, 8000, 8888, 4200, 3333
  ];

  private static readonly noisePorts = [
    5432, 3306, 6379, 27017, // Databases
    5037, // ADB
    13030, 13031, 13032, // VS Code / Tool internal
    135, 445, 5040, 5357, // Windows Management (Access Denied ports)
    7680, // Windows Update Delivery Optimization
    5353, 5355, // mDNS / LLMNR noise
    49152, 49664, 49665, 49666, 49667, 49668, 49669, 49670 // Windows Dynamic Services
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
    const { stdout } = await exec('netstat -ano -p tcp', { timeout: EXEC_TIMEOUT_MS });
    const lines = stdout.split('\n');
    const ports: ActivePort[] = [];
    const seen = new Set<number>();

    for (const line of lines) {
      // Local Address:Port, State: LISTENING, PID
      const match = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
      if (match) {
        const port = parseInt(match[1]);
        const pid = parseInt(match[2]);
        
        // STRICT DEV FILTERING
        const isSystemPort = port < 1024;
        const isDynamicRange = port >= 49152; // IANA Dynamic ports
        const isBlacklisted = SystemPortMonitor.noisePorts.includes(port) || (port >= 135 && port <= 139) || port === 445;

        if (!seen.has(port) && !isSystemPort && !isBlacklisted) {
          const isCommon = SystemPortMonitor.commonPorts.includes(port);
          const isLikelyDev = (port >= 3000 && port < 10000) || (port >= 30000 && port < 40000);

          if (scanAll || isCommon || (isLikelyDev && !isDynamicRange)) {
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
    const { stdout } = await exec('lsof -i -P -n | grep LISTEN', { timeout: EXEC_TIMEOUT_MS });
    const lines = stdout.split('\n');
    const ports: ActivePort[] = [];
    const seen = new Set<number>();

    for (const line of lines) {
      // node      12345 user   22u  IPv6 0x...      0t0  TCP *:3000 (LISTEN)
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) {
        continue;
      }

      const name = parts[0];
      const pid = parseInt(parts[1]);
      const lastPart = parts[parts.length - 2]; 
      const portMatch = lastPart.match(/:(\d+)$/);
      
      if (portMatch) {
        const port = parseInt(portMatch[1]);
        const isSystemPort = port < 1024;
        const isBlacklisted = SystemPortMonitor.noisePorts.includes(port);
        const isCommon = SystemPortMonitor.commonPorts.includes(port);
        const isLikelyDev = (port >= 3000 && port < 10000) || (port >= 30000 && port < 40000);

        if (!seen.has(port) && !isSystemPort && !isBlacklisted) {
          if (scanAll || isCommon || isLikelyDev) {
            ports.push({ port, pid, name, protocol: 'TCP' });
            seen.add(port);
          }
        }
      }
    }
    return ports;
  }

  public async killPort(port: number, pid: number): Promise<boolean> {
    // 🛡️ Security: Strictly validate PID & port to prevent shell injection
    const safePid = Math.floor(Number(pid));
    const safePort = Math.floor(Number(port));
    if (!Number.isFinite(safePid) || safePid <= 0 || safePid > 4194304) {
      vscode.window.showErrorMessage(`Terminal Buddy: Invalid PID '${pid}' — kill aborted.`);
      return false;
    }
    if (!Number.isFinite(safePort) || safePort < 1024 || safePort > 65535) {
      vscode.window.showErrorMessage(`Terminal Buddy: Invalid port '${port}' — kill aborted.`);
      return false;
    }
    try {
      if (process.platform === 'win32') {
        await exec(`taskkill /F /PID ${safePid}`, { timeout: EXEC_TIMEOUT_MS });
      } else {
        await exec(`kill -9 ${safePid}`, { timeout: EXEC_TIMEOUT_MS });
      }
      return true;
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to kill process on port ${safePort}: ${err}`);
      return false;
    }
  }
}
