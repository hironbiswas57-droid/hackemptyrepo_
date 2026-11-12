# Stillwell

Stillwell is an AI wellbeing companion prototype for reflection and general mental-health education. It is not a psychologist, therapist, doctor, diagnostic tool, or crisis service.

## Open the website

- Local development: [http://localhost:5173/](http://localhost:5173/)
- Production: configure your own domain in `.env`; Caddy serves it over HTTPS after DNS is pointed at the server.

There is no public Stillwell domain configured yet, so the local link is the only real page URL. Do not replace it with an `https://localhost` link: HTTPS requires a trusted certificate. The production setup below obtains one automatically for a real domain.

## Run locally

Requirements: Node.js 22.5 or newer (the project uses Node's built-in SQLite module).

1. Install dependencies: `npm install`
2. Generate local session and encryption secrets: `npm run setup`
3. Add a Hugging Face token with Inference Providers access to the `HF_TOKEN` setting in the ignored root `.env` file. Never put provider tokens in `src/.env`, frontend code, or `.env.example`.
4. Start the API and web interface together with `npm start`, then open [http://localhost:5173/](http://localhost:5173/). Press Ctrl+C to stop both.

To run the API and web server separately, use `npm run server` and `npm run dev` in two terminals.

The Vite development server proxies `/api` requests to the local Express server. `src/.env` contains only the browser-safe API path. If a sandboxed browser cannot reach the loopback-only dev server, run `npm run dev -- --host 0.0.0.0` for that preview session.

## Accounts and conversation memory

Account creation requires an explicit opt-in to encrypted conversation memory. For registered users with memory enabled, each user message and assistant reply is encrypted with AES-256-GCM before it is written to the local SQLite database at `data/stillwell.sqlite`. Email addresses and display names are also encrypted; a keyed HMAC is used for email lookup. Passwords are stored as salted scrypt hashes, never as plaintext. Session tokens are random, stored as keyed hashes, held in HttpOnly/SameSite cookies, and expire after 12 hours.

The database is account-scoped. A signed-in user's most recent 16 saved messages can be included as context for their next reply; records are never included in another account's context. This is per-user retrieval for continuity, not model fine-tuning. The project does not train a shared model on conversations. The user can disable future memory, delete saved conversations, or delete their account from the account page. Disabling memory does not erase existing records; deleting the records is a separate action. If memory is enabled again later, the still-saved records can be used as context again.

The reply service is Hugging Face Inference Providers using `openai/gpt-oss-20b:fastest`. Messages and the included recent context are transmitted to Hugging Face to generate replies. Do not enter identifying or highly sensitive clinical information in this prototype. Review the provider's current data-processing terms before any real client use.

## API routes

- `GET /api/health` — health status.
- `POST /api/auth/register` — creates an account only when `memoryConsent: true` is submitted.
- `POST /api/auth/login` and `POST /api/auth/logout` — start/end an account session.
- `GET /api/auth/me` — returns the current account.
- `POST /api/chat` — generates a reply; registered, opted-in messages are stored encrypted.
- `GET /api/memory`, `DELETE /api/memory`, `PATCH /api/memory/consent` — read, delete, or disable/enable account memory.
- `DELETE /api/account` — removes the account and its dependent session and interaction rows.

The app limits request sizes, rate-limits API and authentication requests, validates same-origin writes, uses Helmet security headers, binds the API to loopback by default, and keeps provider credentials server-side. No request content or user IP is written to application logs.

## Deploy with HTTPS

The supplied `Dockerfile`, `compose.yaml`, and `Caddyfile` build and serve the frontend and API behind Caddy. Caddy obtains and renews a trusted HTTPS certificate for the configured domain.

1. Point the domain's `A` record (and `AAAA` record if IPv6 is configured correctly) to the server's public address. Wait for DNS propagation.
2. Run `npm run setup` on the deployment host to create a private `.env`, then set `DOMAIN=your-real-domain` and `HF_TOKEN=your-provider-token` in that ignored file. Keep the generated `SESSION_SECRET` and `DATA_ENCRYPTION_KEY` unchanged and backed up separately in a secrets manager.
3. Start deployment with `docker compose up --build -d`.
4. Configure the host firewall to accept inbound TCP 80 and 443 (and UDP 443 for HTTP/3) only. Do not publish port 3001 or expose the SQLite volume. Restrict SSH to trusted admin addresses.
5. Use a DNS provider with MFA and access controls; enable DNSSEC where supported. Keep database storage and backups private, encrypted, and access-limited. Allow outbound HTTPS only to required services, including `router.huggingface.co`.

Compose exposes only Caddy on ports 80/443; the app and database stay on the private Docker network/volume. The app requires the exact `CLIENT_ORIGIN` set by Compose and rejects unencrypted HTTP in production. Keep `TRUST_PROXY=1` only while the app is reachable exclusively through the configured Caddy proxy. Review provider, host, DNS, backup and container security settings before handling real client data.

### Encryption key handling

The generated `DATA_ENCRYPTION_KEY` is required to read stored account and interaction data. Back it up securely and separately from the database. If it is lost, encrypted records cannot be recovered. If it is exposed, rotate it using a planned migration and revoke affected sessions. Deleting rows is an application-level deletion and cannot guarantee physical erasure from every filesystem, snapshot, or backup.

## Project layout

- `src/` — React interface and browser-safe configuration.
- `server/` — Express API, SQLite schema/access, encryption, authentication, and local secret setup.
- `data/` — local encrypted database, ignored by Git.
- `Dockerfile`, `compose.yaml`, `Caddyfile` — production container and HTTPS reverse proxy.
- `.env.example` — safe configuration guidance only; no API token variable or credential.

## Important limitations before real client use

This is a prototype, not a compliant clinical records platform. It has no email verification, account recovery, MFA, organization/clinician roles, audit review system, automated retention schedule, encrypted backups, key-rotation workflow, or independent security/clinical review. Add those controls and obtain privacy, legal, and clinical review before storing real client information. Application code cannot configure your cloud firewall, DNS provider, or server access policy for you.
