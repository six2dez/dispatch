<!--
Thanks for the PR! A few notes:

- Open PRs against `main`.
- CI (.github/workflows/ci.yml) runs lint + typecheck + build automatically.
- For security-sensitive changes, read SECURITY.md first.
-->

## Summary

<!-- What does this change and why? 1–3 bullets is plenty. -->

## Testing

<!-- How did you verify the change? E.g. "Built and installed in Caido; ran
sqlmap preset against X; History shows exit 0." Screenshots welcome for UI work. -->

## Checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` produces a working `dist/dispatch.zip`
- [ ] Manually installed and exercised in Caido (for UI / executor changes)
- [ ] Updated `CHANGELOG.md` under `## Unreleased` (unless this is docs-only)
- [ ] Updated `README.md` if behavior or placeholders changed
- [ ] No secrets, PII, or internal hostnames added to the repo

## Notes for reviewers

<!-- Optional. Anything non-obvious, tradeoffs, follow-up work planned. -->
