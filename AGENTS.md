# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Ainspecciona is a monolith Node.js/Fastify SaaS for real estate property inspection (Chilean market). Single `server.js` (~5900 lines) + modular helpers in `src/`. Frontend is vanilla HTML/CSS/JS in `public/` — no build step.

### Services

| Service | How to run | Port |
|---------|-----------|------|
| MySQL 8.0 | `sudo dockerd &` then `sudo docker compose up -d` | 3306 |
| Fastify server | `npm run dev` | 3000 |

### Gotchas

- **Docker daemon**: In Cloud Agent VMs, Docker runs inside a container. The daemon must be started manually (`sudo dockerd`) before `docker compose up -d`. It uses `fuse-overlayfs` storage driver and `iptables-legacy`.
- **Prisma migrations**: The repo's migration files have a table-name case bug (`user` vs `User`). Use `npx prisma db push` instead of `npx prisma migrate deploy` to sync the schema.
- **Database URL**: `.env.example` has the correct local connection string: `mysql://ainspecta:ainspecta2026@localhost:3306/ainspecta`.
- **Admin auth**: Admin API routes (`/api/admin/*`) require headers `x-admin-user: admin` and `x-admin-pass: admin123` (defaults from `server.js`).
- **Tenant auth**: Tenant login returns a session token. Pass it as `Authorization: Bearer <token>` or cookie `tenant_session=<token>`.
- **Credits**: Creating an inspection requires credits. Use `POST /api/admin/tenants/:id/credits` with admin headers to add credits.
- **No linter or test framework**: The codebase has no ESLint config and no automated test suite. QA is done via `npm run qa:cases` which requires a running server and existing cases.
- **External APIs are optional**: OpenAI, MercadoPago, HubSpot, SMTP — the app runs without them; features that need them degrade gracefully.

### Standard commands

See `package.json` scripts and `README.md` for full reference. Key commands:
- `npm run dev` — start dev server
- `npx prisma db push` — sync schema to DB
- `npm run prisma:seed` — seed database
- `npm run qa:cases` — run QA regression against running server
