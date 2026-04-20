# Inhale

AI-enhanced interactive PDF reader for scientific papers.

## Prerequisites

- Node.js 20+
- Docker Desktop (for local Postgres with pgvector)

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd inhale
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local — see Environment Variables below

# 3. Start Postgres
docker compose up -d postgres

# 4. Run migrations
npm run db:migrate

# 5. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `BETTER_AUTH_SECRET` | Yes | Random secret for Better Auth session signing |
| `ENCRYPTION_KEY` | Yes | 64 hex chars (32 bytes) — AES-256-GCM key for stored API keys |
| `UPLOAD_DIR` | No | Directory for uploaded PDFs (default: `uploads/`) |

Generate secrets:

```bash
# BETTER_AUTH_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY (must be exactly 64 hex chars)
openssl rand -hex 32
```

## Database

Docker is the only supported local dev path. Running `docker compose up -d postgres` boots `pgvector/pgvector:pg16` with the `vector` extension created automatically via `docker/initdb/01-extensions.sql`.

See [docs/migrations.md](docs/migrations.md) for the full migration workflow.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle migrations from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio (database browser) |
| `npm run db:check` | Verify migration snapshot matches schema |
