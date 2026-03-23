export function createHelpPanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "dispatch-panel dispatch-help";

  panel.innerHTML = `
    <section class="dispatch-help-section">
      <h2 class="dispatch-help-heading">Quick Start</h2>
      <ol class="dispatch-help-steps">
        <li>Right-click on a request row (or multiple) in the HTTP history</li>
        <li>Click <strong>Dispatch...</strong> and pick a tool from the list</li>
        <li>Review the resolved command in the preview, edit if needed, then hit <strong>Run</strong></li>
      </ol>
      <p class="dispatch-help-note">Output streams in real-time in the <strong>Terminal</strong> tab. You can kill a running process with the Kill button.</p>
    </section>

    <section class="dispatch-help-section">
      <h2 class="dispatch-help-heading">Placeholders</h2>
      <p class="dispatch-help-note">Use these in command templates. They are resolved per-request before execution.</p>
      <table class="dispatch-help-table">
        <thead>
          <tr><th>Placeholder</th><th>Description</th><th>Example</th></tr>
        </thead>
        <tbody>
          <tr><td><code>%U</code></td><td>Full URL (scheme://host:port/path?query)</td><td><code>https://target.com/api/users?id=1</code></td></tr>
          <tr><td><code>%H</code></td><td>Host</td><td><code>target.com</code></td></tr>
          <tr><td><code>%P</code></td><td>Port</td><td><code>443</code></td></tr>
          <tr><td><code>%A</code></td><td>Path (without query string)</td><td><code>/api/users</code></td></tr>
          <tr><td><code>%Q</code></td><td>Query string (without leading ?)</td><td><code>id=1&amp;name=test</code></td></tr>
          <tr><td><code>%M</code></td><td>HTTP method</td><td><code>POST</code></td></tr>
          <tr><td><code>%S</code></td><td>Scheme</td><td><code>https</code></td></tr>
          <tr><td><code>%C</code></td><td>Cookies (value of Cookie header)</td><td><code>session=abc123; token=xyz</code></td></tr>
          <tr><td><code>%G</code></td><td>User-Agent header value</td><td><code>Mozilla/5.0 (Windows NT 10.0; ...)</code></td></tr>
          <tr><td><code>%D</code></td><td>Root/registrable domain</td><td><code>example.co.uk</code></td></tr>
          <tr><td><code>%R</code></td><td>Temp file with full raw request</td><td><code>/tmp/dispatch-xxx/request.raw</code></td></tr>
          <tr><td><code>%E</code></td><td>Temp file with request headers</td><td><code>/tmp/dispatch-xxx/headers.txt</code></td></tr>
          <tr><td><code>%B</code></td><td>Temp file with request body</td><td><code>/tmp/dispatch-xxx/body.txt</code></td></tr>
        </tbody>
      </table>
      <p class="dispatch-help-note">File placeholders (<code>%R</code>, <code>%E</code>, <code>%B</code>) only create temp files when used. Files are cleaned up after execution.</p>
    </section>

    <section class="dispatch-help-section">
      <h2 class="dispatch-help-heading">Keyboard Shortcuts</h2>
      <table class="dispatch-help-table dispatch-help-table-compact">
        <thead>
          <tr><th>Context</th><th>Key</th><th>Action</th></tr>
        </thead>
        <tbody>
          <tr><td>Picker</td><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Navigate tools</td></tr>
          <tr><td>Picker</td><td><kbd>Enter</kbd></td><td>Select tool</td></tr>
          <tr><td>Picker</td><td><kbd>Esc</kbd></td><td>Close picker</td></tr>
          <tr><td>Picker</td><td>Type</td><td>Filter tools by name or group</td></tr>
          <tr><td>Preview</td><td><kbd>Cmd+Enter</kbd></td><td>Run command</td></tr>
          <tr><td>Preview</td><td><kbd>Esc</kbd></td><td>Cancel</td></tr>
          <tr><td>Terminal</td><td>Click command</td><td>Copy to clipboard</td></tr>
        </tbody>
      </table>
    </section>

    <section class="dispatch-help-section">
      <h2 class="dispatch-help-heading">Creating Custom Tools</h2>
      <p class="dispatch-help-note">Go to the <strong>Settings</strong> tab and click <strong>Add Tool</strong>. Fill in:</p>
      <ul class="dispatch-help-list">
        <li><strong>Name</strong> &mdash; displayed in the picker</li>
        <li><strong>Command</strong> &mdash; template with placeholders (see table above)</li>
        <li><strong>Group</strong> &mdash; category for grouping in the picker (see below)</li>
        <li><strong>Show preview</strong> &mdash; show resolved command before running (recommended)</li>
      </ul>
      <h3 class="dispatch-help-subheading">Categories</h3>
      <ul class="dispatch-help-list">
        <li>Type any group name &mdash; if it doesn&rsquo;t exist, a new category is created automatically</li>
        <li>A category disappears when all its tools are removed or moved to another group</li>
        <li>To rename a category, edit each tool in it and change the Group field</li>
      </ul>
      <h3 class="dispatch-help-subheading">Tool Detection</h3>
      <ul class="dispatch-help-list">
        <li><strong style="color:var(--dispatch-success)">✓</strong> green &mdash; tool is installed (found via <code>which</code>)</li>
        <li><strong style="color:var(--c-fg-subtle, #666)">✗</strong> gray &mdash; tool not found in PATH</li>
        <li>Indicators appear in both the picker and the <strong>Settings</strong> tab</li>
        <li>Click <strong>Detect Tools</strong> in Settings to refresh, or detection runs automatically when the picker opens</li>
        <li>Tools marked <strong style="color:var(--c-fg-subtle, #666)">✗</strong> are still selectable &mdash; the indicator is informational only</li>
      </ul>
      <h3 class="dispatch-help-subheading">Example commands</h3>
      <table class="dispatch-help-table">
        <thead>
          <tr><th>Use case</th><th>Command template</th></tr>
        </thead>
        <tbody>
          <tr><td>SQL injection scan</td><td><code>sqlmap -u %U --batch</code></td></tr>
          <tr><td>Replay with request file</td><td><code>sqlmap -r %R --batch</code></td></tr>
          <tr><td>Directory fuzzing</td><td><code>ffuf -u %S://%H%A/FUZZ -w wordlist.txt</code></td></tr>
          <tr><td>Pipe to another tool</td><td><code>echo %U | httpx -silent -tech-detect</code></td></tr>
          <tr><td>SSL check</td><td><code>sslscan %H:%P</code></td></tr>
        </tbody>
      </table>
      <p class="dispatch-help-note">All values are shell-escaped automatically. Commands run with <code>shell: true</code>, so pipes and chaining work.</p>
    </section>

    <section class="dispatch-help-section">
      <h2 class="dispatch-help-heading">Multi-select</h2>
      <p class="dispatch-help-note">Select multiple request rows before clicking <strong>Dispatch...</strong>. The tool runs once per request, sequentially. The preview shows the first request; edits to flags apply to all, but request-specific placeholders are re-resolved for each.</p>
    </section>
  `;

  return panel;
}
