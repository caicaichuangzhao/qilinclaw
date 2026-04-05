import { spawn } from 'child_process';
import path from 'path';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  commitsBehind: number;
  latestCommitHash?: string;
  latestCommitMessage?: string;
}

export interface UpdatePullResult {
  success: boolean;
  message: string;
  log?: string;
}

const execGitCommand = async (args: string[], cwd: string = process.cwd()): Promise<string> => {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    git.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        // Some git commands write to stderr even on success, but if code != 0, it's an error
        reject(new Error(`Git error (code ${code}): ${stderr || stdout}`));
      }
    });

    git.on('error', (err) => {
      reject(err);
    });
  });
};

class SystemUpdateService {
  /**
   * Checks for updates by fetching from origin and comparing HEAD with origin/main.
   * Note: This assumes the primary branch is 'main'.
   */
  async checkUpdate(): Promise<UpdateCheckResult> {
    try {
      // 1. Fetch latest changes from origin safely
      await execGitCommand(['fetch', 'origin']);

      // 2. Discover the default branch (usually HEAD or main)
      // fallback to origin/main if symbolic-ref gets issues
      let remoteBranch = 'origin/main';
      try {
         const remoteHead = await execGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD']);
         if (remoteHead) {
             remoteBranch = remoteHead.replace('refs/remotes/', '');
         }
      } catch (e) {
         // Silently fallback to origin/main
      }

      // 3. Check how many commits we are behind
      const revListOutput = await execGitCommand(['rev-list', '--count', `HEAD..${remoteBranch}`]);
      const commitsBehind = parseInt(revListOutput, 10);

      if (commitsBehind > 0) {
        // We have updates. Let's get the latest commit message on the remote branch
        const gitLogOutput = await execGitCommand(['log', '-1', '--format=%h|%s', remoteBranch]);
        const [hash, ...msgParts] = gitLogOutput.split('|');
        return {
           hasUpdate: true,
           commitsBehind,
           latestCommitHash: hash,
           latestCommitMessage: msgParts.join('|'),
        };
      }

      return {
        hasUpdate: false,
        commitsBehind: 0
      };
    } catch (error) {
      console.error('[SystemUpdateService] Error checking for updates:', error);
      throw new Error(`无法检查更新，请确保当前目录下是一个 Git 仓库。\n详情: ${(error as Error).message}`);
    }
  }

  /**
   * Performs an update by stashing local changes, pulling with rebase, and trying to pop stash.
   */
  async performUpdate(): Promise<UpdatePullResult> {
    let log = '';
    const addLog = (msg: string) => {
      log += msg + '\n';
      console.log(`[SystemUpdateService] ${msg}`);
    };

    try {
      addLog('正在准备更新系统环境...');
      
      // Determine remote default branch
      let remoteBranch = 'origin/main';
      try {
         const remoteHead = await execGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD']);
         if (remoteHead) remoteBranch = remoteHead.replace('refs/remotes/', '');
      } catch (e) {}
      
      const targetBranch = remoteBranch.replace('origin/', '');

      // Check for uncommitted changes
      const statusOutput = await execGitCommand(['status', '--porcelain']);
      const hasChanges = statusOutput.trim().length > 0;

      if (hasChanges) {
        addLog('检测到本地未提交的修改，正在自动进行 stash 工作区存档...');
        await execGitCommand(['stash', 'save', 'Auto-stash before system update']);
      }

      addLog('正在从远端拉取并应用最新代码 (Pull with Rebase)...');
      try {
        const pullOutput = await execGitCommand(['pull', '--rebase', 'origin', targetBranch]);
        addLog(pullOutput);
      } catch (e: any) {
        // If rebase fails, we need to abort rebase to not leave git in an erratic state
        addLog(`拉取失败，尝试中断 rebase: ${e.message}`);
        try {
           await execGitCommand(['rebase', '--abort']);
        } catch (_) {}
        throw new Error('拉取代码存在无法自动合并的严重冲突。');
      }

      // If we stashed, pop it
      if (hasChanges) {
        addLog('正在还原您的本地暂存修改 (Stash Pop)...');
        try {
          const popOutput = await execGitCommand(['stash', 'pop']);
          addLog(popOutput);
        } catch (stashErr) {
           addLog('警告: 还原本地修改时产生冲突，保留在了暂存区 (stash) 供您手动解决。');
        }
      }

      addLog('✅ 系统更新完成！');
      return {
        success: true,
        message: '更新已成功应用，建议您稍后重启整个 QilinClaw 服务以完全生效。',
        log,
      };
    } catch (error) {
      addLog(`❌ 更新过程发生系统错误: ${(error as Error).message}`);
      return {
        success: false,
        message: '更新失败: ' + (error as Error).message,
        log,
      };
    }
  }
}

export const systemUpdateService = new SystemUpdateService();
