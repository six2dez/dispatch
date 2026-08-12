<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import type { ToolConfig } from "dispatch-backend";
import { useSdk } from "../composables/useSdk";
import { useOverlayHost } from "../composables/useOverlayHost";
import { useToolCatalog } from "../composables/useToolCatalog";
import { useDetection } from "../composables/useDetection";
import { getErrorMessage } from "../utils/errors";

const sdk = useSdk();
const overlayHost = useOverlayHost();
const { enabledTools, refreshToolCatalog } = useToolCatalog();
const { refreshDetection, isToolInstalled, shouldRefresh } = useDetection();

const visible = ref(false);
const searchQuery = ref("");
const requestIds = ref<string[]>([]);
const selectedIndex = ref(0);
const searchEl = ref<HTMLInputElement>();
const loading = ref(false);
const loadError = ref("");
let openSequence = 0;

const emit = defineEmits<{
  "tool-selected": [tool: ToolConfig, requestIds: string[]];
  "custom-command": [requestIds: string[]];
}>();

function open(ids: string[]): void {
  requestIds.value = ids;
  searchQuery.value = "";
  selectedIndex.value = 0;
  visible.value = true;
  loadError.value = "";

  const sequence = ++openSequence;

  void (async () => {
    loading.value = true;

    try {
      if (enabledTools.value.length === 0) {
        await refreshToolCatalog(sdk);
      }

      if (sequence !== openSequence || !visible.value) return;

      if (shouldRefresh()) {
        await refreshDetection(sdk, true);
      }
    } catch (err: unknown) {
      if (sequence !== openSequence || !visible.value) return;

      loadError.value = getErrorMessage(err, "Could not load tools");
      sdk.window.showToast(`Failed to open picker: ${loadError.value}`, {
        variant: "error",
        duration: 5000,
      });
    } finally {
      if (sequence === openSequence) {
        loading.value = false;
      }
    }
  })();

  nextTick(() => searchEl.value?.focus());
}

const filteredTools = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (q.length === 0) return enabledTools.value;
  return enabledTools.value.filter(
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
  if (loading.value) return;
  visible.value = false;
  emit("tool-selected", tool, requestIds.value);
}

function openCustom(): void {
  visible.value = false;
  emit("custom-command", requestIds.value);
}

function handleKeydown(e: KeyboardEvent): void {
  if (loading.value) return;
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

watch(visible, (isVisible) => {
  if (isVisible) return;
  openSequence++;
  loading.value = false;
  loadError.value = "";
});

defineExpose({ open });
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :closable="true"
    :draggable="false"
    :append-to="overlayHost"
    :style="{ width: '440px', maxWidth: '95vw' }"
    :pt="{ content: { style: 'padding: 0' } }"
    @keydown="handleKeydown"
  >
    <template #header>
      <span
        v-if="requestIds.length > 1"
        class="picker-count"
      >
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
      <div
        v-if="loading"
        class="picker-empty"
      >
        Loading tools...
      </div>
      <div
        v-else-if="loadError.length > 0"
        class="picker-empty"
      >
        {{ loadError }}
      </div>
      <div
        v-else-if="filteredTools.length === 0 && searchQuery.length === 0"
        class="picker-empty"
      >
        No enabled tools yet. Add one in Settings or enable an existing preset.
      </div>
      <template
        v-for="[groupName, groupTools] of grouped"
        :key="groupName"
      >
        <div class="picker-group-header">
          {{ groupName }}
        </div>
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
          >
            &#x2713;
          </span>
          <span
            v-else-if="isToolInstalled(tool.id) === false"
            class="picker-status picker-missing"
          >
            &#x2717;
          </span>
        </div>
      </template>

      <div
        v-if="!loading && loadError.length === 0 && filteredTools.length === 0 && searchQuery.length > 0"
        class="picker-empty"
      >
        No tools match your search.
      </div>
    </div>

    <div
      class="picker-custom"
      @click="openCustom"
    >
      Custom command...
    </div>
  </Dialog>
</template>

<style scoped>
/*
 * Note: the Dialog's own root and content elements are styled through props
 * (:style / :pt above), not from here. Scoped CSS cannot reach them — Vue does
 * not carry this component's data-v attribute onto a child component's root
 * when that root is teleported, so a `.picker-dialog[data-v-…]` rule would
 * never match. Slot content like the rules below is unaffected.
 */
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
