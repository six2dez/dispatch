// Build-time guard for Caido's plugin runtime.
//
// Caido runs backend plugins in a sandbox that exposes a *reduced* set of
// builtin modules. A named import of an export the sandbox does not provide
// does not degrade gracefully — it fails during module linking, before any
// plugin code runs:
//
//   Failed to start plugin <uuid>: Runtime error
//   Caused by:
//       0: Eval error
//       1: Could not find export 'existsSync' in module 'fs'
//
// Every API route then 500s and the frontend reports "failed load tools".
// That exact failure shipped in 0.4.1, so this check makes the class of bug
// impossible to ship: anything the bundle imports by name from a builtin must
// appear in the allowlist below, which lists only exports verified to exist in
// Caido's sandbox (the ones used by the shipping plugin, plus `platform`).
//
// Namespace imports (`import * as os from "os"`) are allowed for any module:
// those cannot fail to link, because a missing export is simply absent as a
// property and can be feature-detected at runtime.

import { readFileSync } from "fs";

const ALLOWED_NAMED_IMPORTS = {
  fs: ["writeFileSync", "mkdirSync", "readdirSync", "statSync", "rmSync"],
  os: ["tmpdir", "platform"],
  path: ["join", "dirname", "resolve", "basename"],
  crypto: ["randomBytes"],
  child_process: ["spawn"],
};

const BUNDLE_PATH = process.argv[2] ?? "dist/backend/script.js";

// `import { a, b as c } from "mod"` and `import mod, { a } from "mod"`
const NAMED_IMPORT = /import\s+(?:type\s+)?(?:[\w*\s{},$]+\s+from\s+)?"([^"]+)"/g;

function builtinName(specifier) {
  return specifier.replace(/^node:/, "");
}

function check() {
  const source = readFileSync(BUNDLE_PATH, "utf8");
  const violations = [];

  for (const match of source.matchAll(NAMED_IMPORT)) {
    const [, specifier] = match;
    const mod = builtinName(specifier);
    const allowed = ALLOWED_NAMED_IMPORTS[mod];
    // Not a builtin we know about (e.g. a bundled dependency) — skip.
    if (allowed === undefined) continue;

    const clause = match[0];
    const namedClause = clause.match(/\{([^}]*)\}/);
    if (namedClause === null) continue; // default or namespace import: safe

    const names = namedClause[1]
      .split(",")
      .map((entry) => entry.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter(Boolean);

    for (const name of names) {
      if (!allowed.includes(name)) {
        violations.push(`${name} from "${specifier}"`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Runtime import check failed for ${BUNDLE_PATH}:\n` +
        violations.map((v) => `  - ${v}`).join("\n") +
        `\n\nCaido's plugin runtime may not provide these exports, and a missing ` +
        `named import fails the whole backend at link time. Add the export to the ` +
        `sandbox (after verifying it works there) or use a namespace import with a ` +
        `runtime feature check instead.`
    );
    process.exit(1);
  }

  console.log(`Runtime import check passed for ${BUNDLE_PATH}`);
}

check();
