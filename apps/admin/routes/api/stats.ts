import { defineHandler } from 'void';
import { initialUsers, initialPosts } from '@void-monorepo/db';

export const GET = defineHandler(async () => {
  return {
    success: true,
    data: {
      users: initialUsers.length,
      posts: initialPosts.length,
      uptimeSeconds: process.uptime ? process.uptime() : 120,
      timestamp: new Date().toISOString(),
    },
  };
});
