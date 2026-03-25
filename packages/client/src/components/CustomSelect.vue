<template>
  <div class="custom-select-container" ref="selectContainer" @keydown="handleKeyDown" tabindex="0">
    <!-- Selected Value Display -->
    <div 
      class="select-trigger" 
      :class="{ 'is-open': isOpen, 'is-disabled': disabled }"
      @click="toggleDropdown"
    >
      <div class="selected-value">
        <template v-if="selectedOption">
          <slot name="selected" :option="selectedOption">
            {{ selectedOption.label || selectedOption.value }}
          </slot>
        </template>
        <span v-else class="placeholder">{{ placeholder }}</span>
      </div>
      <div class="select-arrow" :class="{ 'is-open': isOpen }">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </div>
  </div>

  <!-- Dropdown Menu using fixed positioning -->
  <Teleport to="body">
    <Transition name="dropdown">
      <div 
        v-if="isOpen" 
        class="select-dropdown select-dropdown-fixed" 
        ref="dropdownMenu"
        :style="{ 
          top: dropdownPosition.top + 'px', 
          left: dropdownPosition.left + 'px', 
          width: dropdownPosition.width + 'px' 
        }"
      >
        
        <!-- Search Input (Optional) -->
        <div v-if="searchable" class="search-container">
          <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input 
            type="text" 
            v-model="searchQuery" 
            placeholder="Search..." 
            class="search-input"
            ref="searchInput"
            @click.stop
          />
        </div>

        <!-- Options List -->
        <ul class="options-list">
          <li v-if="!filteredOptions || filteredOptions.length === 0" class="no-options">
            没有匹配的选项
          </li>
          <li 
            v-for="(option, index) in (filteredOptions || [])" 
            :key="String(option.value)"
            class="select-option"
            :class="{ 
              'is-selected': isSelected(option),
              'is-highlighted': index === highlightedIndex,
              'is-disabled': option.disabled
            }"
            @click.stop="selectOption(option)"
            @mouseenter="highlightedIndex = index"
          >
            <slot name="option" :option="option">
              {{ option.label || option.value }}
            </slot>
            
            <svg v-if="isSelected(option)" class="check-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </li>
        </ul>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';

export interface SelectOption {
  value: string | number;
  label?: string;
  disabled?: boolean;
  [key: string]: any;
}

const props = withDefaults(defineProps<{
  modelValue?: string | number | null;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
}>(), {
  modelValue: null,
  options: () => [],
  placeholder: 'Select an option',
  disabled: false,
  searchable: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
  (e: 'change', value: string | number, option: SelectOption): void;
}>();

const selectContainer = ref<HTMLElement | null>(null);
const dropdownMenu = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

const isOpen = ref(false);
const searchQuery = ref('');
const highlightedIndex = ref(-1);
const dropdownPosition = ref({ top: 0, left: 0, width: 0 });

const safeOptions = computed(() => {
  return Array.isArray(props.options) ? props.options : [];
});

const filteredOptions = computed(() => {
  const opts = safeOptions.value;
  if (!props.searchable || !searchQuery.value) {
    return opts;
  }
  const query = searchQuery.value.toLowerCase();
  return opts.filter(opt => {
    const labelToSearch = String(opt.label || opt.value || '').toLowerCase();
    const valueToSearch = String(opt.value || '').toLowerCase();
    return labelToSearch.includes(query) || valueToSearch.includes(query);
  });
});

const selectedOption = computed(() => {
  return safeOptions.value.find(opt => opt.value === props.modelValue) || null;
});

const isSelected = (option: SelectOption) => option.value === props.modelValue;

const updateDropdownPosition = () => {
  if (selectContainer.value) {
    const rect = selectContainer.value.getBoundingClientRect();
    dropdownPosition.value = {
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width
    };
  }
};

const toggleDropdown = () => {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;
  
  if (isOpen.value) {
    searchQuery.value = '';
    const selectedIndex = filteredOptions.value.findIndex(opt => isSelected(opt));
    highlightedIndex.value = selectedIndex >= 0 ? selectedIndex : 0;
    updateDropdownPosition();
    
    if (props.searchable) {
      nextTick(() => {
        searchInput.value?.focus();
      });
    }
  }
};

const selectOption = (option: SelectOption) => {
  if (option.disabled) return;
  
  emit('update:modelValue', option.value);
  emit('change', option.value, option);
  isOpen.value = false;
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (props.disabled) return;

  switch (e.key) {
    case 'Enter':
    case ' ':
      if (!isOpen.value) {
        toggleDropdown();
        e.preventDefault();
      } else if (highlightedIndex.value >= 0 && highlightedIndex.value < filteredOptions.value.length) {
        selectOption(filteredOptions.value[highlightedIndex.value]);
        e.preventDefault();
      }
      break;
    case 'Escape':
      isOpen.value = false;
      e.preventDefault();
      break;
    case 'ArrowDown':
      if (!isOpen.value) {
        toggleDropdown();
      } else {
        highlightedIndex.value = Math.min(highlightedIndex.value + 1, filteredOptions.value.length - 1);
        scrollToHighlighted();
      }
      e.preventDefault();
      break;
    case 'ArrowUp':
      if (!isOpen.value) {
        toggleDropdown();
      } else {
        highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
        scrollToHighlighted();
      }
      e.preventDefault();
      break;
    case 'Tab':
      isOpen.value = false;
      break;
  }
};

const scrollToHighlighted = () => {
  nextTick(() => {
    if (!dropdownMenu.value) return;
    const highlightedEl = dropdownMenu.value.querySelector('.is-highlighted') as HTMLElement;
    const listEl = dropdownMenu.value.querySelector('.options-list') as HTMLElement;
    
    if (highlightedEl && listEl) {
      const elTop = highlightedEl.offsetTop;
      const elBottom = elTop + highlightedEl.offsetHeight;
      const listTop = listEl.scrollTop;
      const listBottom = listTop + listEl.offsetHeight;

      if (elTop < listTop) {
        listEl.scrollTop = elTop;
      } else if (elBottom > listBottom) {
        listEl.scrollTop = elBottom - listEl.offsetHeight;
      }
    }
  });
};

const handleClickOutside = (event: MouseEvent) => {
  if (
    isOpen.value &&
    selectContainer.value &&
    !selectContainer.value.contains(event.target as Node) &&
    dropdownMenu.value &&
    !dropdownMenu.value.contains(event.target as Node)
  ) {
    isOpen.value = false;
  }
};

const handleScroll = () => {
  if (isOpen.value) {
    updateDropdownPosition();
  }
};

watch(isOpen, (newVal) => {
  if (newVal) {
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updateDropdownPosition);
  } else {
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('resize', updateDropdownPosition);
  }
});

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
  window.removeEventListener('scroll', handleScroll, true);
  window.removeEventListener('resize', updateDropdownPosition);
});
</script>

