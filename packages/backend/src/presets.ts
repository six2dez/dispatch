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
    command:
      "dalfox url %U --user-agent %G --context-aware --deep-domxss --detailed-analysis",
    group: "XSS",
    showPreview: true,
    enabled: true,
    sortOrder: 2,
  },
  {
    id: "preset-dalfox-rawdata",
    name: "dalfox (request file)",
    command:
      "dalfox file %R --rawdata --user-agent %G --context-aware --deep-domxss --detailed-analysis",
    group: "XSS",
    showPreview: true,
    enabled: true,
    sortOrder: 3,
  },

  // Fuzzing
  {
    id: "preset-ffuf",
    name: "ffuf",
    command:
      'ffuf -mc all -fc 404 -r -c -H "User-Agent: "%G -u %S://%H%A/FUZZ -w WORDLIST',
    group: "Fuzzing",
    showPreview: true,
    enabled: true,
    sortOrder: 4,
  },
  {
    id: "preset-x8",
    name: "x8 (param discovery)",
    command: "x8 -u %U -w WORDLIST",
    group: "Fuzzing",
    showPreview: true,
    enabled: true,
    sortOrder: 5,
    detectionBinary: "x8",
  },

  // Scanning
  {
    id: "preset-nuclei",
    name: "nuclei",
    command: "nuclei -u %U -severity info,low,medium,high,critical,unknown",
    group: "Scanning",
    showPreview: true,
    enabled: true,
    sortOrder: 6,
  },
  {
    id: "preset-nuclei-request",
    name: "nuclei (request file)",
    command: "nuclei -l %R -severity info,low,medium,high,critical,unknown",
    group: "Scanning",
    showPreview: true,
    enabled: true,
    sortOrder: 7,
  },

  // Crawling
  {
    id: "preset-katana",
    name: "katana",
    command: "katana -u %U -silent",
    group: "Crawling",
    showPreview: true,
    enabled: true,
    sortOrder: 8,
    detectionBinary: "katana",
  },
  {
    id: "preset-gospider",
    name: "gospider",
    command: "gospider -s %U -d 2 --sitemap --robots",
    group: "Crawling",
    showPreview: true,
    enabled: true,
    sortOrder: 9,
    detectionBinary: "gospider",
  },

  // Parameter Discovery
  {
    id: "preset-arjun",
    name: "arjun",
    command: "arjun -i %R",
    group: "Parameter Discovery",
    showPreview: true,
    enabled: true,
    sortOrder: 10,
    detectionBinary: "arjun",
  },

  // Recon
  {
    id: "preset-subfinder-httpx",
    name: "subfinder + httpx",
    command:
      "subfinder -d %D -silent | httpx -silent -tech-detect -status-code -title",
    group: "Recon",
    showPreview: true,
    enabled: true,
    sortOrder: 11,
    detectionBinary: "subfinder",
  },

  // SSL
  {
    id: "preset-sslscan",
    name: "sslscan",
    command: "sslscan %H:%P",
    group: "SSL",
    showPreview: true,
    enabled: true,
    sortOrder: 12,
  },
  {
    id: "preset-testssl",
    name: "testssl",
    command: "testssl.sh --color 3 %H:%P",
    group: "SSL",
    showPreview: true,
    enabled: true,
    sortOrder: 13,
  },

  // CMS
  {
    id: "preset-wpscan",
    name: "wpscan",
    command:
      "wpscan --random-user-agent --rua -e vp,cb,dbe,u --detection-mode aggressive --api-token $WPSCAN_API -v --disable-tls-checks --ignore-main-redirect --url=%U",
    group: "CMS",
    showPreview: true,
    enabled: true,
    sortOrder: 14,
  },
  {
    id: "preset-droopescan",
    name: "droopescan",
    command: "droopescan scan drupal -u %U -t 10",
    group: "CMS",
    showPreview: true,
    enabled: true,
    sortOrder: 15,
  },

  // JS Analysis
  {
    id: "preset-linkfinder",
    name: "LinkFinder",
    command: "linkfinder -i %U -o cli",
    group: "JS Analysis",
    showPreview: true,
    enabled: true,
    sortOrder: 16,
    detectionBinary: "linkfinder",
  },

  // Utility
  {
    id: "preset-httpx",
    name: "httpx",
    command:
      "echo %U | httpx -silent -tech-detect -status-code -title -content-length -follow-redirects",
    group: "Utility",
    showPreview: true,
    enabled: true,
    sortOrder: 17,
    detectionBinary: "httpx",
  },
  {
    id: "preset-curl",
    name: "curl verbose",
    command: "curl -v -k -L -A %G %U",
    group: "Utility",
    showPreview: true,
    enabled: true,
    sortOrder: 18,
  },
];
