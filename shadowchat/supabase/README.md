# ShadowChat guest-chat migration (Supabase)

This folder is the prepared database foundation for replacing Matrix sign-in with a shareable secret-code guest chat.

## Important status
This is **not live guest chat yet**. The GitHub Pages frontend cannot safely verify a shared secret by itself. A secure working release also needs Supabase Edge Functions for: owner room creation, rate-limited code verification, issuing/revoking guest sessions, and authenticated message read/send. Those functions must validate tokens server-side. Never place the Supabase service-role key in frontend code or GitHub Pages.

## Database setup
1. Create a Supabase project.
2. Open **SQL Editor → New query**.
3. Paste and run `schema.sql`.
4. Keep RLS enabled. Do not add public/anon policies to these tables.
5. Configure Edge Function secrets in Supabase dashboard (server-side only), then deploy the functions before enabling the guest-chat UI.

## Security design
- The owner creates a room and shares its link plus a high-entropy secret out of band.
- Server verifies the secret with rate limits and stores only hashes of access tokens.
- The browser receives a revocable, expiring guest session; same browser can retain it locally.
- Messages should be end-to-end encrypted in the browser before storage. Until that client-side cryptography and key exchange are implemented and reviewed, do not describe the service as E2EE.
- A shared code can be forwarded or leaked. For better security use a long random code, rate limiting, expiry/revocation, and an owner approval step.
- GitHub Pages remains a static frontend; Supabase project URL and publishable key may be public, but service-role keys/passwords must never be exposed.

The existing Matrix app is intentionally not replaced by an insecure client-only password gate.
