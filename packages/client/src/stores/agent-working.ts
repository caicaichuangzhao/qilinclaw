import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

interface AgentWorkingState {
  agentId: string;
  isWorking: boolean;
  startTime?: number;
}

export const useAgentWorkingStore = defineStore('agentWorking', () => {
  const workingStates = ref<Record<string, AgentWorkingState>>({});

  function setAgentWorking(agentId: string, isWorking: boolean) {
    if (isWorking) {
      workingStates.value[agentId] = {
        agentId,
        isWorking: true,
        startTime: Date.now(),
      };
    } else {
      delete workingStates.value[agentId];
    }
  }

  function isAgentWorking(agentId: string): boolean {
    return !!workingStates.value[agentId]?.isWorking;
  }

  const workingAgents = computed(() => Object.values(workingStates.value));

  return {
    workingStates,
    setAgentWorking,
    isAgentWorking,
    workingAgents,
  };
});