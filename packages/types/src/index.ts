/**
 * @void-monorepo/types
 * Shared TypeScript definitions, domain models, and queue/cron event schemas.
 */

// Domain Roles & Permissions
export type UserRole = 'admin' | 'editor' | 'member' | 'guest';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
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
  createdAt: string;
  updatedAt: string;
}

// API Payloads & Common Responses
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };
  };
}

// Cloudflare Queues Message Schemas
export interface EmailQueuePayload {
  to: string;
  subject: string;
  template: 'welcome' | 'password-reset' | 'notification' | 'newsletter';
  variables: Record<string, string | number>;
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
  model?: string;
  temperature?: number;
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
