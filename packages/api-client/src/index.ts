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

export class VoidApiClient {
  private baseUrl: string;
  private authToken?: string;
  private fetchFn: typeof fetch;

  constructor(config: VoidClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.authToken = config.authToken;
    this.fetchFn = config.fetchFn || globalThis.fetch;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    if (this.authToken) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData.message || response.statusText,
          details: errorData,
        },
      };
    }

    return (await response.json()) as ApiResponse<T>;
  }

  // Health Endpoint
  async getHealth(): Promise<ApiResponse<{ status: string; uptime: number; timestamp: string }>> {
    return this.request('/api/health');
  }

  // Posts API Endpoints
  async getPosts(): Promise<ApiResponse<Post[]>> {
    return this.request('/api/v1/posts');
  }

  async getPostBySlug(slug: string): Promise<ApiResponse<Post>> {
    return this.request(`/api/v1/posts?slug=${encodeURIComponent(slug)}`);
  }

  async createPost(post: { title: string; content: string; slug: string }): Promise<ApiResponse<Post>> {
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
