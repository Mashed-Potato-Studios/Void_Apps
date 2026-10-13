import type { UserRole } from '@void-monorepo/types';

export type Permission =
  | 'posts:create'
  | 'posts:edit'
  | 'posts:delete'
  | 'posts:publish'
  | 'users:manage'
  | 'settings:manage'
  | 'analytics:view';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'posts:create',
    'posts:edit',
    'posts:delete',
    'posts:publish',
    'users:manage',
    'settings:manage',
    'analytics:view',
  ],
  editor: [
    'posts:create',
    'posts:edit',
    'posts:publish',
    'analytics:view',
  ],
  member: [
    'posts:create',
  ],
  guest: [],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return permissions.includes(permission);
}

export function canManageUsers(role: UserRole): boolean {
  return hasPermission(role, 'users:manage');
}

export function assertPermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    const error = new Error('FORBIDDEN') as Error & { code: string };
    error.code = 'FORBIDDEN';
    throw error;
  }
}

export const requirePermission = assertPermission;
