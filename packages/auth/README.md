# @void-monorepo/auth

Scope: RBAC permission matrix + bearer-token parsing only.

- `hasPermission` / `assertPermission` / `requirePermission` / `canManageUsers`
  check the static role → permission matrix (fail-closed for unknown roles).
- `extractBearerToken` / `toAuthorizationHeader` parse and format
  `Authorization: Bearer <token>` header values.
- `isSessionExpired` compares `AuthSession.expires` against now
  (unparseable dates count as expired).

No token verification, hashing, or session-DB logic lives here.
