<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fileApi, type FileInfo } from '@/api';
import { useI18n } from '@/i18n';

const { t } = useI18n();

const route = useRoute();
const router = useRouter();

const currentPath = ref((route.query.path as string) || '');

watch(currentPath, (val) => {
  router.replace({ query: { ...route.query, path: val } }).catch(() => {});
});

const files = ref<FileInfo[]>([]);
const loading = ref(false);
const selectedFile = ref<FileInfo | null>(null);
const fileContent = ref('');
const showEditor = ref(false);
const saving = ref(false);
const searchQuery = ref('');
const searchResults = ref<Array<{ file: FileInfo; matches?: string[] }>>([]);

onMounted(async () => {
  await loadFiles();
});

async function loadFiles() {
  loading.value = true;
  try {
    const response = await fileApi.list(currentPath.value);
    files.value = response.data;
  } catch (error) {
    console.error('Failed to load files:', error);
  } finally {
    loading.value = false;
  }
}

async function navigateTo(item: FileInfo) {
  if (item.isDirectory) {
    currentPath.value = item.path;
    selectedFile.value = null;
    showEditor.value = false;
    await loadFiles();
  } else {
    await openFile(item);
  }
}

async function openFile(item: FileInfo) {
  try {
    const response = await fileApi.read(item.path);
    selectedFile.value = item;
    fileContent.value = response.data.content;
    showEditor.value = true;
  } catch (error) {
    console.error('Failed to read file:', error);
  }
}

async function saveFile() {
  if (!selectedFile.value) return;
  saving.value = true;
  try {
    await fileApi.write(selectedFile.value.path, fileContent.value);
  } catch (error) {
    console.error('Failed to save file:', error);
  } finally {
    saving.value = false;
  }
}

function goUp() {
  const parts = currentPath.value.split('/').filter(Boolean);
  parts.pop();
  currentPath.value = parts.join('/');
  loadFiles();
}

function closeEditor() {
  showEditor.value = false;
  selectedFile.value = null;
  fileContent.value = '';
}

async function createFile() {
  const name = prompt(t('files.enterFileName'));
  if (!name) return;
  try {
    const path = currentPath.value ? `${currentPath.value}/${name}` : name;
    await fileApi.create(path);
    await loadFiles();
  } catch (error) {
    console.error('Failed to create file:', error);
  }
}

async function createFolder() {
  const name = prompt(t('files.enterFolderName'));
  if (!name) return;
  try {
    const path = currentPath.value ? `${currentPath.value}/${name}` : name;
    await fileApi.create(path + '/.gitkeep', '');
    await loadFiles();
  } catch (error) {
    console.error('Failed to create folder:', error);
  }
}

const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerUpload() {
  fileInputRef.value?.click();
}

async function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  const filesList = target.files;
  if (!filesList || filesList.length === 0) return;

  for (let i = 0; i < filesList.length; i++) {
    const file = filesList[i];
    const reader = new FileReader();

    reader.onload = async (e) => {
      const content = e.target?.result as string;
      const path = currentPath.value ? `${currentPath.value}/${file.name}` : file.name;
      try {
        await fileApi.upload(path, content);
      } catch (error) {
        console.error(`Failed to upload file ${file.name}:`, error);
        alert(`Failed to upload ${file.name}`);
      }
      
      // Reload on last file
      if (i === filesList.length - 1) {
        await loadFiles();
      }
    };

    reader.onerror = () => {
      console.error(`Error reading file ${file.name}`);
      alert(`Error reading file ${file.name}`);
    };

    reader.readAsText(file);
  }
  
  // Clear input so same file can be uploaded again
  target.value = '';
}

async function deleteItem(item: FileInfo) {
  if (!confirm(t('files.deleteConfirm', { name: item.name }))) return;
  try {
    await fileApi.delete(item.path);
    await loadFiles();
    if (selectedFile.value?.path === item.path) {
      closeEditor();
    }
  } catch (error) {
    console.error('Failed to delete:', error);
  }
}

async function search() {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
    return;
  }
  try {
    const response = await fileApi.search(searchQuery.value, true);
    searchResults.value = response.data;
  } catch (error) {
    console.error('Search failed:', error);
  }
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

const breadcrumbs = computed(() => {
  if (!currentPath.value) return [];
  return currentPath.value.split('/').filter(Boolean);
});

async function navigateToBreadcrumb(index: number) {
  const parts = breadcrumbs.value.slice(0, index + 1);
  currentPath.value = parts.join('/');
  await loadFiles();
}
</script>

