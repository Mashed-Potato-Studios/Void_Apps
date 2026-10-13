# Fingerprint emitter prototype spike

Type: prototype
Status: resolved
Blocked by: 02, 03

## Question

HITL prototype. Raise fidelity with a cheap throwaway emitter stub run against one app (prefer `apps/api`), after [Vite+ and voidPlugin hook points](02-viteplus-plugin-hookpoints.md) and [Manifest schema and hash rules](03-manifest-schema-and-hash.md) close. Produce a rough manifest + hash (hand-rolled, no packaging, no publish shape) for reaction only; link the prototype asset. Goal is to validate schema/hash/hook choices, not to ship. Anything built stays labeled throwaway; keeping it is a new request.

## Comments

## Answer

Resolved 2026-10-13 (GitHub #7, closed). Probe ran clean on apps/api: 8 files, empty bindings, fingerprint 8407e602…069b2658e. Approved: keep manifest shape (full 64-char hashes in real build); kill probe after map closes — spec is source of truth.
