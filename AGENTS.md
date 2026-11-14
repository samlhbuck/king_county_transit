# Repository workflow

## Route Lens product coordination

- Before planning or implementing Route Lens work, read `docs/priorities.md`. It is the single source of truth for the product vision, current decision board, numbered backlog and verification status; do not create a second top-level priorities file.
- Use the current user request to choose scope. The priority board guides sequencing but is not blanket authorization to implement everything ranked highly.
- Preserve the product's curiosity-first, map-first approach and the distinctions among current data, historical analysis, and observed experience.
- Keep statuses precise: locally implemented, verified in tests, checked on a real device, and deployed to production are different claims.
- When a change affects a numbered backlog item, update its entry in `docs/priorities.md` as part of the coherent implementation commit, recording what actually changed and any remaining verification. Never mark an item complete solely because code was edited.
- Treat newly agreed product priorities as edits to `docs/priorities.md` rather than separate chat-only instructions or a competing backlog. Do not silently rerank established priorities.

- Include a local Git commit with each completed, coherent implementation update, after appropriate verification.
- Report the commit hash and any verification limitations in the completion message.
- Do not automatically push or deploy; those are separate actions requiring user direction.
- Stage only files relevant to the work. Preserve unrelated user changes and drafts.
- Never commit credentials, local environment files, private feedback stores, or downloaded raw/processed datasets.
