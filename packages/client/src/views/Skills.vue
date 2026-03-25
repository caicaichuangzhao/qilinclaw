<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/api';
import { useI18n } from '@/i18n';

const { t } = useI18n();

interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: any;
  description?: string;
  enum?: string[];
}

interface SkillAction {
  id: string;
  type: 'llm' | 'function' | 'api' | 'file' | 'shell' | 'browser' | 'mcp';
  name: string;
  description: string;
  parameters?: SkillParameter[];
  config: Record<string, any>;
  handler?: string;
}

interface SkillTrigger {
  type: 'keyword' | 'regex' | 'intent' | 'always' | 'scheduled';
  patterns?: string[];
  schedule?: string;
  condition?: string;
}

interface SkillMetadata {
  author?: string;
  version?: string;
  license?: string;
  repository?: string;
  homepage?: string;
  tags?: string[];
  category?: string;
  icon?: string;
  screenshots?: string[];
}

interface Skill {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  type: 'tool' | 'integration' | 'automation' | 'custom';
  status: 'installed' | 'available' | 'disabled' | 'update_available';
  enabled: boolean;
  
  trigger: SkillTrigger;
  actions: SkillAction[];
  permissions?: Array<{
    name: string;
    description: string;
    granted: boolean;
    scope?: string[];
  }>;
  metadata?: SkillMetadata;
  
  configSchema?: Record<string, any>;
  userConfig?: Record<string, any>;
  
  dependencies?: string[];
  conflictsWith?: string[];
  
  createdAt: number;
  updatedAt: number;
  installedAt?: number;
}

interface SkillMarketplaceItem {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  category: string;
  tags: string[];
  icon?: string;
  installed: boolean;
  hasUpdate: boolean;
}

interface SkillCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const route = useRoute();
const router = useRouter();
const viewMode = ref<'installed' | 'marketplace'>((route.query.view as any) || 'installed');
const skills = ref<Skill[]>([]);
const marketplaceItems = ref<SkillMarketplaceItem[]>([]);
const categories = ref<SkillCategory[]>([]);
const selectedCategory = ref<string>((route.query.category as string) || 'all');

watch([viewMode, selectedCategory], ([newView, newCat]) => {
  router.replace({ query: { ...route.query, view: newView, category: newCat } }).catch(() => {});
});

const loading = ref(false);
const showModal = ref(false);
const showMarketplaceModal = ref(false);
const selectedSkill = ref<Skill | null>(null);
const selectedMarketplaceItem = ref<SkillMarketplaceItem | null>(null);
const searchQuery = ref('');

const filteredSkills = computed(() => {
  let result = skills.value;
  if (selectedCategory.value !== 'all') {
    result = result.filter(s => 
      s.metadata?.category === selectedCategory.value || 
      selectedCategory.value === s.metadata?.category
    );
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }
  return result;
});

