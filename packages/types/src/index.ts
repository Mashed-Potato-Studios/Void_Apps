/**
 * @void-monorepo/types
 * Shared TypeScript definitions, domain models, and queue/cron event schemas.
 *
 * Date convention: DTOs use ISO-8601 strings on the wire (`createdAt: string`).
 * DB rows use `Date` objects (Drizzle `timestamp` mode). Map at the boundary
 * (`date.toISOString()` out, `new Date(s)` in). See README.md.
 */

/**
 * Single source of truth for user roles.
 * `UserRole` is derived from this const so runtime + type stay in sync.
 * Mirrors the `role` enum in `packages/db/src/schema/users.ts`.
 */
export const USER_ROLES = ['admin', 'editor', 'member', 'guest'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
  /**
   * Wire/DTO name for the avatar URL.
   * Maps to the `image` column in `packages/db/src/schema/users.ts`.
   * NOT renamed (would break consumers); map at the boundary:
   * `avatarUrl <-> image`.
   */
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  published: boolean;
  authorId: string;
  /** Mirrors `view_count` in DB (`notNull`, default 0). */
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Payload for `POST /api/v1/posts`. */
export type CreatePostRequest = Pick<Post, 'title' | 'slug' | 'content'>;

/** Shape returned by `GET /api/health`. */
export interface HealthStatus {
  status: string;
  uptime: number;
  timestamp: string;
}

// API Payloads & Common Responses
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ApiMeta {
  timestamp: string;
  requestId?: string;
  pagination?: Pagination;
}

/**
 * Generic envelope. Kept as-is (non-discriminated) to avoid breaking consumers.
 *
 * Migration path (future, breaking): switch to a discriminated union so
 * success/error are mutually exclusive:
 * `type ApiResult<T> = { success: true; data: T; meta?: ApiMeta } | { success: false; error: ApiError; meta?: ApiMeta }`
 * Keep `ApiResponse` until all consumers migrate.
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

// Cloudflare Queues Message Schemas
export interface EmailQueuePayload {
  to: string;
  subject: string;
  template: 'welcome' | 'password-reset' | 'notification' | 'newsletter';
  variables: Record<string, string | number | boolean | null | undefined>;
  priority?: 'high' | 'normal' | 'low';
}

export interface AnalyticsQueuePayload {
  eventName: string;
  userId?: string;
  anonymousId?: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

export type QueueMessage =
  | { type: 'email.send'; payload: EmailQueuePayload }
  | { type: 'analytics.track'; payload: AnalyticsQueuePayload };

// Cron Job Execution Types
export interface CronExecutionResult {
  jobName: string;
  scheduledTime: string;
  durationMs: number;
  status: 'success' | 'failed' | 'skipped';
  itemsProcessed?: number;
  error?: string;
}

// AI Service Request/Response
export interface AiCompletionRequest {
  prompt: string;
  systemPrompt?: string;
  /**
   * Model ID. Defaults to `@cf/meta/llama-3-8b-instruct` (see `apps/api/routes/v1/ai.ts`).
   */
  model?: string;
  /**
   * Sampling temperature. Expected range 0–2 (route-owned validation;
   * no runtime check in types).
   */
  temperature?: number;
  /**
   * Max completion tokens. Expected range 1–4096 (route-owned validation;
   * no runtime check in types).
   */
  maxTokens?: number;
}

export interface AiCompletionResponse {
  result: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
