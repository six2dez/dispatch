<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import type { ToolConfig } from "dispatch-backend";
import { useSdk } from "../composables/useSdk";
import { useDetection } from "../composables/useDetection";

const sdk = useSdk();
const { setDetectionResults, isToolInstalled, shouldRefresh } = useDetection();

const visible = ref(false);
const searchQuery = ref("");
const tools = ref<ToolConfig[]>([]);
const requestIds = ref<string[]>([]);
const selectedIndex = ref(0);
const searchEl = ref<HTMLInputElement>();

const emit = defineEmits<{
  "tool-selected": [tool: ToolConfig, requestIds: string[]];
  "custom-command": [requestIds: string[]];
}>();

function open(ids: string[]): void {
  requestIds.value = ids;
  searchQuery.value = "";
  selectedIndex.value = 0;
  visible.value = true;

  sdk.backend.getTools().then((allTools) => {
    tools.value = allTools.filter((t) => t.enabled);
    if (shouldRefresh()) {
      sdk.backend.detectTools().then((detection) => {
        setDetectionResults(detection.byToolId);
      });
    }
  });

  nextTick(() => searchEl.value?.focus());
}

const filteredTools = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (q.length === 0) return tools.value;
  return tools.value.filter(
    (t) => t.name.toLowerCase().includes(q) || t.group.toLowerCase().includes(q)
  );
});

const grouped = computed(() => {
  const groups = new Map<string, ToolConfig[]>();
  for (const tool of filteredTools.value) {
    const group = tool.group || "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(tool);
  }
  return groups;
});

// Index map for O(1) selected-state lookup in the template
const toolIndexMap = computed(() => {
  const map = new Map<string, number>();
  filteredTools.value.forEach((t, i) => map.set(t.id, i));
  return map;
});

function selectTool(tool: ToolConfig): void {
  visible.value = false;
  emit("tool-selected", tool, requestIds.value);
}

function openCustom(): void {
  visible.value = false;
  emit("custom-command", requestIds.value);
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (filteredTools.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % filteredTools.value.length;
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (filteredTools.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + filteredTools.value.length) % filteredTools.value.length;
    }
  } else if (e.key === "Enter") {
    e.preventDefault();
    const tool = filteredTools.value[selectedIndex.value];
    if (tool) selectTool(tool);
  }
}

watch(searchQuery, () => {
  selectedIndex.value = 0;
});

defineExpose({ open });
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :closable="true"
    :draggable="false"
    :pt="{ root: { class: 'picker-dialog' }, content: { class: 'picker-content' } }"
    @keydown="handleKeydown"
  >
    <template #header>
      <span v-if="requestIds.length > 1" class="picker-count">
        {{ requestIds.length }} requests selected
      </span>
      <span v-else>Dispatch...</span>
    </template>

    <InputText
      ref="searchEl"
      v-model="searchQuery"
      placeholder="Search tools..."
      class="picker-search"
      autofocus
    />

    <div class="picker-list">
      <template v-for="[groupName, groupTools] of grouped" :key="groupName">
        <div class="picker-group-header">{{ groupName }}</div>
        <div
          v-for="tool of groupTools"
          :key="tool.id"
          class="picker-item"
          :class="{ selected: toolIndexMap.get(tool.id) === selectedIndex }"
          @click="selectTool(tool)"
        >
          <span class="picker-item-name">{{ tool.name }}</span>
          <span
            v-if="isToolInstalled(tool.id) === true"
            class="picker-status picker-installed"
          >&#x2713;</span>
          <span
            v-else-if="isToolInstalled(tool.id) === false"
            class="picker-status picker-missing"
          >&#x2717;</span>
        </div>
      </template>

      <div v-if="filteredTools.length === 0 && searchQuery.length > 0" class="picker-empty">
        No tools match your search.
      </div>
    </div>

    <div class="picker-custom" @click="openCustom">
      Custom command...
    </div>
  </Dialog>
</template>

<style scoped>
.picker-dialog {
  width: 440px;
  max-width: 95vw;
}

.picker-content {
  padding: 0 !important;
}

.picker-count {
  font-size: 12px;
  color: var(--c-fg-subtle, #999);
}

.picker-search {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--c-border-default, #333);
  border-radius: 0;
  font-size: 14px;
}

.picker-list {
  max-height: 50vh;
  overflow-y: auto;
}

.picker-group-header {
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--c-fg-subtle, #888);
  background: var(--c-bg-subtle, #1a1a1a);
  border-top: 1px solid var(--c-border-default, #333);
}

.picker-group-header:first-child {
  border-top: none;
}

.picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px 8px 24px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.1s;
}

.picker-item:hover,
.picker-item.selected {
  background: var(--c-primary, #6366f1);
  color: #fff;
}

.picker-item-name {
  flex: 1;
}

.picker-status {
  font-size: 11px;
  margin-left: 8px;
}

.picker-installed { color: #22c55e; }
.picker-missing { color: var(--c-fg-subtle, #666); }

.picker-empty {
  padding: 12px 14px;
  color: var(--c-fg-subtle, #666);
  font-style: italic;
  font-size: 13px;
}

.picker-custom {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  border-top: 1px solid var(--c-border-default, #333);
  color: var(--c-fg-subtle, #999);
  transition: background 0.1s;
}

.picker-custom:hover {
  background: var(--c-bg-subtle, #1a1a1a);
  color: var(--c-fg-default, #e0e0e0);
}
</style>
