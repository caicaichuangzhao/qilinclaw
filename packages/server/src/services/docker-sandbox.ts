import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class DockerSandboxService {
    private static instance: DockerSandboxService;
    private isDockerAvailable = false;
    private containerMap = new Map<string, string>(); // agentId -> containerId
    private cwdMap = new Map<string, string>(); // agentId -> current working directory inside container

    private constructor() {
        this.checkDockerReady();
    }

    public static getInstance(): DockerSandboxService {
        if (!DockerSandboxService.instance) {
            DockerSandboxService.instance = new DockerSandboxService();
        }
        return DockerSandboxService.instance;
    }

    private async checkDockerReady(): Promise<void> {
        try {
            await execAsync('docker info');
            this.isDockerAvailable = true;
            console.log('[DockerSandbox] Docker is available on the host.');
        } catch (error) {
            this.isDockerAvailable = false;
            console.warn('[DockerSandbox] Docker is NOT available or not running on the host.');
        }
    }

    public isAvailable(): boolean {
        return this.isDockerAvailable;
    }

    /**
     * Get the status of a Docker container for the given agent.
     * Returns 'running', 'stopped', 'not_found', or 'docker_unavailable'.
     */
    public async getContainerStatus(agentId: string): Promise<'running' | 'stopped' | 'not_found' | 'docker_unavailable'> {
        if (!this.isDockerAvailable) return 'docker_unavailable';
        if (!this.containerMap.has(agentId)) return 'not_found';

        const containerId = this.containerMap.get(agentId)!;
        try {
            const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${containerId}`);
            return stdout.trim() === 'true' ? 'running' : 'stopped';
        } catch {
            this.containerMap.delete(agentId);
            this.cwdMap.delete(agentId);
            return 'not_found';
        }
    }

    /**
     * Provision a Docker container for an agent.
     * Called when agent is created/updated with hardSandboxEnabled = true.
     * If a container already exists and is running, this is a no-op.
     */
    public async provisionForAgent(agentId: string): Promise<{ containerId: string; status: string }> {
        // Re-check Docker availability
        await this.checkDockerReady();
        if (!this.isDockerAvailable) {
            throw new Error('Docker is not available on this host. Please ensure Docker Desktop is running.');
        }

        // Check if already provisioned and running
        if (this.containerMap.has(agentId)) {
            const existingId = this.containerMap.get(agentId)!;
            try {
                const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${existingId}`);
                if (stdout.trim() === 'true') {
                    console.log(`[DockerSandbox] Container for agent ${agentId} already running: ${existingId}`);
                    return { containerId: existingId, status: 'already_running' };
                }
            } catch {
                // Container gone, remove stale mapping
                this.containerMap.delete(agentId);
                this.cwdMap.delete(agentId);
            }
        }

        // Create a new persistent container bound to this agent
        const sanitizedId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const containerName = `qilin_sandbox_${sanitizedId}`;

        // Remove any leftover container with same name (from crashed previous run)
        try {
            await execAsync(`docker rm -f ${containerName}`);
        } catch {
            // Ignore — container may not exist
        }

        console.log(`[DockerSandbox] Provisioning sandbox container for agent ${agentId}: ${containerName}`);

        const { stdout } = await execAsync(
            `docker run -d --name ${containerName} --network none node:22-alpine tail -f /dev/null`
        );
        const containerId = stdout.trim();
        this.containerMap.set(agentId, containerId);

        // Initial setup in the container
        await execAsync(`docker exec ${containerId} mkdir -p /workspace`);
        this.cwdMap.set(agentId, '/workspace');

        console.log(`[DockerSandbox] ✅ Container provisioned for agent ${agentId}: ${containerId}`);
        return { containerId, status: 'created' };
    }

    /**
     * Deprovision (remove) the Docker container for an agent.
     * Called when agent is deleted or hardSandboxEnabled is toggled off.
     */
    public async deprovisionForAgent(agentId: string): Promise<void> {
        if (!this.containerMap.has(agentId)) {
            // Also try to remove by naming convention in case of stale state
            const sanitizedId = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
            const containerName = `qilin_sandbox_${sanitizedId}`;
            try {
                await execAsync(`docker rm -f ${containerName}`);
                console.log(`[DockerSandbox] Removed stale container ${containerName}`);
            } catch {
                // Ignore
            }
            return;
        }

        const containerId = this.containerMap.get(agentId)!;
        console.log(`[DockerSandbox] Deprovisioning container for agent ${agentId}: ${containerId}`);
        try {
            await execAsync(`docker rm -f ${containerId}`);
            console.log(`[DockerSandbox] ✅ Container removed for agent ${agentId}`);
        } catch (error) {
            console.error(`[DockerSandbox] Failed to remove container ${containerId}`, error);
        } finally {
            this.containerMap.delete(agentId);
            this.cwdMap.delete(agentId);
        }
    }

    /**
     * Run a command inside the Docker container for the given agent.
     * If no container exists yet, one will be created on the fly.
     */
    public async runInSandbox(command: string, agentId: string): Promise<{ stdout: string; stderr: string }> {
        if (!this.isDockerAvailable) {
            throw new Error('Docker is not available on this host. Cannot run command in hard sandbox.');
        }

        // Ensure container exists (provision if needed — handles the case where server restarted)
        let containerId: string;
        if (this.containerMap.has(agentId)) {
            const status = await this.getContainerStatus(agentId);
            if (status === 'running') {
                containerId = this.containerMap.get(agentId)!;
            } else {
                // Container died, re-provision
                const result = await this.provisionForAgent(agentId);
                containerId = result.containerId;
            }
        } else {
            const result = await this.provisionForAgent(agentId);
            containerId = result.containerId;
        }

        console.log(`[DockerSandbox] Routing command to container ${containerId}: ${command}`);
        const cwd = this.cwdMap.get(agentId) || '/workspace';

        try {
            const escapeSingleQuotes = (str: string) => str.replace(/'/g, "'\\''");
            const escapedCommand = escapeSingleQuotes(command);

            const magicToken = '___QILIN_CWD_END___';
            const wrapperCommand = `cd "${cwd}" && eval '${escapedCommand}'; echo "${magicToken}\\n"$(pwd)`;

            const { stdout, stderr } = await execAsync(
                `docker exec ${containerId} sh -c '${wrapperCommand}'`
            );

            let finalStdout = stdout;
            if (stdout.includes(magicToken)) {
                const parts = stdout.split(magicToken);
                finalStdout = parts[0];
                const newCwd = parts[1].trim();
                if (newCwd) {
                    this.cwdMap.set(agentId, newCwd);
                }
            }

            return { stdout: finalStdout, stderr };
        } catch (error: any) {
            if (error.stdout !== undefined || error.stderr !== undefined) {
                return {
                    stdout: error.stdout || '',
                    stderr: error.stderr || error.message
                };
            }
            throw error;
        }
    }

}

export const dockerSandboxService = DockerSandboxService.getInstance();
