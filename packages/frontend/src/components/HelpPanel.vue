<script setup lang="ts">
// Static help content — no backend calls needed
</script>

<template>
  <div class="help-panel">
    <section class="help-section">
      <h2 class="help-heading">
        Quick Start
      </h2>
      <ol class="help-steps">
        <li>Right-click on a request row (or multiple) in the HTTP history</li>
        <li>Click <strong>Dispatch...</strong> and pick a tool from the list</li>
        <li>Review the resolved command in the preview, edit if needed, then hit <strong>Run</strong></li>
      </ol>
      <p class="help-note">
        Output streams in real-time in the <strong>Terminal</strong> tab.
        You can kill a running process with the Kill button, and multi-request batches show live progress while they run.
      </p>
    </section>

    <section class="help-section">
      <h2 class="help-heading">
        Placeholders
      </h2>
      <p class="help-note">
        Use these in command templates. They are resolved per-request before execution.
      </p>
      <table class="help-table">
        <thead>
          <tr><th>Placeholder</th><th>Description</th><th>Example</th></tr>
        </thead>
        <tbody>
          <tr><td><code>%U</code></td><td>Full URL</td><td><code>https://target.com/api/users?id=1</code></td></tr>
          <tr><td><code>%H</code></td><td>Host</td><td><code>target.com</code></td></tr>
          <tr><td><code>%P</code></td><td>Port</td><td><code>443</code></td></tr>
          <tr><td><code>%A</code></td><td>Path (without query)</td><td><code>/api/users</code></td></tr>
          <tr><td><code>%Q</code></td><td>Query string (without ?)</td><td><code>id=1&amp;name=test</code></td></tr>
          <tr><td><code>%M</code></td><td>HTTP method</td><td><code>POST</code></td></tr>
          <tr><td><code>%S</code></td><td>Scheme</td><td><code>https</code></td></tr>
          <tr><td><code>%C</code></td><td>Cookies (Cookie header value)</td><td><code>session=abc123</code></td></tr>
          <tr><td><code>%G</code></td><td>User-Agent header value</td><td><code>Mozilla/5.0 ...</code></td></tr>
          <tr><td><code>%D</code></td><td>Root domain</td><td><code>example.co.uk</code></td></tr>
          <tr><td><code>%R</code></td><td>Temp file with raw request</td><td><code>/tmp/dispatch-xxx/request.raw</code></td></tr>
          <tr><td><code>%E</code></td><td>Temp file with headers</td><td><code>/tmp/dispatch-xxx/headers.txt</code></td></tr>
          <tr><td><code>%B</code></td><td>Temp file with body</td><td><code>/tmp/dispatch-xxx/body.txt</code></td></tr>
        </tbody>
      </table>
      <p class="help-note">
        File placeholders (<code>%R</code>, <code>%E</code>, <code>%B</code>) only create temp files when used.
        Files are cleaned up after execution.
      </p>
    </section>

    <section class="help-section">
      <h2 class="help-heading">
        Keyboard Shortcuts
      </h2>
      <table class="help-table">
        <thead>
          <tr><th>Context</th><th>Key</th><th>Action</th></tr>
        </thead>
        <tbody>
          <tr><td>Picker</td><td><kbd>&uarr;</kbd> / <kbd>&darr;</kbd></td><td>Navigate tools</td></tr>
          <tr><td>Picker</td><td><kbd>Enter</kbd></td><td>Select tool</td></tr>
          <tr><td>Picker</td><td><kbd>Esc</kbd></td><td>Close picker</td></tr>
          <tr><td>Picker</td><td>Type</td><td>Filter tools by name or group</td></tr>
          <tr><td>Preview</td><td><kbd>Cmd+Enter</kbd></td><td>Run command</td></tr>
          <tr><td>Preview</td><td><kbd>Esc</kbd></td><td>Cancel</td></tr>
          <tr><td>Terminal</td><td>Click command</td><td>Copy to clipboard</td></tr>
        </tbody>
      </table>
    </section>

    <section class="help-section">
      <h2 class="help-heading">
        Creating Custom Tools
      </h2>
      <p class="help-note">
        Go to <strong>Settings</strong> &rarr; <strong>Add Tool</strong>:
      </p>
      <ul class="help-list">
        <li><strong>Name</strong> &mdash; displayed in the picker</li>
        <li><strong>Command</strong> &mdash; template with placeholders</li>
        <li><strong>Group</strong> &mdash; category for grouping</li>
        <li><strong>Show preview</strong> &mdash; show resolved command before running</li>
      </ul>
      <p class="help-note">
        Quick-dispatch entries update automatically after you add, edit, disable, or delete a tool in Settings.
      </p>
    </section>

    <section class="help-section">
      <h2 class="help-heading">
        Multi-select
      </h2>
      <p class="help-note">
        Select multiple request rows before clicking <strong>Dispatch...</strong>.
        The tool runs once per request, sequentially. The preview shows the first request;
        edits to flags apply to all, but request-specific placeholders are re-resolved for each. Completed runs also appear in
        <strong>History</strong> automatically as they finish.
      </p>
    </section>
  </div>
</template>

<style scoped>
.help-panel {
  max-width: 750px;
  line-height: 1.6;
}

.help-section {
  margin-bottom: 24px;
}

.help-heading {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--c-border-default, #333);
}

.help-note {
  font-size: 12px;
  color: var(--c-fg-subtle, #999);
  margin: 6px 0;
}

.help-steps, .help-list {
  margin: 4px 0;
  padding-left: 20px;
  font-size: 13px;
}

.help-steps li { margin-bottom: 4px; }
.help-list li { margin-bottom: 2px; }

.help-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 8px 0;
}

.help-table th {
  text-align: left;
  padding: 5px 10px;
  border-bottom: 2px solid var(--c-border-default, #333);
  color: var(--c-fg-subtle, #999);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.help-table td {
  padding: 4px 10px;
  border-bottom: 1px solid var(--c-bg-subtle, #222);
  vertical-align: top;
}

.help-table code {
  background: var(--c-bg-default, #111);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  color: var(--c-primary, #818cf8);
}

.help-table kbd {
  background: var(--c-bg-subtle, #1a1a1a);
  border: 1px solid var(--c-border-default, #444);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: monospace;
  font-size: 11px;
}
</style>