<template>
  <div class="h-full flex">
    <!-- File Browser -->
    <div class="flex-1 flex flex-col border-r border-white/5">
      <!-- Toolbar -->
      <div class="p-4 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <div class="flex items-center gap-4 mb-4">
          <button
            class="btn btn-secondary"
            :disabled="!currentPath"
            @click="goUp"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg>
          </button>
          <div class="flex items-center gap-2 text-sm">
            <button @click="currentPath = ''; loadFiles()" class="hover:text-primary-400">{{ t('files.root') }}</button>
            <span v-for="(part, index) in breadcrumbs" :key="index" class="flex items-center gap-2">
              <span class="text-slate-500">/</span>
              <button @click="navigateToBreadcrumb(index)" class="hover:text-primary-400">{{ part }}</button>
            </span>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex-1 relative">
            <input
              v-model="searchQuery"
              type="text"
              class="input pl-10"
              :placeholder="t('files.searchPlaceholder')"
              @keyup.enter="search"
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
            </svg>
          </div>
          <button class="btn btn-secondary" @click="createFolder">{{ t('files.newFolder') }}</button>
          <button class="btn btn-secondary" @click="triggerUpload">{{ t('files.uploadFile') }}</button>
          <input 
            type="file" 
            ref="fileInputRef" 
            class="hidden" 
            multiple 
            @change="handleFileUpload" 
          />
          <button class="btn btn-primary" @click="createFile">{{ t('files.newFile') }}</button>
        </div>
      </div>

      <!-- File List -->
      <div class="flex-1 overflow-auto">
        <div v-if="loading" class="text-center py-12">
          <div class="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto"></div>
        </div>

        <div v-else-if="searchResults.length > 0" class="p-4">
          <h3 class="text-lg font-semibold mb-4">{{ t('files.searchResults') }}</h3>
          <div class="space-y-2">
            <div
              v-for="result in searchResults"
              :key="result.file.path"
              class="p-3 bg-white/5 rounded-2xl hover:bg-white/10 border border-white/5 cursor-pointer transition-colors"
              @click="openFile(result.file)"
            >
              <div class="font-medium">{{ result.file.name }}</div>
              <div class="text-slate-400 text-sm">{{ result.file.path }}</div>
              <div v-if="result.matches" class="mt-2 text-sm text-slate-300">
                <div v-for="match in result.matches.slice(0, 3)" :key="match" class="font-mono text-xs">
                  {{ match }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <table v-else-if="files.length > 0" class="w-full">
          <thead class="bg-black/40 text-slate-400 text-sm border-b border-white/5">
            <tr>
              <th class="text-left p-4">{{ t('files.fileName') }}</th>
              <th class="text-left p-4 w-32">{{ t('files.fileSize') }}</th>
              <th class="text-left p-4 w-48">{{ t('files.lastModified') }}</th>
              <th class="text-right p-4 w-24">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="file in files"
              :key="file.path"
              class="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
              @click="navigateTo(file)"
            >
              <td class="p-4">
                <div class="flex items-center gap-3">
                  <span v-if="file.isDirectory" class="text-yellow-400">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </span>
                  <span v-else class="text-slate-400">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
                    </svg>
                  </span>
                  <span>{{ file.name }}</span>
                </div>
              </td>
              <td class="p-4 text-slate-400">
                {{ file.isDirectory ? '-' : formatSize(file.size) }}
              </td>
              <td class="p-4 text-slate-400">
                {{ formatDate(file.lastModified) }}
              </td>
              <td class="p-4 text-right">
                <button
                  class="text-red-400 hover:text-red-300"
                  @click.stop="deleteItem(file)"
                >
                  {{ t('common.delete') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-else class="text-center py-12 text-slate-400">
          {{ t('files.emptyFolder') }}
        </div>
      </div>
    </div>

    <!-- Editor Panel -->
    <div v-if="showEditor" class="w-1/2 flex flex-col bg-black/40 backdrop-blur-xl border-l border-white/5">
      <div class="p-4 border-b border-white/5 flex items-center justify-between">
        <div>
          <h3 class="font-semibold">{{ selectedFile?.name }}</h3>
          <p class="text-slate-400 text-sm">{{ selectedFile?.path }}</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" @click="closeEditor">{{ t('common.close') }}</button>
          <button class="btn btn-primary" @click="saveFile" :disabled="saving">
            {{ saving ? t('files.saving') : t('common.save') }}
          </button>
        </div>
      </div>
      <textarea
        v-model="fileContent"
        class="flex-1 p-4 bg-black/20 text-white font-mono text-sm resize-none focus:outline-none"
        spellcheck="false"
      ></textarea>
    </div>
  </div>
</template>