const filteredMarketplaceItems = computed(() => {
  let result = marketplaceItems.value;
  if (selectedCategory.value !== 'all') {
    result = result.filter(item => item.category === selectedCategory.value);
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(item => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
  }
  return result;
});

onMounted(async () => {
  await loadSkills();
  await loadCategories();
  await loadMarketplace();
});

async function loadSkills() {
  loading.value = true;
  try {
    const response = await api.get('/skills');
    skills.value = response.data;
  } catch (error) {
    console.error('Failed to load skills:', error);
  } finally {
    loading.value = false;
  }
}

async function loadCategories() {
  try {
    const response = await api.get('/skills/categories');
    categories.value = response.data;
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

async function loadMarketplace() {
  try {
    const response = await api.get('/skills/marketplace');
    marketplaceItems.value = response.data;
  } catch (error) {
    console.error('Failed to load marketplace:', error);
  }
}

function openSkillDetail(skill: Skill) {
  selectedSkill.value = skill;
  showModal.value = true;
}

function openMarketplaceDetail(item: SkillMarketplaceItem) {
  selectedMarketplaceItem.value = item;
  showMarketplaceModal.value = true;
}

async function toggleSkill(skill: Skill) {
  try {
    await api.put(`/skills/${skill.id}`, { enabled: !skill.enabled });
    await loadSkills();
  } catch (error) {
    console.error('Failed to toggle skill:', error);
  }
}

async function deleteSkill(id: string) {
  if (!confirm(t('skills.deleteConfirm'))) return;

  try {
    await api.delete(`/skills/${id}`);
    await loadSkills();
  } catch (error) {
    console.error('Failed to delete skill:', error);
  }
}

async function installSkill(item: SkillMarketplaceItem) {
  try {
    await api.post(`/skills/marketplace/${item.id}/install`);
    
    showMarketplaceModal.value = false;
    await loadSkills();
    await loadMarketplace();
    alert(t('skills.installSuccess', { name: item.name }));
  } catch (error: any) {
    console.error('Failed to install skill:', error);
    alert(`${t('skills.installFailed')}: ${error.response?.data?.error || error.message}`);
  }
}

async function uninstallSkill(skill: Skill) {
  if (!confirm(t('skills.uninstallConfirm', { name: skill.name }))) return;

  try {
    await api.delete(`/skills/marketplace/${skill.id}/uninstall`);
    
    showModal.value = false;
    await loadSkills();
    await loadMarketplace();
    alert(t('skills.uninstalled', { name: skill.name }));
  } catch (error: any) {
    console.error('Failed to uninstall skill:', error);
    alert(`${t('skills.uninstallFailed')}: ${error.response?.data?.error || error.message}`);
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'installed':
      return 'bg-green-500/20 text-green-400';
    case 'available':
      return 'bg-amber-500/20 text-amber-500';
    case 'disabled':
      return 'bg-gray-500/20 text-gray-400';
    case 'update_available':
      return 'bg-yellow-500/20 text-yellow-400';
    default:
      return 'bg-slate-500/20 text-slate-400';
  }
}

function getStatusText(status: string) {
  switch (status) {
    case 'installed':
      return t('skills.installed');
    case 'available':
      return t('skills.available');
    case 'disabled':
      return t('skills.disabled');
    case 'update_available':
      return t('skills.updatable');
    default:
      return status;
  }
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'tool':
      return '🔧';
    case 'integration':
      return '🔌';
    case 'automation':
      return '⚡';
    case 'custom':
      return '✨';
    default:
      return '📦';
  }
}

function renderStars(rating: number) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  let stars = '';
  for (let i = 0; i < fullStars; i++) {
    stars += '⭐';
  }
  if (hasHalfStar) {
    stars += '✨';
  }
  return stars || '☆☆☆☆☆';
}
</script>

<template>
  <div class="h-full overflow-auto p-6">
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <div class="flex justify-between items-center mb-6">
        <div>
          <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-200 to-amber-500">{{ t('skills.title') }}</h1>
          <p class="text-slate-400 mt-2">{{ t('skills.subtitle') }}</p>
        </div>
        <div class="flex flex-col sm:flex-row gap-4 items-end sm:items-center">
          <div class="relative w-64">
            <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" class="stroke-current" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
            <input v-model="searchQuery" type="text" class="w-full bg-black/40 border border-white/[0.05] rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500/40 transition-colors placeholder-zinc-600 shadow-inner" :placeholder="t('skills.searchPlaceholder')" />
          </div>
          <div class="flex gap-2">
            <button 
              :class="['px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg', viewMode === 'installed' ? 'bg-gradient-to-br from-amber-500 to-yellow-500 text-black shadow-amber-500/20 active:scale-95' : 'bg-white/[0.05] text-zinc-300 hover:bg-white/[0.1] border border-white/[0.05] hover:text-white']"
              @click="viewMode = 'installed'"
            >
              {{ t('skills.installedSkills') }}
            </button>
            <button 
              :class="['px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg', viewMode === 'marketplace' ? 'bg-gradient-to-br from-amber-500 to-yellow-500 text-black shadow-amber-500/20 active:scale-95' : 'bg-white/[0.05] text-zinc-300 hover:bg-white/[0.1] border border-white/[0.05] hover:text-white']"
              @click="viewMode = 'marketplace'"
            >
              {{ t('skills.marketplace') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Category Filter -->
      <div class="flex flex-wrap gap-2 mb-6">
        <button
          v-for="category in categories"
          :key="category.id"
          :class="['px-4 py-2 rounded-full text-sm font-bold transition-colors', selectedCategory === category.id ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20' : 'bg-white/[0.05] text-zinc-300 hover:bg-white/[0.1] border border-transparent']"
          @click="selectedCategory = category.id"
        >
          {{ category.name }}
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="text-center py-8">
        <div class="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"></div>
      </div>

      <!-- Installed Skills View -->
      <div v-else-if="viewMode === 'installed'" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="skill in filteredSkills"
          :key="skill.id"
          class="card cursor-pointer hover:border-primary-500/50 transition-colors"
          @click="openSkillDetail(skill)"
        >
          <div class="flex justify-between items-start mb-3">
            <div class="flex items-center gap-2">
              <span class="text-2xl">{{ getTypeIcon(skill.type) }}</span>
              <div>
                <h3 class="text-lg font-semibold">{{ skill.name }}</h3>
                <div class="flex items-center gap-2">
                  <span :class="['text-xs px-2 py-0.5 rounded', getStatusBadgeClass(skill.status)]">
                    {{ getStatusText(skill.status) }}
                  </span>
                  <span v-if="skill.metadata?.category" class="text-xs px-2 py-0.5 rounded bg-slate-700">
                    {{ skill.metadata.category }}
                  </span>
                </div>
              </div>
            </div>
            <label class="flex items-center" @click.stop>
              <input
                type="checkbox"
                :checked="skill.enabled"
                @change="toggleSkill(skill)"
                class="toggle"
              />
            </label>
          </div>

          <p class="text-slate-400 text-sm mb-3">{{ skill.description }}</p>

          <div v-if="skill.trigger.patterns?.length" class="mb-3">
            <p class="text-xs text-slate-500 mb-1">{{ t('skills.triggerWords') }}</p>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="pattern in skill.trigger.patterns.slice(0, 3)"
                :key="pattern"
                class="text-xs px-2 py-0.5 rounded bg-primary-500/20 text-primary-400"
              >
                {{ pattern }}
              </span>
              <span v-if="skill.trigger.patterns.length > 3" class="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300">
                +{{ skill.trigger.patterns.length - 3 }}
              </span>
            </div>
          </div>

          <div class="flex justify-between items-center pt-3 border-t border-slate-700">
            <div class="flex items-center gap-2 text-xs text-slate-500">
              <span v-if="skill.metadata?.author">by {{ skill.metadata.author }}</span>
              <span v-if="skill.metadata?.version">v{{ skill.metadata.version }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="text-red-400/60 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10"
                title="卸载技能"
                @click.stop="uninstallSkill(skill)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
              <button
                class="text-sm text-primary-400 hover:text-primary-300"
                @click.stop="openSkillDetail(skill)"
              >
                {{ t('common.details') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Marketplace View -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="item in filteredMarketplaceItems"
          :key="item.id"
          class="card cursor-pointer hover:border-primary-500/50 transition-colors"
          @click="openMarketplaceDetail(item)"
        >
          <div class="flex justify-between items-start mb-3">
            <div>
              <h3 class="text-lg font-semibold">{{ item.name }}</h3>
              <div class="flex items-center gap-2">
                <span class="text-xs px-2 py-0.5 rounded bg-slate-700">
                  {{ item.category }}
                </span>
                <span v-if="item.installed" class="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                  {{ t('skills.installed') }}
                </span>
                <span v-else-if="item.hasUpdate" class="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                  {{ t('skills.updatable') }}
                </span>
              </div>
            </div>
          </div>

          <p class="text-slate-400 text-sm mb-3">{{ item.description }}</p>

          <div class="flex flex-wrap gap-1 mb-3">
            <span
              v-for="tag in item.tags.slice(0, 4)"
              :key="tag"
              class="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300"
            >
              {{ tag }}
            </span>
          </div>

          <div class="flex justify-between items-center pt-3 border-t border-slate-700">
            <div class="flex flex-col">
              <span class="text-xs text-slate-400">{{ item.author }}</span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-slate-500">{{ renderStars(item.rating) }}</span>
                <span class="text-xs text-slate-500">{{ item.downloads.toLocaleString() }} {{ t('skills.downloads') }}</span>
              </div>
            </div>
            <button
              v-if="!item.installed"
              class="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors"
              @click.stop="installSkill(item)"
            >
              {{ t('common.install') }}
            </button>
            <button
              v-else-if="item.hasUpdate"
              class="px-3 py-1.5 text-sm bg-yellow-600 hover:bg-yellow-500 rounded-lg transition-colors"
              @click.stop="installSkill(item)"
            >
              {{ t('common.update') }}
            </button>
            <button
              v-else
              class="px-3 py-1.5 text-sm bg-slate-600 rounded-lg cursor-default"
              disabled
            >
              {{ t('skills.installed') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Skill Detail Modal -->
      <div
        v-if="showModal && selectedSkill"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click="showModal = false"
      >
        <div class="bg-slate-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto" @click.stop>
          <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-3">
              <span class="text-3xl">{{ getTypeIcon(selectedSkill.type) }}</span>
              <div>
                <h2 class="text-2xl font-bold">{{ selectedSkill.name }}</h2>
                <div class="flex items-center gap-2 mt-1">
                  <span :class="['text-xs px-2 py-0.5 rounded', getStatusBadgeClass(selectedSkill.status)]">
                    {{ getStatusText(selectedSkill.status) }}
                  </span>
                  <span v-if="selectedSkill.metadata?.version" class="text-xs text-slate-400">
                    v{{ selectedSkill.metadata.version }}
                  </span>
                </div>
              </div>
            </div>
            <button class="text-slate-400 hover:text-white" @click="showModal = false">
              ✕
            </button>
          </div>

          <p class="text-slate-300 mb-4">{{ selectedSkill.longDescription || selectedSkill.description }}</p>

          <div v-if="selectedSkill.metadata?.tags?.length" class="mb-4">
            <h3 class="text-sm font-semibold text-slate-400 mb-2">{{ t('skills.tags') }}</h3>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="tag in selectedSkill.metadata.tags"
                :key="tag"
                class="text-xs px-2 py-1 rounded bg-slate-700"
              >
                {{ tag }}
              </span>
            </div>
          </div>

          <div class="mb-4">
            <h3 class="text-sm font-semibold text-slate-400 mb-2">{{ t('skills.actions') }}</h3>
            <div class="space-y-2">
              <div
                v-for="action in selectedSkill.actions"
                :key="action.id"
                class="p-3 bg-slate-700/50 rounded-lg"
              >
                <div class="flex items-center justify-between">
                  <span class="font-medium">{{ action.name }}</span>
                  <span class="text-xs px-2 py-0.5 rounded bg-primary-500/20 text-primary-400">
                    {{ action.type }}
                  </span>
                </div>
                <p class="text-sm text-slate-400 mt-1">{{ action.description }}</p>
              </div>
            </div>
          </div>

          <div v-if="selectedSkill.permissions?.length" class="mb-4">
            <h3 class="text-sm font-semibold text-slate-400 mb-2">{{ t('skills.permissions') }}</h3>
            <div class="space-y-2">
              <div
                v-for="perm in selectedSkill.permissions"
                :key="perm.name"
                class="flex items-center gap-2"
              >
                <span :class="['w-3 h-3 rounded-full', perm.granted ? 'bg-green-500' : 'bg-red-500']"></span>
                <span class="text-sm">{{ perm.name }}</span>
                <span class="text-xs text-slate-400">- {{ perm.description }}</span>
              </div>
            </div>
          </div>

          <div v-if="selectedSkill.metadata" class="mb-4">
            <h3 class="text-sm font-semibold text-slate-400 mb-2">{{ t('skills.info') }}</h3>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div v-if="selectedSkill.metadata.author">
                <span class="text-slate-500">{{ t('skills.author') }}</span>
                <span class="text-slate-300">{{ selectedSkill.metadata.author }}</span>
              </div>
              <div v-if="selectedSkill.metadata.license">
                <span class="text-slate-500">{{ t('skills.license') }}</span>
                <span class="text-slate-300">{{ selectedSkill.metadata.license }}</span>
              </div>
              <div>
                <span class="text-slate-500">{{ t('skills.createdAt') }}</span>
                <span class="text-slate-300">{{ formatDate(selectedSkill.createdAt) }}</span>
              </div>
              <div>
                <span class="text-slate-500">{{ t('skills.updatedAt') }}</span>
                <span class="text-slate-300">{{ formatDate(selectedSkill.updatedAt) }}</span>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button class="btn btn-secondary" @click="showModal = false">
              {{ t('common.close') }}
            </button>
            <button
              v-if="selectedSkill.status === 'installed' && !selectedSkill.id.startsWith('skill-shell') && !selectedSkill.id.startsWith('skill-file') && !selectedSkill.id.startsWith('skill-web') && !selectedSkill.id.startsWith('skill-code') && !selectedSkill.id.startsWith('skill-translate') && !selectedSkill.id.startsWith('skill-summarize') && !selectedSkill.id.startsWith('skill-explain')"
              class="btn btn-danger"
              @click="uninstallSkill(selectedSkill); showModal = false"
            >
              {{ t('common.uninstall') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Marketplace Detail Modal -->
      <div
        v-if="showMarketplaceModal && selectedMarketplaceItem"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        @click="showMarketplaceModal = false"
      >
        <div class="bg-slate-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto" @click.stop>
          <div class="flex justify-between items-start mb-4">
            <div>
              <h2 class="text-2xl font-bold">{{ selectedMarketplaceItem.name }}</h2>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-xs px-2 py-0.5 rounded bg-slate-700">
                  {{ selectedMarketplaceItem.category }}
                </span>
                <span class="text-xs text-slate-400">
                  v{{ selectedMarketplaceItem.version }}
                </span>
              </div>
            </div>
            <button class="text-slate-400 hover:text-white" @click="showMarketplaceModal = false">
              ✕
            </button>
          </div>

          <p class="text-slate-300 mb-4">{{ selectedMarketplaceItem.description }}</p>

          <div class="flex items-center gap-4 mb-4 text-sm">
            <div class="flex items-center gap-1">
              <span>{{ renderStars(selectedMarketplaceItem.rating) }}</span>
              <span class="text-slate-400">({{ selectedMarketplaceItem.rating }})</span>
            </div>
            <span class="text-slate-400">{{ selectedMarketplaceItem.downloads.toLocaleString() }} {{ t('skills.downloads') }}</span>
            <span class="text-slate-400">by {{ selectedMarketplaceItem.author }}</span>
          </div>

          <div class="flex flex-wrap gap-2 mb-6">
            <span
              v-for="tag in selectedMarketplaceItem.tags"
              :key="tag"
              class="text-sm px-3 py-1 rounded bg-slate-700"
            >
              {{ tag }}
            </span>
          </div>

          <div class="flex justify-end gap-3">
            <button class="btn btn-secondary" @click="showMarketplaceModal = false">
              {{ t('common.close') }}
            </button>
            <button
              v-if="!selectedMarketplaceItem.installed"
              class="btn btn-primary"
              @click="installSkill(selectedMarketplaceItem)"
            >
              {{ t('common.install') }}
            </button>
            <button
              v-else-if="selectedMarketplaceItem.hasUpdate"
              class="btn btn-primary"
              @click="installSkill(selectedMarketplaceItem)"
            >
              {{ t('common.update') }}
            </button>
            <button
              v-else
              class="btn btn-secondary"
              disabled
            >
              {{ t('skills.installed') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
