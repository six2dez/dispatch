<script setup lang="ts">
import { ref } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import { useSdk } from "../composables/useSdk";

const sdk = useSdk();

const visible = ref(false);
const command = ref("");
const currentRequestIds = ref<string[]>([]);

function open(ids: string[]): void {
  currentRequestIds.value = ids;
  command.value = "";
  visible.value = true;
}

async function run(): Promise<void> {
  const cmd = command.value.trim();
  if (cmd.length === 0) return;
  visible.value = false;

  for (const requestId of currentRequestIds.value) {
    try {
      await sdk.backend.executeCustom(requestId, cmd);
    } catch (err: unknown) {
      sdk.window.showToast(`Custom command failed: ${err}`, { variant: "error", duration: 5000 });
    }
  }

  sdk.navigation.goTo("/dispatch");
}

defineExpose({ open });
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="Custom Command"
    :style="{ width: '600px', maxWidth: '95vw' }"
  >
    <Textarea
      v-model="command"
      placeholder="Enter command template... (use %U, %H, %R, etc.)"
      rows="4"
      autoResize
      class="custom-textarea"
      autofocus
    />
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button label="Run" severity="primary" @click="run" />
    </template>
  </Dialog>
</template>

<style scoped>
.custom-textarea {
  width: 100%;
  font-family: monospace;
  font-size: 13px;
}
</style>
