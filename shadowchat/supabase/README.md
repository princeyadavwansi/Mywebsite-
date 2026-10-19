# ShadowChat guest-chat migration (Supabase)

This folder contains the database schema and an initial Edge Function source for a shareable-code guest chat.

## Current status — not production ready

- The database tables exist in the connected Supabase project.
- Edge Function source is checked into `functions/shadowchat/index.ts`.
- The function has **not** been deployed or integration-tested.
- The currently published GitHub Pages frontend still uses Matrix login; it does not yet use the guest-chat API.
- Client-side end-to-end encryption, key exchange, rate limiting, abuse controls, and a full security review are not complete.

Do not tell users this is live or E2EE until deployment, frontend integration, and independent tests are complete.

## Database setup

Run `schema.sql` in the Supabase SQL Editor. Keep RLS enabled and do not add public/anon policies to these tables.

## Edge Function setup

Deploy `functions/shadowchat/index.ts` as the `shadowchat` Supabase Edge Function. Supabase must provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-side environment variables. Never put the service-role key in frontend code or GitHub Pages.

The function source supports room creation, joining by a high-entropy code, listing/sending stored message payloads, and room revocation. Before public use, add and test request rate limits, abuse controls, and a clear owner-only revoke flow. The function currently stores the supplied message payload as `ciphertext`; that field name does **not** itself provide encryption.

## Required before calling it ready

1. Deploy the function successfully and verify the deployed version.
2. Add a guest-chat frontend and connect it to the function.
3. Encrypt messages in the browser with a reviewed protocol and establish how both participants obtain the key without sending it to the server.
4. Test create/join/send/list/revoke, invalid codes, expired sessions, revoked rooms, and mobile browsers.
5. Confirm no service-role secret is present in frontend bundles or repository history.
6. Run a security review. Until then, do not describe the app as end-to-end encrypted or production ready.

GitHub Pages is a static frontend. Project URL and publishable key can be public; service-role keys/passwords must never be exposed.
