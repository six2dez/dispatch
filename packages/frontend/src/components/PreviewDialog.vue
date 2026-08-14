<script setup lang="ts">
import { ref, computed } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import type { ToolConfig, PlaceholderPreview } from "dispatch-backend";
import { useSdk } from "../composables/useSdk";
import { useOverlayHost } from "../composables/useOverlayHost";
import { getErrorMessage } from "../utils/errors";

const sdk = useSdk();
const overlayHost = useOverlayHost();

const visible = ref(false);
const tool = ref<ToolConfig>();
const preview = ref<PlaceholderPreview>();
const editedCommand = ref("");
const currentRequestIds = ref<string[]>([]);

function open(
  t: ToolConfig,
  p: PlaceholderPreview,
  ids: string[]
): void {
  tool.value = t;
  preview.value = p;
  currentRequestIds.value = ids;
  editedCommand.value = ids.length > 1 ? p.template : p.resolvedCommand;
  visible.value = true;
}

function run(): void {
  const t = tool.value;
  const ids = currentRequestIds.value;
  const cmd = editedCommand.value.trim();
  if (!t || ids.length === 0 || cmd.length === 0) return;

  visible.value = false;
  const promise = ids.length === 1
    ? sdk.backend.executeCommand(ids[0]!, t.id, cmd)
    : sdk.backend.executeBatch(ids, t.id, cmd);

  promise
    .then(() => sdk.navigation.goTo("/dispatch"))
    .catch((err: unknown) => {
      sdk.window.showToast(`Execute failed: ${getErrorMessage(err, "Could not start the command")}`, {
        variant: "error",
        duration: 5000,
      });
    });
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(editedCommand.value);
    sdk.window.showToast("Copied to clipboard", { variant: "success", duration: 1500 });
  } catch (err: unknown) {
    sdk.window.showToast(`Copy failed: ${getErrorMessage(err, "Could not copy the command")}`, {
      variant: "error",
      duration: 3000,
    });
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    run();
  }
}

// Each row answers two operator questions: what the request carried, and what the
// shell will actually receive. `quoted` is false for the common allowlist-clean
// value, where the two strings are identical and a second rendering would be noise.
const usedPlaceholders = computed((): { key: string; value: string; escaped: string; quoted: boolean }[] => {
  if (!preview.value) return [];
  return preview.value.placeholders
    .filter((p) => p.used)
    // For %R, %E and %B this flag is always false. That is the documented exception
    // on PlaceholderInfo, not a statement that those paths reach the shell unquoted:
    // the legend is built without writing the files, so it has no path to escape.
    .map((p) => ({ key: p.key, value: p.value, escaped: p.escaped, quoted: p.escaped !== p.value }));
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
    :header="`Preview: ${tool?.name ?? ''}`"
    :style="{ width: '800px', maxWidth: '90vw' }"
    @keydown="handleKeydown"
  >
    <div
      v-if="currentRequestIds.length > 1"
      class="preview-multi-note"
    >
      This command will run for {{ currentRequestIds.length }} requests. Edits apply to all.
      Request-specific values (%U, %H, %R, etc.) will be re-resolved per request.
    </div>

    <Textarea
      v-model="editedCommand"
      rows="6"
      class="preview-command"
    />

    <div
      v-if="currentRequestIds.length > 1 && preview"
      class="preview-reference"
    >
      <div class="preview-ref-label">
        Preview (1st request):
      </div>
      <div class="preview-ref-cmd">
        {{ preview.resolvedCommand }}
      </div>
    </div>

    <details
      v-if="usedPlaceholders.length > 0"
      class="preview-placeholders"
    >
      <summary>Placeholders ({{ usedPlaceholders.length }})</summary>
      <table class="preview-ph-table">
        <tr
          v-for="ph in usedPlaceholders"
          :key="ph.key"
        >
          <td class="ph-key">
            {{ ph.key }}
          </td>
          <td class="ph-value">
            {{ ph.value }}
            <!-- Only when quoting was applied: the command above contains this
                 string, not the raw one, and the operator is approving that. -->
            <span
              v-if="ph.quoted"
              class="ph-escaped"
            >shell receives {{ ph.escaped }}</span>
          </td>
        </tr>
      </table>
    </details>

    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        text
        @click="visible = false"
      />
      <Button
        label="Copy"
        severity="secondary"
        outlined
        @click="copy"
      />
      <Button
        label="Run"
        severity="primary"
        @click="run"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.preview-multi-note {
  padding: 8px 0;
  font-size: 11px;
  color: #f59e0b;
}

.preview-command {
  width: 100%;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 13px;
  word-break: break-word;
  white-space: pre-wrap;
}

.preview-reference {
  margin-top: 8px;
  padding: 8px;
  font-size: 11px;
  color: var(--c-fg-subtle, #888);
  background: var(--c-bg-subtle, #1a1a1a);
  border-radius: 4px;
  font-family: monospace;
  word-break: break-all;
}

.preview-ref-label {
  margin-bottom: 4px;
  font-weight: 600;
}

.preview-placeholders {
  margin-top: 12px;
}

.preview-placeholders summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--c-fg-subtle, #999);
}

.preview-ph-table {
  width: 100%;
  font-size: 12px;
  border-collapse: collapse;
  margin-top: 4px;
}

.ph-key {
  font-family: monospace;
  font-weight: 600;
  width: 40px;
  padding: 3px 8px;
  color: var(--c-primary, #818cf8);
}

.ph-value {
  word-break: break-all;
  padding: 3px 8px;
  color: var(--c-fg-subtle, #aaa);
}

/* Rendered only where the escaped form differs, and deliberately less muted than
   .ph-value: the raw value is context, the quoted form is what the command the
   operator is about to approve actually contains. */
.ph-escaped {
  display: block;
  margin-top: 2px;
  font-family: monospace;
  color: var(--c-fg-default, #e0e0e0);
}
</style>
