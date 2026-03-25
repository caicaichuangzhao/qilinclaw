import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { statusApi, type SystemStatus } from '@/api';
import { useI18n } from '@/i18n';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'recovering';

export interface EnhancedSystemStatus extends Omit<SystemStatus, 'lastError'> {
  healthStatus: HealthStatus;
  errorType?: 'gateway' | 'system' | 'file' | 'network' | 'bot' | 'unknown';
  lastError: {
    message: string;
    context: string;
    timestamp: number;
    type?: 'gateway' | 'system' | 'file' | 'network' | 'bot' | 'unknown';
  } | null;
  recoveryInfo: {
    inProgress: boolean;
    scheduledAt: number | null;
    recoverIn: number | null;
    attemptCount: number;
  };
  components: {
    database: { status: 'ok' | 'error'; message: string };
    bots: { status: 'ok' | 'error' | 'partial'; message: string; count: number };
    memory: { status: 'ok' | 'warning' | 'error'; message: string };
    network: { status: 'ok' | 'error'; message: string };
    gateway: { status: 'ok' | 'error'; message: string };
  };
}

export const useStatusStore = defineStore('status', () => {
  const status = ref<EnhancedSystemStatus | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const healthy = computed(() => status.value?.healthy ?? false);
  const healthStatus = computed(() => status.value?.healthStatus ?? 'unhealthy');
  const errorType = computed(() => status.value?.errorType ?? 'unknown');
  const uptime = computed(() => status.value?.uptime ?? 0);
  const activeBots = computed(() => status.value?.activeBots ?? []);
  const memoryUsage = computed(() => status.value?.memoryUsage ?? null);
  const lastError = computed(() => status.value?.lastError ?? null);
  const recoveryInfo = computed(() => status.value?.recoveryInfo ?? null);

  const statusText = computed(() => {
    const { t } = useI18n();
    if (healthStatus.value === 'healthy') return t('status.healthy');
    if (healthStatus.value === 'recovering') return t('status.recovering');

    const errType = errorType.value;
    switch (errType) {
      case 'gateway': return t('status.gatewayDown');
      case 'network': return t('status.networkError');
      case 'file': return t('status.fileError');
      case 'system': return t('status.systemError');
      case 'bot': return t('status.botError');
      default: return t('status.systemError');
    }
  });

  const recoveryCountdown = computed(() => {
    const recoverIn = recoveryInfo.value?.recoverIn;
    if (!recoverIn || recoverIn <= 0) return null;

    const minutes = Math.floor(recoverIn / 60000);
    const seconds = Math.floor((recoverIn % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  });

  async function fetchStatus() {
    loading.value = true;
    error.value = null;
    try {
      const response = await statusApi.get();
      status.value = response.data as unknown as EnhancedSystemStatus;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  function startPolling(intervalMs: number = 5000) {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
    fetchStatus();
    pollInterval = setInterval(fetchStatus, intervalMs);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const { t } = useI18n();
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return t('dashboard.uptimeFormat', { hours: String(hours), minutes: String(minutes % 60) });
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(2)} ${units[i]}`;
  }

  return {
    status,
    loading,
    error,
    healthy,
    healthStatus,
    errorType,
    statusText,
    uptime,
    activeBots,
    memoryUsage,
    lastError,
    recoveryInfo,
    recoveryCountdown,
    fetchStatus,
    startPolling,
    stopPolling,
    formatUptime,
    formatBytes,
  };
});
