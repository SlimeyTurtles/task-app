<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Changelog discipline

Every user-visible change (feature, improvement, fix) MUST be recorded in
`src/lib/changelog.ts` in the same commit:

- Add a new entry at the TOP of `CHANGELOG` (or extend the top entry if it's from
  the same working session and hasn't shipped yet). Bump the version: minor
  (0.x.0) for features, patch (0.x.y) for fixes/polish.
- Keep `package.json` `version` equal to the top entry's version.
- Write changes as short, user-facing sentences (what changed, not how).
- Prune `PLANNED_FEATURES` when a planned item ships, and add newly agreed
  future work there.

Internal-only changes (refactors, CI, docs) don't need an entry.
