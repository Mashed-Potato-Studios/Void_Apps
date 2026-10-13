# @void-monorepo/db

Centralized database schemas, migrations, and seeds for Void Cloud applications.

## Status: stub — no driver wired yet

- `src/client.ts` exports only the schema shape (`dbSchema` / `DBSchema`) for ORM
  query inference. There is **no live database driver** (no `drizzle()` client,
  no libsql/neon/postgres adapter) configured yet.
- Do not treat `dbSchema` as a queryable database handle.

## Password-hash requirement

- `accounts.password` must store a **password hash** (e.g. bcrypt/argon2),
  **never plaintext**. The column name is frozen — renaming it requires a
  migration, so the requirement is documented in code instead.

## Seed is import-only

- `src/seed.ts` exports `initialUsers` / `initialPosts` data only. It is
  available via the `./seed` subpath export (`@void-monorepo/db/seed`) and is
  intentionally **not** re-exported from the package root.
- The `db:seed` script (`tsx src/seed.ts`) requires `tsx`, which is **not**
  installed in this package (no new dependencies added by policy). Until `tsx`
  (or another runner) is provided, consume the seed module by importing it —
  there is no standalone seed runner.
