# Manifest schema and hash rules

Type: grilling
Status: open
Blocked by: 01, 06

## Question

HITL grilling + domain-modeling. Decide the Fingerprint manifest schema and stable-hash rules, building on [Void inference scanner internals](01-void-inference-internals.md) and [Monorepo app and resource inventory](06-monorepo-inventory.md). Settle: full field list (app type, framework adapter, routes/pages inventory, middleware order, `void.json` snapshot, inferred bindings with import specifiers + env accesses, Drizzle schema + migration hashes, plugin list, deps), ordering/normalization, exclusions (timestamps, `.void/`, lockfiles, `node_modules`), hash algorithm + canonical serialization, committed (`void.fingerprint.json`) vs generated (`.void/fingerprint.json`) split, per-app vs monorepo root graph shape. Resolves through live exchange; agent never answers for human.

## Comments
