# Stable public URLs

The following URLs are permanent compatibility contracts because they are cited by submitted manuscripts:

- `https://ql-xun.github.io/speeddetector/`
- `https://ql-xun.github.io/papers/xun2026efficient/`

Do not rename or delete their directories. The destination behind a redirect may be updated, but the public URL must stay unchanged.

`scripts/check_site_contract.py` validates these paths and their essential targets. The GitHub Actions workflow runs this check for every pull request and before every Pages deployment. For stronger repository-level enforcement, configure a branch protection ruleset for `master` that requires the `Validate permanent site URLs` check before merging.
