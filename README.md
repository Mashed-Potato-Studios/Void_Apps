# Void Cloud Full-Stack Monorepo

A production-ready monorepo structure built for **[Void Cloud](https://void.cloud/)** by VoidZero. Powered by **Vite**, **pnpm workspaces**, and **Turborepo**.

---

## 🏛️ Architecture & Workspace Structure

```
.
├── apps/
│   ├── web/                     # Customer-Facing Void Web App (SSR + Pages routing)
│   │   ├── pages/               # Void SSR/Static Pages (index, dashboard)
│   │   ├── routes/              # Edge API route endpoints (/api/health)
│   │   ├── middleware/          # Security & session middleware
│   │   ├── vite.config.ts       # Vite config with voidPlugin()
│   │   └── void.json            # Void project configuration
│   ├── api/                     # Dedicated Edge Microservice / Headless Backend
│   │   ├── routes/              # File-based API endpoints (/api/v1/posts, /api/v1/ai)
│   │   ├── queues/              # Cloudflare Queues background consumer (email.ts)
│   │   ├── crons/               # Scheduled cron job triggers (cleanup.ts)
│   │   ├── middleware/          # API logger & auth middleware
│   │   ├── vite.config.ts
│   │   └── void.json
│   ├── admin/                   # Operations & Analytics Portal
│   │   ├── pages/               # Admin SSR console
│   │   ├── routes/              # Admin stats API
│   │   ├── vite.config.ts
│   │   └── void.json
│   ├── coffee/                  # Crew Coffee — café storefront (React Pages)
│   │   ├── pages/               # Live menu, cart, checkout
│   │   ├── routes/api/          # Checkout proxy + health
│   │   ├── env.ts               # COFFEE_API_URL, COFFEE_ADMIN_URL
│   │   └── void.config.ts
│   ├── coffee-api/              # Coffee backend — D1, orders, crons
│   │   ├── db/                  # Schema, migrations, seed
│   │   ├── routes/api/          # Public + bearer-gated admin endpoints
│   │   ├── crons/               # Four scheduled jobs (D1 run history)
│   │   ├── src/jobs/            # Shared job logic
│   │   └── env.ts               # COFFEE_ADMIN_TOKEN, CORS origins
│   └── coffee-admin/            # Coffee back office (Basic Auth + BFF proxy)
│       ├── pages/               # Overview, orders, menu, cron console
│       ├── routes/api/admin/    # Server-side token proxy
│       ├── middleware/          # HTTP Basic Auth gate
│       └── env.ts
├── packages/
│   ├── coffee-contract/         # Coffee DTOs + typed HTTP client
│   ├── coffee-theme/            # Café CSS, photography, recipes
│   ├── db/                      # Centralized Drizzle ORM schemas (D1 SQLite / PG), client, seeds
│   ├── auth/                    # Better-Auth integration, session helpers, RBAC permissions
│   ├── ui/                      # Shared React UI component library & Void design tokens
│   ├── api-client/              # End-to-end typed fetch client for Void endpoints
│   ├── types/                   # Shared TypeScript models, DTOs, queue & cron schemas
│   └── config/                  # Shared tsconfig bases (base.json, app.json, package.json)
├── .github/workflows/deploy.yml # Multi-app Void deploy CI/CD pipeline
├── pnpm-workspace.yaml          # pnpm workspace definition
├── turbo.json                   # Turborepo task pipeline & caching
└── package.json                 # Root scripts and dev dependencies
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: `v20.0.0` or higher (Node 22 recommended)
- **pnpm**: `v9.0.0` or higher (`npm install -g pnpm`)

### 2. Install Dependencies
```bash
pnpm install
```

### 3. Setup Environment Variables
Copy the `.env.example` file:
```bash
cp .env.example .env.local
```

### 4. Run Development Servers
Start all applications in parallel with Turborepo:
```bash
pnpm run dev
```

Or start a specific application:
```bash
# Customer web application (port 5173)
pnpm run dev:web

# Backend API microservice (port 5173)
pnpm run dev:api

# Admin operations portal (port 5174)
pnpm run dev:admin

# Crew Coffee — run all three (API 5175, café 5173, admin 5174)
pnpm run dev:coffee
```

### Crew Coffee architecture

The café is split into three deployables that share
`@void-monorepo/coffee-contract` and `@void-monorepo/coffee-theme`:

- **Café** (`apps/coffee`) renders the live menu and posts checkouts to its own
  `/api/checkout` proxy.
- **API** (`apps/coffee-api`) owns D1, inventory, orders, sales aggregates, and
  four cron jobs. Admin routes require a bearer token.
- **Admin** (`apps/coffee-admin`) is Basic-Auth gated and reads/writes the API
  via a server-side BFF proxy; the token never reaches the browser.

First run:

```bash
pnpm --filter @void-monorepo/coffee-api exec void db migrate
pnpm --filter @void-monorepo/coffee-api exec void db seed
pnpm run dev:coffee
```

See each app's README for env values and deployment secrets.

---

## 🚀 Void Cloud Core Concepts in this Monorepo

### 1. Code as Infrastructure (Zero-Config Inference)
Void scans your source code for imports and provisions matching Cloudflare edge resources locally (via Miniflare) and in production:
- `import { db } from 'void/db'` ➔ Provisions D1 Database / Hyperdrive Postgres.
- `import { kv } from 'void/kv'` ➔ Provisions Cloudflare KV Namespace.
- `import { storage } from 'void/storage'` ➔ Provisions R2 Object Storage.
- `import { ai } from 'void/ai'` ➔ Provisions Workers AI (LLMs, embeddings).
- `crons/*.ts` ➔ Provisions Cloudflare Cron Triggers.
- `queues/*.ts` ➔ Provisions Cloudflare Queues consumers.

### 2. `void.json` Project Configuration
Each application in `apps/*` contains a `void.json` configuring its target, auth providers, routing headers, and Cloudflare Worker compatibility:
```json
{
  "$schema": "https://void.cloud/schema.json",
  "target": "cloudflare",
  "auth": {
    "providers": ["email", "github", "google"]
  },
  "routing": {
    "revalidate": {
      "/": 60,
      "/dashboard": 0
    }
  },
  "worker": {
    "compatibility_date": "2026-01-01",
    "compatibility_flags": ["nodejs_compat"]
  }
}
```

### 3. Remote Development Mode
To connect local development to live deployed Void Cloud resources (D1/KV/R2) instead of local emulators:
```bash
VOID_REMOTE=1 pnpm dev
```

---

## 🛠️ Database Management (`@void-monorepo/db`)

Database schemas are centralized in `packages/db/src/schema/` and shared across all apps.

```bash
# Generate schema migrations
pnpm run db:generate

# Apply migrations
pnpm run db:migrate

# Seed database with initial dataset
pnpm run db:seed
```

---

## 🚢 Deployment to Void Cloud

### Using the Void CLI
Authenticate with Void Cloud once:
```bash
void auth login
```

Deploy individual applications:
```bash
# Deploy Web App
pnpm run void:deploy:web

# Deploy API Service
pnpm run void:deploy:api

# Deploy Admin Console
pnpm run void:deploy:admin
```

### Automated CI/CD
A complete GitHub Actions workflow is located at `.github/workflows/deploy.yml`. When you push to `main`, each Void app is validated, built, and deployed using `void deploy`.

---

## 📜 Available Root Scripts

| Script | Description |
| :--- | :--- |
| `pnpm dev` | Runs all apps in development mode with Turborepo |
| `pnpm build` | Builds all packages and apps |
| `pnpm typecheck` | Validates TypeScript across all workspaces |
| `pnpm lint` | Runs linters across all packages |
| `pnpm db:generate` | Generates Drizzle migrations for D1/Postgres |
| `pnpm db:seed` | Seeds database with mock data |
| `pnpm void:deploy` | Deploys all apps to Void Cloud |
