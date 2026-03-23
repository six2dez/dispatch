import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { RequestData, ResolvedCommand } from "./types";

export function shellEscape(s: string): string {
  if (s.length === 0) return "''";
  // Only quote if the value contains shell-special characters
  if (/^[a-zA-Z0-9._\-\/:@=,+%~]+$/.test(s)) {
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

    if (template.includes("%R")) {
      rFile = join(tmpDir, "request.raw");
      writeFileSync(rFile, data.rawRequest);
      tempFiles.push(rFile);
    }
    if (template.includes("%E")) {
      eFile = join(tmpDir, "headers.txt");
      writeFileSync(eFile, data.headers);
      tempFiles.push(eFile);
    }
    if (template.includes("%B")) {
      bFile = join(tmpDir, "body.txt");
      writeFileSync(bFile, data.body);
      tempFiles.push(bFile);
    }
  }

  // Build replacement map — all values shell-escaped
  const replacements: Record<string, string> = {
    "%U": shellEscape(fullUrl),
    "%H": shellEscape(data.host),
    "%P": String(data.port),
    "%A": shellEscape(data.path.replace(/\/+$/, "")),
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
  const command = template.replace(PLACEHOLDER_RE, (match) => replacements[match] ?? match);

  return { command, tempFiles };
}

export function buildPlaceholderInfo(
  template: string,
  data: RequestData
): { key: string; value: string; used: boolean }[] {
  const { scheme, fullUrl } = buildFullUrl(data);

  return [
    { key: "%U", value: fullUrl, used: template.includes("%U") },
    { key: "%H", value: data.host, used: template.includes("%H") },
    { key: "%P", value: String(data.port), used: template.includes("%P") },
    { key: "%A", value: data.path, used: template.includes("%A") },
    { key: "%Q", value: data.query, used: template.includes("%Q") },
    { key: "%M", value: data.method, used: template.includes("%M") },
    { key: "%S", value: scheme, used: template.includes("%S") },
    { key: "%C", value: data.cookies, used: template.includes("%C") },
    { key: "%G", value: data.userAgent, used: template.includes("%G") },
    { key: "%D", value: data.rootDomain, used: template.includes("%D") },
    { key: "%R", value: "<raw request file>", used: template.includes("%R") },
    { key: "%E", value: "<headers file>", used: template.includes("%E") },
    { key: "%B", value: "<body file>", used: template.includes("%B") },
  ];
}
