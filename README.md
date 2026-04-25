# GIAN Grassroots Innovation Directory

Standalone GIAN multimedia database directory with a SELCO-style public search flow, MapmyIndia results, admin sync, and scheduled refresh support.

Project folder:
`C:\github\gian-innovation-directory`

Included app surfaces:
- Public search page: `index.html`
- Innovator detail page: `vendor-detail.html`
- Innovation detail page: `product-detail.html`
- Admin-triggered sync page: `admin.html`
- Shared Supabase loader: `innovation-store.js`
- Supabase migration: `supabase/migrations/20260425193000_create_gian_innovation_directory.sql`
- Supabase edge function: `supabase/functions/gian-innovation-admin/index.ts`
- Scheduled sync workflow: `.github/workflows/sync-gian-directory.yml`

Implementation notes:
- Innovators are normalized into vendor-style rows so the UI and admin controls stay parallel with the SELCO project.
- Innovations are normalized into product-style rows with innovation details, images, multimedia links, and tags.
- The sync scrapes `https://gian.org/multimedia-database/` and then does best-effort public web enrichment for missing email, phone, and address details.
- Map markers use the shared MapmyIndia interaction model and are styled as orange dots for GIAN.

Deployment:
- GitHub Pages deploys automatically from `.github/workflows/deploy-pages.yml`
- The static frontend uses the configured Supabase URL and anon key in `config.js`
- Set `MAPMYINDIA_MAP_KEY` in `config.js` to enable the live map

Backend requirements:
- The `gian-innovation-admin` edge function reads `SUPABASE_SERVICE_ROLE_KEY` and falls back to `SELCO_VENDOR_SERVICE_ROLE_KEY`
- Set `GIAN_DIRECTORY_SYNC_CRON_TOKEN` on Supabase and match it with the GitHub secret `GIAN_SYNC_TOKEN`
- Set the GitHub secret `GIAN_SYNC_URL` to the deployed function endpoint, for example `https://<project-ref>.supabase.co/functions/v1/gian-innovation-admin`
