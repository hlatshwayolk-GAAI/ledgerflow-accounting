## Problem

The app won't open because the browser Supabase client throws on load:

```
Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
```

Lovable Cloud is still connected — the database, tables, RPCs, and server-side secrets are all intact — but the project's local `.env` file (which Vite inlines into the browser bundle at build time as `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`) is missing. Without those values, every route that touches Supabase (including `/auth`) crashes on first use.

## Fix

Recreate the `.env` file from the Lovable Cloud project's existing credentials so Vite can inject them into the client bundle again. Specifically:

1. Regenerate `.env` with the four values Vite/SSR need:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
   - Matching non-prefixed `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PROJECT_ID` for server functions and SSR fallback.
2. Restart the Vite dev server so the new env is picked up.
3. Reload `/auth` and confirm the console error is gone and the sign-in form submits.

No code, schema, or business-logic changes are needed — this is purely restoring the environment wiring between the frontend and the already-connected Cloud backend.
