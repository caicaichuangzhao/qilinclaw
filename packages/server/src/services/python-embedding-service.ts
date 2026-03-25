import { spawn, execSync, ChildProcess } from 'child_process';
import * as path from 'path';

interface EmbeddingRequest {
  text: string;
}

interface EmbeddingResponse {
  success: boolean;
  embedding?: number[];
  dimension?: number;
  error?: string;
}

/**
 * Detect the correct Python command for the current platform.
 * On Linux/Mac, `python3` is typically the correct command.
 * On Windows, `python` is typically the correct command.
 * Falls back gracefully if detection fails.
 */
function detectPythonCommand(): string {
  // On Windows, `python` is almost always correct
  if (process.platform === 'win32') {
    return 'python';
  }

  // On Linux/Mac, try `python3` first, then fall back to `python`
  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return 'python3';
  } catch {
    try {
      execSync('python --version', { stdio: 'ignore' });
      return 'python';
    } catch {
      // Default to python3 on non-Windows platforms
      return 'python3';
    }
  }
}

export class PythonEmbeddingService {
  private pythonProcess: ChildProcess | null = null;
  private modelPath: string;
  private isLoaded: boolean = false;
  private requestQueue: Array<{
    resolve: (value: EmbeddingResponse) => void;
    reject: (reason: any) => void;
    request: EmbeddingRequest;
  }> = [];
  private pendingRequest: {
    resolve: (value: EmbeddingResponse) => void;
    reject: (reason: any) => void;
  } | null = null;
  private stdoutBuffer: string = '';

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  async load(): Promise<boolean> {
    try {
      console.log('[PythonEmbeddingService] Starting Python embedding service...');
      console.log('[PythonEmbeddingService] Model path:', this.modelPath);

      const pythonScriptPath = path.join(__dirname, '../../python-embedding-service.py');
      console.log('[PythonEmbeddingService] Python script path:', pythonScriptPath);

      const pythonCmd = detectPythonCommand();
      console.log('[PythonEmbeddingService] Using Python command:', pythonCmd);

      this.pythonProcess = spawn(pythonCmd, [
        pythonScriptPath,
        '--model-path',
        this.modelPath
      ], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      if (!this.pythonProcess.stdin || !this.pythonProcess.stdout || !this.pythonProcess.stderr) {
        throw new Error('Failed to create Python process streams');
      }

      this.pythonProcess.stderr.on('data', (data) => {
        console.log('[PythonEmbeddingService] Python:', data.toString().trim());
      });

      this.pythonProcess.stdout.on('data', (data) => {
        this.handleResponse(data.toString());
      });

      this.pythonProcess.on('close', (code) => {
        console.log('[PythonEmbeddingService] Python process exited with code:', code);
        this.isLoaded = false;
        this.pythonProcess = null;
        // Reject any pending request
        if (this.pendingRequest) {
          this.pendingRequest.reject(new Error(`Python process exited with code ${code}`));
          this.pendingRequest = null;
        }
        // Reject all queued requests
        while (this.requestQueue.length > 0) {
          const queued = this.requestQueue.shift();
          queued?.reject(new Error(`Python process exited with code ${code}`));
        }
      });

      this.pythonProcess.on('error', (error) => {
        console.error('[PythonEmbeddingService] Python process error:', error);
        this.isLoaded = false;
        this.pythonProcess = null;
      });

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn('[PythonEmbeddingService] Load timeout, assuming failed');
          this.isLoaded = false;
          resolve();
        }, 15000);

        const checkLoaded = setInterval(() => {
          if (this.isLoaded || !this.pythonProcess) {
            clearTimeout(timeout);
            clearInterval(checkLoaded);
            resolve();
          }
        }, 500);
      });

      if (!this.isReady()) {
        console.warn('[PythonEmbeddingService] Failed to load (process died or timed out)');
        return false;
      }

      console.log('[PythonEmbeddingService] Python embedding service loaded');
      return true;
    } catch (error) {
      console.error('[PythonEmbeddingService] Failed to load:', error);
      this.isLoaded = false;
      return false;
    }
  }

  private handleResponse(data: string): void {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line) as EmbeddingResponse;

        if (response.success) {
          this.isLoaded = true;
        }

        if (this.pendingRequest) {
          if (response.success) {
            this.pendingRequest.resolve(response);
          } else {
            this.pendingRequest.reject(new Error(response.error || 'Unknown error'));
          }
          this.pendingRequest = null;
          this.processNextRequest();
        }
      } catch (e) {
        console.error('[PythonEmbeddingService] Failed to parse response:', e, 'Line:', line);
      }
    }
  }

  private processNextRequest(): void {
    if (this.pendingRequest || this.requestQueue.length === 0) {
      return;
    }

    const next = this.requestQueue.shift();
    if (!next) return;

    this.pendingRequest = {
      resolve: next.resolve,
      reject: next.reject
    };

    this.sendRequest(next.request);
  }

  private sendRequest(request: EmbeddingRequest): void {
    if (!this.pythonProcess || !this.pythonProcess.stdin) {
      throw new Error('Python process not running');
    }

    const requestJson = JSON.stringify(request) + '\n';
    this.pythonProcess.stdin.write(requestJson);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.isLoaded || !this.pythonProcess) {
      throw new Error('Python embedding service not loaded');
    }

    return new Promise((resolve, reject) => {
      const safeText = String(text || '');
      const request: EmbeddingRequest = { text: safeText };

      // Add a 30-second timeout to prevent infinite hangs
      const timeout = setTimeout(() => {
        reject(new Error('Embedding request timed out after 30 seconds'));
        // Remove from queue if still queued
        const idx = this.requestQueue.findIndex(q => q.request === request);
        if (idx !== -1) this.requestQueue.splice(idx, 1);
        // Clear pending if it's the current one
        if (this.pendingRequest) {
          this.pendingRequest = null;
        }
      }, 30000);

      this.requestQueue.push({
        resolve: (response) => {
          clearTimeout(timeout);
          if (response.embedding) {
            resolve(response.embedding);
          } else {
            reject(new Error(response.error || 'No embedding returned'));
          }
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
        request
      });

      this.processNextRequest();
    });
  }

  isReady(): boolean {
    return this.isLoaded && this.pythonProcess !== null;
  }

  unload(): void {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    this.isLoaded = false;
    this.requestQueue = [];
    this.pendingRequest = null;
  }
}
