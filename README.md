# Arch's Arc

Archie's daily routine and homework app.

- Front end: static files in this folder, hosted on Vercel.
- Server: Supabase project `archs-arc`, Edge Function `arc` (source in `supabase/functions/arc`).
- Reminders: pg_cron calls `arc/notify` every 5 minutes.

No secrets live in this repository. PINs, push keys and the cron secret are stored in the Supabase database.
