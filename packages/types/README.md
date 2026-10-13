# @void-monorepo/types

Shared DTOs, API envelopes, and queue/cron schemas.

## DTO vs row: date convention

- **Wire (DTO):** ISO-8601 strings (`createdAt: string`). JSON-safe.
- **DB row (Drizzle):** `Date` objects (`integer(..., { mode: 'timestamp' })`).
- Map at the boundary: `date.toISOString()` when serializing, `new Date(s)` when reading.
- Never change a DTO date field to `Date` — it breaks JSON consumers.

## Roles: single-source plan

- `USER_ROLES` const in `src/index.ts` is the types-package source of truth;
  `UserRole` is derived via `(typeof USER_ROLES)[number]`.
- DB enum in `packages/db/src/schema/users.ts` mirrors it. Keep both lists
  in sync manually until codegen (DB infers its own row types; no import
  from types to avoid a package cycle).
- `avatarUrl` (DTO) maps to `image` (DB column). Not renamed — breaking.
  Map `avatarUrl <-> image` at the boundary.
