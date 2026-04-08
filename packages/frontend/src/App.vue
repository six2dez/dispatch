<script setup lang="ts">
import { ref, onMounted } from "vue";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import TerminalPanel from "./components/TerminalPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import HistoryPanel from "./components/HistoryPanel.vue";
import HelpPanel from "./components/HelpPanel.vue";
import ToolPickerDialog from "./components/ToolPickerDialog.vue";
import PreviewDialog from "./components/PreviewDialog.vue";
import CustomCommandDialog from "./components/CustomCommandDialog.vue";
import type { ToolConfig, PlaceholderPreview } from "dispatch-backend";
import { useSdk } from "./composables/useSdk";

type StorageData = { activeTab?: string };

const sdk = useSdk();
const activeTab = ref("terminal");

// Restore persisted tab
onMounted(async () => {
  const stored = await sdk.storage.get() as StorageData | undefined;
  if (stored?.activeTab) {
    activeTab.value = stored.activeTab;
  }
});

function onTabChange(value: string | number): void {
  activeTab.value = String(value);
  sdk.storage.set({ activeTab: activeTab.value } as StorageData);
}

const pickerDialog = ref<InstanceType<typeof ToolPickerDialog>>();
const previewDialog = ref<InstanceType<typeof PreviewDialog>>();
const customDialog = ref<InstanceType<typeof CustomCommandDialog>>();

// Exposed to index.ts so the command handler can open the picker
function openPicker(ids: string[]): void {
  pickerDialog.value?.open(ids);
}

// When a tool is selected from the picker
function handleToolSelected(tool: ToolConfig, requestIds: string[]): void {
  if (tool.showPreview && requestIds.length > 0) {
    sdk.backend
      .resolvePreview(requestIds[0]!, tool.id)
      .then((preview: PlaceholderPreview) => {
        previewDialog.value?.open(tool, preview, requestIds);
      })
      .catch((err: unknown) => {
        sdk.window.showToast(`Preview failed: ${err}`, { variant: "error", duration: 5000 });
      });
  } else {
    // Execute directly without preview
    const promise = requestIds.length === 1
      ? sdk.backend.executeCommand(requestIds[0]!, tool.id)
      : sdk.backend.executeBatch(requestIds, tool.id);

    promise
      .then(() => sdk.navigation.goTo("/dispatch"))
      .catch((err: unknown) => {
        sdk.window.showToast(`Execute failed: ${err}`, { variant: "error", duration: 5000 });
      });
  }
}

// When custom command is requested from the picker
function handleCustomCommand(requestIds: string[]): void {
  customDialog.value?.open(requestIds);
}

// Direct dispatch for per-tool context menu entries
function dispatchTool(tool: ToolConfig, requestIds: string[]): void {
  handleToolSelected(tool, requestIds);
}

defineExpose({ openPicker, dispatchTool });
</script>

<template>
  <div class="dispatch-app">
    <Tabs :value="activeTab" class="dispatch-tabs" @update:value="onTabChange">
      <TabList>
        <Tab value="terminal">Terminal</Tab>
        <Tab value="settings">Settings</Tab>
        <Tab value="history">History</Tab>
        <Tab value="help">Help</Tab>
      </TabList>
      <TabPanels class="dispatch-panels">
        <TabPanel value="terminal" class="dispatch-panel">
          <TerminalPanel />
        </TabPanel>
        <TabPanel value="settings" class="dispatch-panel">
          <SettingsPanel />
        </TabPanel>
        <TabPanel value="history" class="dispatch-panel">
          <HistoryPanel />
        </TabPanel>
        <TabPanel value="help" class="dispatch-panel">
          <HelpPanel />
        </TabPanel>
      </TabPanels>
    </Tabs>

    <!-- Modal dialogs — mounted outside tabs so they overlay everything -->
    <ToolPickerDialog
      ref="pickerDialog"
      @tool-selected="handleToolSelected"
      @custom-command="handleCustomCommand"
    />
    <PreviewDialog ref="previewDialog" />
    <CustomCommandDialog ref="customDialog" />
  </div>
</template>

<style scoped>
.dispatch-app {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-default, #1e1e1e);
  color: var(--c-fg-default, #e0e0e0);
}

.dispatch-tabs {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.dispatch-panels {
  flex: 1;
  overflow: hidden;
}

.dispatch-panel {
  height: 100%;
  overflow: auto;
  padding: 12px;
}
</style>
