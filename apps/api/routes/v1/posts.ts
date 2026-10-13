import { defineHandler } from 'void';
import { initialPosts } from '@void-monorepo/db/seed';

export const GET = defineHandler(async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (slug) {
    const post = initialPosts.find((p) => p.slug === slug);
    if (!post) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Post not found' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return { success: true, data: post };
  }

  return {
    success: true,
    data: initialPosts,
    meta: {
      timestamp: new Date().toISOString(),
      pagination: {
        page: 1,
        limit: 10,
        total: initialPosts.length,
        hasMore: false,
      },
    },
  };
});

export const POST = defineHandler(async ({ request }: { request: Request }) => {
  const body = (await request.json()) as { title?: string; slug?: string; content?: string };

  if (!body.title || !body.slug) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'BAD_REQUEST', message: 'Title and slug are required' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const newPost = {
    id: `post_${Date.now()}`,
    title: body.title,
    slug: body.slug,
    content: body.content || '',
    published: true,
    authorId: 'user_admin_01',
    viewCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    success: true,
    data: newPost,
  };
});
