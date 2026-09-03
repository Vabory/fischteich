# Fischteich repository instructions

## PWA build ID

- For every completed change to shipped Fischteich app code, behavior, configuration, or assets that is being prepared for a new commit or release, increment the technical Fischteich build ID exactly once per task. This includes changes to HTML, CSS, JavaScript, UI, images/assets, PWA behavior, the service worker, Supabase client code, app features, bug fixes, and polish.
- Use only the existing build command to set it: `node scripts/set-app-build.cjs <NEW_BUILD_ID>`. Run it before the final test and diff report so the embedded build in `index.html` and `version.json` are synchronized. Do not introduce a second build-setting mechanism.
- Build IDs use `YYYYMMDD.N`, where the date is the current date and `N` is the next sequence number for that date. Before choosing an ID, inspect the current files and repository history for IDs with today's date, take the highest existing `N`, and add one. If none exists for today, use `.1`. Never assume `.1` without checking.
- Multiple changed app files within one task still receive only one build-ID increment.
- Do not increment the build ID for analysis-only work, questions, test-only runs, status/diff checks, changes only to tests, documentation not shipped with the app, changes only to `AGENTS.md` or other Codex instructions, or when the user explicitly says not to prepare a release build.
- The technical build ID does not replace asset cache versions such as `style.css?v=...` or `script.js?v=...`. Continue to bump each affected asset URL when cache invalidation requires it.
- In the final report for every task that increments the build ID, include `Fischteich Build: <OLD_ID> → <NEW_ID>`.