<style scoped>
.custom-select-container {
  position: relative;
  width: 100%;
  max-width: 100%;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 100%;
  padding: 0.6rem 1rem;
  background-color: var(--surface-light, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 42px;
  color: var(--text-color, #ffffff);
  box-sizing: border-box;
  overflow: hidden;
}

.select-trigger:hover:not(.is-disabled) {
  border-color: var(--primary-color, #4facfe);
  background-color: var(--surface-hover, rgba(255, 255, 255, 0.08));
}

.select-trigger.is-open {
  border-color: var(--primary-color, #4facfe);
  box-shadow: 0 0 0 2px rgba(79, 172, 254, 0.2);
}

.select-trigger.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.custom-select-container:focus .select-trigger {
  border-color: var(--primary-color, #4facfe);
}

.selected-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
}

.placeholder {
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
}

.select-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  transition: transform 0.3s ease;
  margin-left: 0.5rem;
}

.select-arrow.is-open {
  transform: rotate(180deg);
}

.select-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 100%;
  max-width: 100%;
  background-color: var(--surface-color, #1a1b23);
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
  z-index: 9999;
  overflow: hidden;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: rgba(26, 27, 35, 0.95);
  box-sizing: border-box;
}

.select-dropdown-fixed {
  position: fixed;
  top: 0;
  left: 0;
  width: auto;
  max-width: none;
}

.search-container {
  padding: 0.75rem;
  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.05));
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 1rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
}

.search-input {
  width: 100%;
  padding: 0.4rem 0.4rem 0.4rem 2rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid transparent;
  border-radius: 4px;
  color: #fff;
  font-size: 0.9rem;
  outline: none;
  transition: all 0.2s;
}

.search-input:focus {
  border-color: rgba(79, 172, 254, 0.5);
  background: rgba(0, 0, 0, 0.3);
}

.options-list {
  max-height: 250px;
  overflow-y: auto;
  padding: 0.5rem 0;
  margin: 0;
  list-style: none;
}

.options-list::-webkit-scrollbar {
  width: 6px;
}
.options-list::-webkit-scrollbar-track {
  background: transparent;
}
.options-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
.options-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.select-option {
  padding: 0.6rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  color: var(--text-color, #e0e0e0);
  font-size: 0.95rem;
  transition: background-color 0.15s ease;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
  box-sizing: border-box;
}

.select-option > :first-child {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-option.is-highlighted {
  background-color: var(--surface-hover, rgba(255, 255, 255, 0.05));
}

.select-option.is-selected {
  color: var(--primary-color, #4facfe);
  font-weight: 500;
  background-color: rgba(79, 172, 254, 0.1);
}

.select-option.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background-color: transparent !important;
}
.select-option.is-disabled:hover {
  background-color: transparent !important;
}

.check-icon {
  color: var(--primary-color, #4facfe);
}

.no-options {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  font-size: 0.9rem;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
