# TODO

## Next Milestone: Smart Doc Extraction MVP

Current behavior: migration docs are fetched and passed to Gemini in full (up to 100KB per doc). This works with Gemini 3’s large context but is not optimal.

### Goal
Ship a minimal, reliable extraction step that reduces context size and focuses on relevant breaking changes.

### MVP Scope (1 sprint)
- [ ] **Header-based extraction**: keep sections with headers matching `Breaking Changes`, `Migration`, `Upgrade Guide`, `Deprecated`, `Removed`.
- [ ] **Keyword pass**: extract paragraphs containing API names found in error messages (imports, function names).
- [ ] **Fallback**: if nothing matches, send the full doc.
- [ ] **Metrics**: log doc size before/after extraction.

### Future Ideas
- Semantic search / embeddings
- Two-pass summarization cache
- Local vector store for popular packages

### Benefits
- Reduced token usage (cost savings)
- More focused context = better fixes
- Faster response times
