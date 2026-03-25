import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface TunnelConfig {
  provider: 'localhost.run' | 'serveo.net' | 'localtunnel' | 'ngrok';
  localPort: number;
  subdomain?: string;
  authToken?: string;
}

export interface TunnelStatus {
  running: boolean;
  publicUrl?: string;
  provider: string;
  error?: string;
}

class TunnelService extends EventEmitter {
  private currentProcess: ChildProcess | null = null;
  private status: TunnelStatus = {
    running: false,
    provider: 'localhost.run'
  };
  private configPath: string;

  constructor() {
    super();
    this.configPath = path.resolve(process.cwd(), '.qilin-claw', 'tunnel-config.json');
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        if (data.lastUrl) {
          this.status.publicUrl = data.lastUrl;
        }
        if (data.provider) {
          this.status.provider = data.provider;
        }
      }
    } catch (error) {
      console.error('[Tunnel] Failed to load config:', error);
    }
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify({
        lastUrl: this.status.publicUrl,
        provider: this.status.provider
      }, null, 2));
    } catch (error) {
      console.error('[Tunnel] Failed to save config:', error);
    }
  }

  async start(config: TunnelConfig): Promise<TunnelStatus> {
    if (this.status.running) {
      await this.stop();
    }

    this.status.provider = config.provider;
    this.status.error = undefined;

    try {
      switch (config.provider) {
        case 'localhost.run':
          await this.startLocalhostRun(config);
          break;
        case 'serveo.net':
          await this.startServeo(config);
          break;
        case 'localtunnel':
          await this.startLocaltunnel(config);
          break;
        case 'ngrok':
          await this.startNgrok(config);
          break;
        default:
          throw new Error(`Unsupported provider: ${config.provider}`);
      }

      this.status.running = true;
      this.saveConfig();
      this.emit('started', this.status);
      return this.status;
    } catch (error) {
      this.status.error = (error as Error).message;
      this.status.running = false;
      this.emit('error', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
    this.status.running = false;
    this.emit('stopped');
  }

  getStatus(): TunnelStatus {
    return { ...this.status };
  }

  private async startLocalhostRun(config: TunnelConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      let sshArgs: string[];
      
      if (config.subdomain) {
        sshArgs = ['-o', 'StrictHostKeyChecking=no', '-R', `${config.subdomain}:80:localhost:${config.localPort}`, 'ssh.localhost.run'];
      } else {
        sshArgs = ['-o', 'StrictHostKeyChecking=no', '-R', `80:localhost:${config.localPort}`, 'ssh.localhost.run'];
      }

      console.log('[Tunnel] Starting localhost.run with args:', sshArgs.join(' '));

      this.currentProcess = spawn('ssh', sshArgs, {
        shell: true,
        env: {
          ...process.env,
          'TERM': 'dumb'
        }
      });

      let urlFound = false;
      let outputBuffer = '';
      let errorBuffer = '';

      this.currentProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        outputBuffer += output;
        console.log('[Tunnel] localhost.run output:', output);

        if (!urlFound) {
          const urlMatch = outputBuffer.match(/(https?:\/\/[^\s<]+)/);
          if (urlMatch) {
            this.status.publicUrl = urlMatch[1];
            console.log('[Tunnel] localhost.run URL found:', this.status.publicUrl);
            urlFound = true;
            resolve();
          }
        }
      });

      this.currentProcess.stderr?.on('data', (data) => {
        const error = data.toString();
        errorBuffer += error;
        console.warn('[Tunnel] localhost.run stderr:', error);
      });

      this.currentProcess.on('close', (code) => {
        console.log('[Tunnel] localhost.run process closed with code:', code);
        if (!urlFound && code !== 0) {
          reject(new Error(`localhost.run exited with code ${code}. Error: ${errorBuffer}`));
        }
        this.status.running = false;
      });

      this.currentProcess.on('error', (error) => {
        console.error('[Tunnel] localhost.run process error:', error);
        if (!urlFound) {
          reject(new Error(`localhost.run failed to start: ${error.message}`));
        }
      });

      setTimeout(() => {
        if (!urlFound) {
          reject(new Error(`Timeout waiting for localhost.run URL. Output: ${outputBuffer}`));
        }
      }, 45000);
    });
  }

  private async startServeo(config: TunnelConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      let sshArgs: string[];
      
      if (config.subdomain) {
        sshArgs = ['-o', 'StrictHostKeyChecking=no', '-R', `${config.subdomain}:80:localhost:${config.localPort}`, 'serveo.net'];
      } else {
        sshArgs = ['-o', 'StrictHostKeyChecking=no', '-R', `80:localhost:${config.localPort}`, 'serveo.net'];
      }

      console.log('[Tunnel] Starting serveo.net with args:', sshArgs.join(' '));

      this.currentProcess = spawn('ssh', sshArgs, {
        shell: true,
        env: {
          ...process.env,
          'TERM': 'dumb'
        }
      });

      let urlFound = false;
      let outputBuffer = '';
      let errorBuffer = '';

      this.currentProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        outputBuffer += output;
        console.log('[Tunnel] serveo output:', output);

        if (!urlFound) {
          const urlMatch = outputBuffer.match(/(https?:\/\/[^\s<]+)/);
          if (urlMatch) {
            this.status.publicUrl = urlMatch[1];
            console.log('[Tunnel] serveo URL found:', this.status.publicUrl);
            urlFound = true;
            resolve();
          }
        }
      });

      this.currentProcess.stderr?.on('data', (data) => {
        const error = data.toString();
        errorBuffer += error;
        console.warn('[Tunnel] serveo stderr:', error);
      });

      this.currentProcess.on('close', (code) => {
        console.log('[Tunnel] serveo process closed with code:', code);
        if (!urlFound && code !== 0) {
          reject(new Error(`serveo exited with code ${code}. Error: ${errorBuffer}`));
        }
        this.status.running = false;
      });

      this.currentProcess.on('error', (error) => {
        console.error('[Tunnel] serveo process error:', error);
        if (!urlFound) {
          reject(new Error(`serveo failed to start: ${error.message}`));
        }
      });

      setTimeout(() => {
        if (!urlFound) {
          reject(new Error(`Timeout waiting for serveo URL. Output: ${outputBuffer}`));
        }
      }, 45000);
    });
  }

  private async startLocaltunnel(config: TunnelConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['--port', config.localPort.toString()];
      if (config.subdomain) {
        args.push('--subdomain', config.subdomain);
      }

      this.currentProcess = spawn('npx', ['localtunnel', ...args], {
        shell: true
      });

      let urlFound = false;
      let outputBuffer = '';

      this.currentProcess.stdout?.on('data', (data) => {
        outputBuffer += data.toString();
        console.log('[Tunnel] localtunnel output:', data.toString());

        if (!urlFound) {
          const urlMatch = outputBuffer.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            this.status.publicUrl = urlMatch[1];
            urlFound = true;
            resolve();
          }
        }
      });

      this.currentProcess.stderr?.on('data', (data) => {
        console.error('[Tunnel] localtunnel error:', data.toString());
      });

      this.currentProcess.on('close', (code) => {
        if (!urlFound && code !== 0) {
          reject(new Error(`localtunnel exited with code ${code}`));
        }
        this.status.running = false;
      });

      this.currentProcess.on('error', (error) => {
        if (!urlFound) {
          reject(new Error(`localtunnel failed to start: ${error.message}`));
        }
      });

      setTimeout(() => {
        if (!urlFound) {
          reject(new Error(`Timeout waiting for localtunnel URL`));
        }
      }, 30000);
    });
  }

  private async startNgrok(config: TunnelConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!config.authToken) {
        reject(new Error('ngrok requires an auth token'));
        return;
      }

      const args = ['http', config.localPort.toString(), '--authtoken', config.authToken];
      
      this.currentProcess = spawn('ngrok', args, {
        shell: true
      });

      let urlFound = false;

      this.currentProcess.stdout?.on('data', (data) => {
        console.log('[Tunnel] ngrok output:', data.toString());
      });

      this.currentProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        console.error('[Tunnel] ngrok error:', output);

        if (!urlFound) {
          const urlMatch = output.match(/(https?:\/\/[^\s]+\.ngrok\.io)/);
          if (urlMatch) {
            this.status.publicUrl = urlMatch[1];
            urlFound = true;
            resolve();
          }
        }
      });

      this.currentProcess.on('close', (code) => {
        if (!urlFound && code !== 0) {
          reject(new Error(`ngrok exited with code ${code}`));
        }
        this.status.running = false;
      });

      this.currentProcess.on('error', (error) => {
        if (!urlFound) {
          reject(new Error(`ngrok failed to start: ${error.message}`));
        }
      });

      setTimeout(() => {
        if (!urlFound) {
          reject(new Error(`Timeout waiting for ngrok URL`));
        }
      }, 30000);
    });
  }
}

export const tunnelService = new TunnelService();
