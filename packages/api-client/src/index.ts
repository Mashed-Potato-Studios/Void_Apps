import type {
  ApiResponse,
  Post,
  AiCompletionRequest,
  AiCompletionResponse,
} from '@void-monorepo/types';

export interface VoidClientConfig {
  baseUrl: string;
  authToken?: string;
  fetchFn?: typeof fetch;
}

export type CreatePostInput = Pick<Post, 'title' | 'content' | 'slug'>;

export interface GetPostsParams {
  page?: number;
  limit?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class VoidApiClient {
  private baseUrl: string;
  private authToken?: string;
  private fetchFn: typeof fetch;

  constructor(config: VoidClientConfig) {
    if (!config.baseUrl || typeof config.baseUrl !== 'string' || config.baseUrl.trim() === '') {
      throw new TypeError('baseUrl must be a non-empty string');
    }
    try {
      new URL(config.baseUrl);
    } catch {
      throw new TypeError(`Invalid baseUrl: ${config.baseUrl}`);
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.authToken = config.authToken;
    const fetchFn = config.fetchFn ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new TypeError('fetch is not available; provide config.fetchFn');
    }
    this.fetchFn = fetchFn;
  }

  setAuthToken(token?: string): void {
    this.authToken = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    if (!path.startsWith('/')) {
      throw new TypeError(`path must start with '/': ${path}`);
    }

    const headers = new Headers(options.headers ?? {});
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.authToken) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...options,
        headers,
      });
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: unknown;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      const record = isRecord(errorData) ? errorData : { body: errorData };
      const message =
        typeof record.message === 'string' && record.message !== ''
          ? record.message
          : response.statusText;
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message,
          details: record,
        },
      };
    }

    if (response.status === 204) {
      return { success: true, data: undefined as T };
    }

    try {
      return (await response.json()) as ApiResponse<T>;
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // Health Endpoint
  async getHealth(): Promise<ApiResponse<{ status: string; uptime: number; timestamp: string }>> {
    return this.request('/api/health');
  }

  // Posts API Endpoints
  async getPosts(params?: GetPostsParams): Promise<ApiResponse<Post[]>> {
    const query = new URLSearchParams();
    if (params?.page !== undefined) query.set('page', String(params.page));
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request(`/api/v1/posts${qs ? `?${qs}` : ''}`);
  }

  async getPostBySlug(slug: string): Promise<ApiResponse<Post>> {
    if (!slug || slug.trim() === '') {
      throw new TypeError('slug must be a non-empty string');
    }
    return this.request(`/api/v1/posts?slug=${encodeURIComponent(slug)}`);
  }

  async createPost(post: CreatePostInput): Promise<ApiResponse<Post>> {
    return this.request('/api/v1/posts', {
      method: 'POST',
      body: JSON.stringify(post),
    });
  }

  // Workers AI Endpoint
  async generateAiCompletion(request: AiCompletionRequest): Promise<ApiResponse<AiCompletionResponse>> {
    return this.request('/api/v1/ai', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }
}

export function createVoidClient(config: VoidClientConfig): VoidApiClient {
  return new VoidApiClient(config);
}
