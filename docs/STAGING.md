# Staging

Staging is a full copy of the stack with its own data:

| Piece | Production | Staging |
| --- | --- | --- |
| Site | `gaslandsgarage.com` (InfraStack) | `staging.gaslandsgarage.com` (StagingInfraStack) |
| Certificate | CertificateStack | StagingCertificateStack (no www) |
| Firebase project | `gaslandsgarage-74ce6` | `gaslandsgarage-staging` (`.firebaserc` alias `staging`) |
| Storage bucket | `gaslandsgarage-74ce6.firebasestorage.app` | `gaslandsgarage-staging.firebasestorage.app` |
| Build | `pnpm run build` | `pnpm run build:staging` (`VITE_GG_ENV=staging`, `app/.env.staging`) |
| Search engines | indexed | `X-Robots-Tag: noindex, nofollow` on every response, `robots.txt` = `Disallow: /`, no sitemap |

Staging holds fake sample data only (`scripts/seed-staging.mjs`). Never copy
production users, teams, photos, or emails into it. Twilio secrets in staging
are set to `disabled`, so no invite or contact email is sent.

## Deploys

`Build-and-Deploy` (`.github/workflows/ci.yml`):

1. **staging** runs on every push to `main`: builds the staging site, deploys
   the staging CDK stacks, uploads the site, then deploys Firestore rules and
   indexes, Storage rules, and functions to `gaslandsgarage-staging`.
   Google Cloud access is keyless Workload Identity Federation:
   pool `github-actions`, provider `gaslandsgarage` (accepts only
   `joseanes/gaslandsgarage` on `refs/heads/main`), service account
   `github-staging-deploy@gaslandsgarage-staging.iam.gserviceaccount.com`.
   No `--force`: a deploy that would delete a function or index fails.
2. **deploy** (production) waits for staging, then for approval on the
   `production` GitHub environment. Its steps are unchanged.

## Seeding

```sh
ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/seed-staging.mjs
```

The script refuses any project other than `gaslandsgarage-staging`.
