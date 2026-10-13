# @void-monorepo/config

Shared TypeScript presets for the Void monorepo.

| Preset | Target | Use in |
|---|---|---|
| `tsconfig/base.json` | Shared strictness only, no emit settings | Base for all presets, never extend directly |
| `tsconfig/app.json` | Web: DOM lib, `vite/client`, `react-jsx` | `apps/web`, `apps/admin` (Vite + React) |
| `tsconfig/server.json` | Node: `ESNext` lib, `NodeNext`, `@types/node` | `apps/api` and other server code |
| `tsconfig/package.json` | Libraries: `declaration:true`, `outDir: dist` | `packages/*` that compile to `dist` |

Extend via `@void-monorepo/config/tsconfig/<name>.json`.
`app.json` and `server.json` set `noEmit:true`; only the
package preset emits. Root `index.js` is a stub so the
package itself remains importable (`"."` export).

All presets share `strict` plus `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, and unused-local/parameter checks.
Emit settings live only in the package preset.
See `tsconfig/*.json` for the exact compiler options.
