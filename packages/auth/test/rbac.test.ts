import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBearerToken,
  toAuthorizationHeader,
  isSessionExpired,
  hasPermission,
  assertPermission,
  requirePermission,
  type Permission,
} from '../src/index.ts';
import type { UserRole } from '@void-monorepo/types';

describe('extractBearerToken', () => {
  it('returns token for a standard header', () => {
    assert.equal(extractBearerToken('Bearer abc123'), 'abc123');
  });

  it('returns null for missing header', () => {
    assert.equal(extractBearerToken(undefined), null);
    assert.equal(extractBearerToken(null), null);
    assert.equal(extractBearerToken(''), null);
  });

  it('returns null for empty token after trim', () => {
    assert.equal(extractBearerToken('Bearer '), null);
    assert.equal(extractBearerToken('Bearer    '), null);
    assert.equal(extractBearerToken('Bearer \t '), null);
  });

  it('accepts lowercase scheme', () => {
    assert.equal(extractBearerToken('bearer abc123'), 'abc123');
    assert.equal(extractBearerToken('BEARER abc123'), 'abc123');
  });

  it('accepts leading whitespace', () => {
    assert.equal(extractBearerToken('   Bearer abc123'), 'abc123');
    assert.equal(extractBearerToken('\tBearer abc123  '), 'abc123');
  });

  it('rejects non-bearer schemes', () => {
    assert.equal(extractBearerToken('Basic abc123'), null);
    assert.equal(extractBearerToken('Token abc123'), null);
    assert.equal(extractBearerToken('Bearer'), null);
  });
});

describe('toAuthorizationHeader round-trip', () => {
  it('round-trips with extractBearerToken', () => {
    const header = toAuthorizationHeader('tok_123');
    assert.equal(header, 'Bearer tok_123');
    assert.equal(extractBearerToken(header), 'tok_123');
  });
});

describe('isSessionExpired', () => {
  const user = { id: 'u1', email: 'a@b.c', name: 'A', role: 'member' as UserRole };

  it('detects past and future expiry', () => {
    assert.equal(
      isSessionExpired({ user, expires: new Date(Date.now() - 1000).toISOString() }),
      true,
    );
    assert.equal(
      isSessionExpired({ user, expires: new Date(Date.now() + 60_000).toISOString() }),
      false,
    );
  });

  it('respects explicit now parameter', () => {
    const expires = '2026-01-01T00:00:00.000Z';
    assert.equal(isSessionExpired({ user, expires }, Date.parse(expires) - 1), false);
    assert.equal(isSessionExpired({ user, expires }, Date.parse(expires)), true);
  });

  it('fails closed on unparseable expires', () => {
    assert.equal(isSessionExpired({ user, expires: 'not-a-date' }), true);
    assert.equal(isSessionExpired({ user, expires: '' }), true);
  });
});

describe('RBAC matrix', () => {
  const roles: UserRole[] = ['admin', 'editor', 'member', 'guest'];
  const permissions: Permission[] = [
    'posts:create',
    'posts:edit',
    'posts:delete',
    'posts:publish',
    'users:manage',
    'settings:manage',
    'analytics:view',
  ];

  it('matches snapshot', () => {
    const matrix = Object.fromEntries(
      roles.map((role) => [
        role,
        Object.fromEntries(permissions.map((perm) => [perm, hasPermission(role, perm)])),
      ]),
    );
    assert.deepEqual(matrix, {
      admin: {
        'posts:create': true,
        'posts:edit': true,
        'posts:delete': true,
        'posts:publish': true,
        'users:manage': true,
        'settings:manage': true,
        'analytics:view': true,
      },
      editor: {
        'posts:create': true,
        'posts:edit': true,
        'posts:delete': false,
        'posts:publish': true,
        'users:manage': false,
        'settings:manage': false,
        'analytics:view': true,
      },
      member: {
        'posts:create': true,
        'posts:edit': false,
        'posts:delete': false,
        'posts:publish': false,
        'users:manage': false,
        'settings:manage': false,
        'analytics:view': false,
      },
      guest: {
        'posts:create': false,
        'posts:edit': false,
        'posts:delete': false,
        'posts:publish': false,
        'users:manage': false,
        'settings:manage': false,
        'analytics:view': false,
      },
    });
  });

  it('fails closed for unknown roles', () => {
    const unknown = 'superadmin' as UserRole;
    for (const perm of permissions) {
      assert.equal(hasPermission(unknown, perm), false);
    }
    assert.throws(() => assertPermission(unknown, 'posts:create'), /FORBIDDEN/);
  });

  it('assertPermission passes when allowed, throws FORBIDDEN when denied', () => {
    assert.doesNotThrow(() => assertPermission('admin', 'users:manage'));
    assert.throws(() => assertPermission('member', 'users:manage'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'FORBIDDEN');
      assert.equal((error as Error & { code?: string }).code, 'FORBIDDEN');
      return true;
    });
  });

  it('requirePermission is an alias of assertPermission', () => {
    assert.equal(requirePermission, assertPermission);
  });
});
