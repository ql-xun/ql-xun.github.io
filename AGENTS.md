# Personal website

- Keep changes local until the user explicitly approves publication. A request to edit, test, or preview does not authorize a push, PR, merge, deployment, or scheduled job.
- Use `local/journal-explorer` for work on the unpublished Journal Explorer. Preserve the public paper URLs, CV, and verification files.
- **After every website edit:** run the relevant local checks, start or reuse `python -B scripts/serve_site.py 8775`, then open the changed page on `http://127.0.0.1:8775/` and verify the change in the running preview. For Journal Explorer, open `/tools/journals/?lang=zh`. Keep the preview available for the user; if the server stopped, restart it before reporting completion.
- Read [JOURNAL_GUIDE.md](JOURNAL_GUIDE.md) for the journal checks, snapshot maintenance, and local preview commands.
