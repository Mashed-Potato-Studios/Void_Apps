export * from './permissions';

export interface AuthSessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'member' | 'guest';
}

export interface AuthSession {
  user: AuthSessionUser;
  expires: string;
}

/**
 * Helper to validate auth headers or bearer tokens in Void middleware / routes
 */
export function extractBearerToken(authHeader?: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
}
