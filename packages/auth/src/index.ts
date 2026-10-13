import type { UserRole } from '@void-monorepo/types';

export * from './permissions.js';

export interface AuthSessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthSession {
  user: AuthSessionUser;
  expires: string;
}

/**
 * Parse a bearer token from an Authorization header value.
 * Parses only; does not validate or verify the token.
 */
export function extractBearerToken(authHeader?: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(authHeader);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim() ?? '';
  return token ? token : null;
}

/**
 * Build an Authorization header value from a bearer token.
 * Round-trips with extractBearerToken and api-client usage.
 */
export function toAuthorizationHeader(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Check whether a session is expired.
 * Unparseable `expires` values fail closed (treated as expired).
 */
export function isSessionExpired(session: AuthSession, now: number = Date.now()): boolean {
  const expiresAt = Date.parse(session.expires);
  if (Number.isNaN(expiresAt)) {
    return true;
  }
  return expiresAt <= now;
}
