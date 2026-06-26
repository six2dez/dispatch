# Security Policy

## Scope

Dispatch is a Caido plugin that executes arbitrary shell commands by design — it
is built for security professionals who need to pipe HTTP requests to CLI tools.
That design trades a large attack surface for flexibility.

This policy covers vulnerabilities in Dispatch itself, not in the CLI tools it
invokes (sqlmap, ffuf, nuclei, dalfox, etc.) or in Caido.

## Supported Versions

Only the latest minor release receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a Vulnerability

**Do not open a public issue** for security reports.

Prefer one of:

1. **GitHub Security Advisories** (preferred): open a private advisory at
   https://github.com/six2dez/dispatch/security/advisories/new
2. **Email**: security reports to `six2dez@gmail.com` with subject
   `[dispatch-security] <short title>`. PGP welcome but not required.

Please include:

- Affected version / commit SHA
- Reproduction steps or a proof-of-concept
- Expected vs. actual behavior
- Your assessment of impact

### Response expectations

- Acknowledgement within 72 hours
- Triage and initial assessment within 7 days
- Fix and coordinated disclosure aimed at 90 days from report

Credit will be offered in the release notes and advisory unless you prefer to
stay anonymous.

## In-scope threat model

Dispatch is designed to execute commands on the host it runs on. The following
are considered bugs worth reporting:

- Shell injection via placeholders that bypasses `shellEscape()` (e.g. a value
  that escapes single-quote wrapping)
- Tool configuration import that overwrites or mutates existing tools without
  user confirmation
- Temp file handling that exposes request bodies to other local users
- Memory/process leaks that survive Caido shutdown
- SQLite escaping bugs that corrupt the history/tools store
- Capacity-limit bypasses (more than MAX_CONCURRENT processes)
- Signature verification flows that can be trivially forged

## Out of scope

- The preview dialog runs edited commands literally. This is intentional and
  documented — injecting a command through the preview is not a vulnerability.
- Users can run arbitrary tool templates. Nothing stops a malicious template
  from doing damage; that is part of the threat model.
- Issues in upstream CLI tools (report those to the respective projects).
- Issues in Caido itself (report to https://github.com/caido).

## Release signature verification

Every release publishes `plugin_package.zip` along with `plugin_package.zip.sig`, an ED25519
signature over the zip. The public key `public.pem` is attached to each release.

To verify a downloaded release:

```sh
openssl pkeyutl -verify \
  -pubin -inkey public.pem \
  -rawin -in plugin_package.zip \
  -sigfile plugin_package.zip.sig
```

If the command prints `Signature Verified Successfully`, the zip has not been
tampered with. If you see any other output, **do not install the plugin**;
contact the maintainer.
