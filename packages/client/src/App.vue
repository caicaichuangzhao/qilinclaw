<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useStatusStore } from '@/stores/status';
import { useI18n } from '@/i18n';
import logoImage from './assets/logo.png';
import { 
  LayoutDashboard, MessageSquare, Bot, Cpu, BookOpen, Wrench, Server, FolderOpen, Settings, ChevronDown, Users, Globe
} from 'lucide-vue-next';

const router = useRouter();
const route = useRoute();
const statusStore = useStatusStore();
const { t, locale, setLocale } = useI18n();

const currentPath = computed(() => route.path);

watch(() => route.name, () => {
  statusStore.startPolling(5000);
}, { immediate: true });

onUnmounted(() => {
  statusStore.stopPolling();
});

const menuItems = computed(() => [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { path: '/agents', icon: MessageSquare, labelKey: 'nav.agents', isAccent: true },
  { path: '/bots', icon: Bot, labelKey: 'nav.bots' },
  { path: '/office', icon: Users, labelKey: 'nav.office' },
  { path: '/llm', icon: Cpu, labelKey: 'nav.models' },
  { path: '/knowledge', icon: BookOpen, labelKey: 'nav.knowledge' },
  { path: '/skills', icon: Wrench, labelKey: 'nav.skills' },
  { path: '/mcp', icon: Server, labelKey: 'nav.mcp' },
  { path: '/files', icon: FolderOpen, labelKey: 'nav.files' },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
]);

function navigateTo(path: string) {
  router.push(path);
}

function toggleLocale() {
  setLocale(locale.value === 'zh' ? 'en' : 'zh');
}
</script>

<template>
  <div class="flex h-screen w-full bg-[#050505] text-zinc-300 font-sans overflow-hidden selection:bg-amber-500/30 relative">
    
    <!-- 全局系统异常气泡提示 -->
    <transition
      enter-active-class="transition duration-500 ease-out"
      enter-from-class="-translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-300 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-full opacity-0"
    >
      <div 
        v-if="statusStore.recoveryCountdown" 
        class="absolute top-0 left-0 right-0 z-50 bg-red-600/90 text-white px-4 py-3 flex items-center justify-center font-bold text-sm shadow-[0_4px_12px_rgba(220,38,38,0.5)] backdrop-blur-md"
      >
        {{ t('status.systemAlert', { countdown: statusStore.recoveryCountdown }) }}
      </div>
    </transition>

    <!-- 氛围背景光晕 -->
    <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-amber-600/10 rounded-full blur-[120px] pointer-events-none transition-all duration-1000"></div>
    <div class="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-600/10 rounded-full blur-[120px] pointer-events-none transition-all duration-1000"></div>

    <!-- ================= 主侧边栏 ================= -->
    <aside class="w-72 h-full py-6 pl-6 hidden md:flex flex-col z-10 shrink-0">
      <div class="flex-1 bg-white/[0.02] border border-white/[0.05] rounded-[2rem] backdrop-blur-2xl flex flex-col overflow-hidden shadow-2xl relative">
        
        <div class="p-6 pb-4 border-b border-white/[0.05]">
          <img 
            :src="logoImage" 
            alt="Qilin Claw" 
            class="h-28 w-auto object-contain drop-shadow-[0_8px_16px_rgba(251,191,36,0.2)] hover:scale-105 transition-transform duration-500 mx-auto"
          />
        </div>

        <nav class="flex-1 px-4 py-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          <div 
            v-for="item in menuItems" 
            :key="item.path"
            @click="navigateTo(item.path)" 
            :class="[
              'flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer transition-all duration-300 group',
              currentPath === item.path ? (item.isAccent ? 'bg-gradient-to-r from-amber-500/20 to-transparent text-amber-400 font-bold border border-amber-500/20 shadow-[inset_4px_0_0_rgba(245,158,11,1)]' : 'bg-gradient-to-r from-amber-500/10 to-transparent text-amber-400 font-bold border border-amber-500/10 shadow-[inset_4px_0_0_rgba(251,191,36,1)]') : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200 border border-transparent'
            ]"
          >
            <div class="flex items-center gap-3">
              <component :is="item.icon" class="transition-all" :class="currentPath === item.path ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-300'" :size="20" />
              <span class="text-sm font-bold">{{ t(item.labelKey) }}</span>
            </div>
          </div>
        </nav>

        <!-- Language Selector -->
        <div 
          @click="toggleLocale"
          class="mx-4 mb-2 p-3 bg-black/20 border border-white/[0.05] rounded-2xl flex items-center justify-between cursor-pointer hover:bg-white/[0.05] transition-colors group"
        >
          <div class="flex items-center gap-3">
            <Globe :size="16" class="text-zinc-500 group-hover:text-amber-400 transition-colors" />
            <span class="text-sm font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">{{ t('nav.language') }}</span>
          </div>
          <span class="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
            {{ locale === 'zh' ? '中文' : 'EN' }}
          </span>
        </div>

        <div class="p-4 mx-4 mb-4 bg-black/40 border border-white/[0.05] rounded-2xl flex items-center justify-between cursor-pointer hover:bg-white/[0.05] transition-colors group">
          <div class="flex items-center gap-3">
            <div 
              class="w-2.5 h-2.5 rounded-full animate-pulse"
              :class="[
                statusStore.healthStatus === 'healthy' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' :
                statusStore.healthStatus === 'degraded' ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' :
                statusStore.healthStatus === 'recovering' ? 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]' :
                'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]'
              ]"
            ></div>
            <span class="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">{{ statusStore.statusText }}</span>
          </div>
          <ChevronDown :size="16" class="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
        </div>
      </div>
    </aside>

    <!-- ================= 主内容区 ================= -->
    <main 
      class="flex-1 h-full flex flex-col z-10 overflow-hidden relative py-6 pr-6 pl-4 md:pl-6 gap-6"
    >
      <router-view v-slot="{ Component }">
        <transition 
          mode="out-in"
          enter-active-class="transition duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-4"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition duration-200 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 -translate-y-4"
        >
          <component :is="Component" :key="route.path" />
        </transition>
      </router-view>
    </main>

  </div>
</template>

<style scoped>
/* 隐藏滚动条样式 */
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(251,191,36,0.3); }
</style>
