import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { PlaceholderInfo, RequestData, ResolvedCommand } from "./types";

export function shellEscape(s: string): string {
  if (s.length === 0) return "''";
  // A value matching this class is handed to the login shell unquoted, so any character
  // the shell rewrites before the tool sees it must not be a member. SAFE-01 removed two:
  // the shell expands a leading ~ to $HOME, and reads a leading a=b as an environment
  // assignment rather than an operand — in both cases the tool receives something other
  // than the bytes the request carried. The rule that follows is that this list only ever
  // loses members: quoting a value that did not need quoting is harmless, so shrinking is
  // always safe while growing re-opens the boundary. Shrinking is free at exactly one of
  // the two call sites. The other is detector.ts:36, which runs an operator-authored
  // binary token through this same function, so a token written as ~/go/bin/nuclei is now
  // quoted, no longer tilde-expands, and detects as not installed.
  if (/^[a-zA-Z0-9._\-\/:@,+%]+$/.test(s)) {
    return s;
  }
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function buildFullUrl(data: RequestData): { scheme: string; fullUrl: string } {
  const scheme = data.tls ? "https" : "http";
  const defaultPort = data.tls ? 443 : 80;
  const portStr = data.port === defaultPort ? "" : `:${data.port}`;
  const queryStr = data.query ? `?${data.query}` : "";
  const fullUrl = `${scheme}://${data.host}${portStr}${data.path}${queryStr}`;
  return { scheme, fullUrl };
}

// Single-pass placeholder regex — prevents re-expansion of resolved values
const PLACEHOLDER_RE = /%[UHPAQMSCREBGD]/g;

export function resolvePlaceholders(
  template: string,
  data: RequestData
): ResolvedCommand {
  const { scheme, fullUrl } = buildFullUrl(data);
  const tempFiles: string[] = [];

  // Build file paths BEFORE substitution (only if template uses them)
  let rFile: string | undefined;
  let eFile: string | undefined;
  let bFile: string | undefined;

  if (template.includes("%R") || template.includes("%E") || template.includes("%B")) {
    const tmpDir = mkdtempSync(join(tmpdir(), "dispatch-"));

    // 0o600 — request data can contain cookies, bearer tokens, and raw bodies.
    // Restrict to the current user so other local accounts can't read.
    const fileOpts = { mode: 0o600 } as const;

    if (template.includes("%R")) {
      rFile = join(tmpDir, "request.raw");
      // Use binary-safe bytes to preserve non-UTF-8 content
      writeFileSync(rFile, data.rawRequestBytes, fileOpts);
      tempFiles.push(rFile);
    }
    if (template.includes("%E")) {
      eFile = join(tmpDir, "headers.txt");
      writeFileSync(eFile, data.headers, fileOpts);
      tempFiles.push(eFile);
    }
    if (template.includes("%B")) {
      bFile = join(tmpDir, "body.txt");
      // Use binary-safe bytes to preserve non-UTF-8 content
      writeFileSync(bFile, data.bodyBytes, fileOpts);
      tempFiles.push(bFile);
    }
  }

  // Build replacement map — all values shell-escaped
  const replacements: Record<string, string> = {
    "%U": shellEscape(fullUrl),
    "%H": shellEscape(data.host),
    "%P": String(data.port),
    "%A": shellEscape(data.path),
    "%Q": shellEscape(data.query),
    "%M": shellEscape(data.method),
    "%S": scheme,
    "%C": shellEscape(data.cookies),
    "%G": shellEscape(data.userAgent),
    "%D": shellEscape(data.rootDomain),
  };
  if (rFile) replacements["%R"] = shellEscape(rFile);
  if (eFile) replacements["%E"] = shellEscape(eFile);
  if (bFile) replacements["%B"] = shellEscape(bFile);

  // Single-pass replacement — no re-expansion possible
  let command = template.replace(PLACEHOLDER_RE, (match) => replacements[match] ?? match);

  return { command, tempFiles };
}

export function buildPlaceholderInfo(
  template: string,
  data: RequestData
): PlaceholderInfo[] {
  const { scheme, fullUrl } = buildFullUrl(data);

  // For the keys the replacement map above passes through shellEscape. Deriving
  // escaped from the same value argument is what keeps the legend and the resolved
  // command from drifting: there is no second copy of the quoting rules to fall
  // behind, and no row where escaped could be built from the wrong value.
  const buildEscapedEntry = (key: string, value: string): PlaceholderInfo => ({
    key,
    value,
    escaped: shellEscape(value),
    used: template.includes(key),
  });

  // For entries the resolved command does not quote. escaped === value here is a
  // claim, not an omission, so it gets its own constructor rather than a skipped
  // field; each caller below states which failure mode its exemption prevents.
  const buildVerbatimEntry = (key: string, value: string): PlaceholderInfo => ({
    key,
    value,
    escaped: value,
    used: template.includes(key),
  });

  return [
    buildEscapedEntry("%U", fullUrl),
    buildEscapedEntry("%H", data.host),
    // %P is interpolated bare by the replacement map, so showing it quoted would
    // have the legend claim quoting the command does not actually contain.
    buildVerbatimEntry("%P", String(data.port)),
    buildEscapedEntry("%A", data.path),
    buildEscapedEntry("%Q", data.query),
    buildEscapedEntry("%M", data.method),
    // %S is the other bare entry in the replacement map, exempt for the same reason
    // as %P: the legend must not report quoting that never happens.
    buildVerbatimEntry("%S", scheme),
    buildEscapedEntry("%C", data.cookies),
    buildEscapedEntry("%G", data.userAgent),
    buildEscapedEntry("%D", data.rootDomain),
    // The three file entries are descriptions, not paths. This function is pure and
    // writes no temp file, so no real path exists at legend-build time — escaping a
    // description would show the operator a quoted string that is not in any command.
    buildVerbatimEntry("%R", "<raw request file>"),
    buildVerbatimEntry("%E", "<headers file>"),
    buildVerbatimEntry("%B", "<body file>"),
  ];
}
