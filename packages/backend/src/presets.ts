import type { ToolConfig } from "./types";

export const DEFAULT_PRESETS: ToolConfig[] = [
  // SQL Injection
  {
    id: "preset-sqlmap-get",
    name: "sqlmap",
    command: "sqlmap -u %U --random-agent --batch",
    group: "SQL Injection",
    showPreview: true,
    enabled: true,
    sortOrder: 0,
  },
  {
    id: "preset-sqlmap-request",
    name: "sqlmap (request file)",
    command: "sqlmap -r %R --random-agent --batch",
    group: "SQL Injection",
    showPreview: true,
    enabled: true,
    sortOrder: 1,
  },

  // XSS
  {
    id: "preset-dalfox",
    name: "dalfox",
    command: "dalfox url %U",
    group: "XSS",
    showPreview: true,
    enabled: true,
    sortOrder: 2,
  },
  {
    id: "preset-dalfox-rawdata",
    name: "dalfox (request file)",
    command: "dalfox file %R --rawdata",
    group: "XSS",
    showPreview: true,
    enabled: true,
    sortOrder: 3,
  },

  // Fuzzing
  {
    id: "preset-ffuf",
    name: "ffuf",
    command: "ffuf -u %S://%H%A/FUZZ -w /usr/share/wordlists/dirb/common.txt",
    group: "Fuzzing",
    showPreview: true,
    enabled: true,
    sortOrder: 4,
  },
  {
    id: "preset-feroxbuster",
    name: "feroxbuster",
    command: "feroxbuster -u %S://%H%A -w /usr/share/wordlists/dirb/common.txt",
    group: "Fuzzing",
    showPreview: true,
    enabled: true,
    sortOrder: 5,
  },
  {
    id: "preset-gobuster",
    name: "gobuster dir",
    command: "gobuster dir -u %U -w /usr/share/wordlists/dirb/common.txt",
    group: "Fuzzing",
    showPreview: true,
    enabled: true,
    sortOrder: 6,
  },
  {
    id: "preset-wfuzz",
    name: "wfuzz",
    command: "wfuzz -c -w /usr/share/wordlists/dirb/common.txt --hc 404 %U/FUZZ",
    group: "Fuzzing",
    showPreview: true,
    enabled: true,
    sortOrder: 7,
  },
  {
    id: "preset-nikto",
    name: "nikto",
    command: "nikto -host %U",
    group: "Fuzzing",
    showPreview: true,
    enabled: true,
    sortOrder: 8,
  },

  // Scanning
  {
    id: "preset-nuclei",
    name: "nuclei",
    command: "nuclei -u %U -severity critical,high,medium",
    group: "Scanning",
    showPreview: true,
    enabled: true,
    sortOrder: 9,
  },
  {
    id: "preset-nuclei-request",
    name: "nuclei (request file)",
    command: "nuclei -r %R",
    group: "Scanning",
    showPreview: true,
    enabled: true,
    sortOrder: 10,
  },

  // SSL
  {
    id: "preset-sslscan",
    name: "sslscan",
    command: "sslscan %H:%P",
    group: "SSL",
    showPreview: true,
    enabled: true,
    sortOrder: 11,
  },
  {
    id: "preset-testssl",
    name: "testssl",
    command: "testssl.sh %H:%P",
    group: "SSL",
    showPreview: true,
    enabled: true,
    sortOrder: 12,
  },

  // CMS
  {
    id: "preset-wpscan",
    name: "wpscan",
    command: "wpscan --url %U --threads 10",
    group: "CMS",
    showPreview: true,
    enabled: true,
    sortOrder: 13,
  },
  {
    id: "preset-droopescan",
    name: "droopescan",
    command: "droopescan scan drupal -u %U -t 10",
    group: "CMS",
    showPreview: true,
    enabled: true,
    sortOrder: 14,
  },

  // Utility
  {
    id: "preset-httpx",
    name: "httpx",
    command: "echo %U | httpx -silent -tech-detect -status-code",
    group: "Utility",
    showPreview: true,
    enabled: true,
    sortOrder: 15,
    detectionBinary: "httpx",
  },
  {
    id: "preset-curl",
    name: "curl verbose",
    command: "curl -v -k %U",
    group: "Utility",
    showPreview: true,
    enabled: true,
    sortOrder: 16,
  },
];
