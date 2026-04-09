<script setup lang="ts">
import { ref } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import { useSdk } from "../composables/useSdk";
import { getErrorMessage } from "../utils/errors";

const sdk = useSdk();

const visible = ref(false);
const command = ref("");
const currentRequestIds = ref<string[]>([]);
const running = ref(false);

function open(ids: string[]): void {
  currentRequestIds.value = ids;
  command.value = "";
  visible.value = true;
}

async function run(): Promise<void> {
  const cmd = command.value.trim();
  if (cmd.length === 0 || running.value) return;

  const requestIds = [...new Set(currentRequestIds.value)];
  running.value = true;

  try {
    const results = await Promise.allSettled(
      requestIds.map(async (requestId) => {
        await sdk.backend.executeCustom(requestId, cmd);
        return requestId;
      })
    );

    const started = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const firstError = failed[0]?.reason;

    if (started === 0) {
      sdk.window.showToast(`Custom command failed: ${getErrorMessage(firstError, "Could not start any commands")}`, {
        variant: "error",
        duration: 5000,
      });
      return;
    }

    visible.value = false;
    sdk.navigation.goTo("/dispatch");

    if (failed.length === 0) {
      sdk.window.showToast(
        started === 1 ? "Started custom command" : `Started ${started} custom commands`,
        { variant: "success", duration: 2000 }
      );
      return;
    }

    sdk.window.showToast(
      `Started ${started} custom commands, ${failed.length} failed to start: ${getErrorMessage(firstError, "unknown error")}`,
      { variant: "warning", duration: 5000 }
    );
  } finally {
    running.value = false;
  }
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
      auto-resize
      class="custom-textarea"
      autofocus
    />
    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        text
        @click="visible = false"
      />
      <Button
        label="Run"
        severity="primary"
        :loading="running"
        @click="run"
      />
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
