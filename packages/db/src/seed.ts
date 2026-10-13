import * as schema from './schema';

/**
 * Seed data for development and initial environments
 */
export const initialUsers = [
  {
    id: 'user_admin_01',
    name: 'Void Admin',
    email: 'admin@void.app',
    emailVerified: true,
    role: 'admin' as const,
  },
  {
    id: 'user_demo_02',
    name: 'Alex Developer',
    email: 'alex@example.com',
    emailVerified: true,
    role: 'member' as const,
  },
];

export const initialPosts = [
  {
    id: 'post_01',
    title: 'Deploying at Warp Speed with Void Cloud',
    slug: 'deploying-at-warp-speed-with-void-cloud',
    content: 'Void is the Vite-native edge deployment platform and isomorphic backend SDK.',
    published: true,
    authorId: 'user_admin_01',
    viewCount: 142,
  },
  {
    id: 'post_02',
    title: 'Code is Your Infra: Zero-Config Bindings',
    slug: 'code-is-your-infra',
    content: 'With Void, simply import void/db or void/ai, and the platform provisions required resources.',
    published: true,
    authorId: 'user_admin_01',
    viewCount: 88,
  },
];
