/**
 * Crew Coffee contract.
 *
 * The café storefront and the admin console are separate deployables that
 * talk to the coffee API over HTTP. Every DTO below is wire-shaped: dates are
 * ISO-8601 strings and money is integer cents.
 */

export type DrinkOrigin = 'hot' | 'iced';

export interface MenuItem {
  id: string;
  slug: string;
  name: string;
  origin: DrinkOrigin;
  priceCents: number;
  stock: number;
  defaultStock: number;
  /** SQLite boolean: 1 = visible on the café menu, 0 = hidden. */
  isActive: number;
}

export interface OrderLineInput {
  slug: string;
  qty: number;
}

export interface OrderLine {
  menuItemId: string;
  slug: string;
  name: string;
  qty: number;
  priceCents: number;
}

export interface Order {
  id: string;
  totalCents: number;
  status: 'paid' | 'pending';
  createdAt: string;
  items: OrderLine[];
}

export interface CheckoutResult {
  id: string;
  totalCents: number;
  createdAt: string;
}

export interface LowStockItem {
  slug: string;
  name: string;
  stock: number;
}

export interface Overview {
  revenueCents: number;
  orderCount: number;
  todayRevenueCents: number;
  todayOrderCount: number;
  activeMenuCount: number;
  lowStock: LowStockItem[];
  topCoffee: string | null;
  topCoffeeComputedAt: string | null;
}

export type CronTrigger = 'schedule' | 'manual';
export type CronRunStatus = 'success' | 'failed' | 'skipped';

export interface CronJob {
  name: string;
  path: string;
  expressions: string[];
  description: string;
}

export interface CronRun {
  id: string;
  jobName: string;
  cron: string;
  trigger: CronTrigger;
  status: CronRunStatus;
  startedAt: string;
  durationMs: number;
  itemsProcessed: number;
  error: string | null;
}

export interface CronStatus {
  jobs: CronJob[];
  runs: CronRun[];
  expressionCount: number;
  scheduleCount: number;
}

export interface MenuUpdate {
  priceCents?: number;
  stock?: number;
  defaultStock?: number;
  isActive?: 0 | 1;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorBody };

export class CoffeeApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CoffeeApiError';
    this.code = code;
    this.status = status;
  }
}

export interface CoffeeClientConfig {
  baseUrl: string;
  /** Required for `/api/admin/*`; the browser never sees it. */
  adminToken?: string;
  fetchFn?: typeof fetch;
}

export class CoffeeApiClient {
  private readonly baseUrl: string;
  private readonly adminToken?: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: CoffeeClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.adminToken = config.adminToken;
    const fetchFn = config.fetchFn ?? globalThis.fetch;
    // Workers' fetch throws "Illegal invocation" when called as an object
    // method. Wrap it so construction never rebinds `this`.
    this.fetchFn = ((input, init) => fetchFn(input, init)) as typeof fetch;
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (this.adminToken) headers.authorization = `Bearer ${this.adminToken}`;

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const error = extractError(parsed);
      throw new CoffeeApiError(
        response.status,
        error.code,
        error.message || `Coffee API request failed (${response.status})`,
      );
    }

    if (!parsed || typeof parsed !== 'object' || !('success' in parsed)) {
      throw new CoffeeApiError(response.status, 'BAD_RESPONSE', 'Coffee API returned an invalid body');
    }
    const envelope = parsed as ApiEnvelope<T>;
    if (!envelope.success) {
      throw new CoffeeApiError(response.status, envelope.error.code, envelope.error.message);
    }
    return envelope.data;
  }

  getMenu(): Promise<MenuItem[]> {
    return this.request('/api/menu');
  }

  checkout(items: OrderLineInput[]): Promise<CheckoutResult> {
    return this.request('/api/orders', { method: 'POST', body: { items } });
  }

  getOverview(): Promise<Overview> {
    return this.request('/api/admin/overview');
  }

  getOrders(limit = 50): Promise<Order[]> {
    return this.request(`/api/admin/orders?limit=${encodeURIComponent(String(limit))}`);
  }

  getAdminMenu(): Promise<MenuItem[]> {
    return this.request('/api/admin/menu');
  }

  updateMenuItem(id: string, patch: MenuUpdate): Promise<MenuItem> {
    return this.request(`/api/admin/menu/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
    });
  }

  getCronStatus(): Promise<CronStatus> {
    return this.request('/api/admin/crons');
  }

  runCron(name: string): Promise<CronRun> {
    return this.request(`/api/admin/crons/${encodeURIComponent(name)}/run`, { method: 'POST' });
  }
}

function extractError(parsed: unknown): ApiErrorBody {
  if (parsed && typeof parsed === 'object') {
    const maybe = parsed as { error?: unknown; message?: unknown };
    if (maybe.error && typeof maybe.error === 'object') {
      const error = maybe.error as { code?: unknown; message?: unknown };
      return {
        code: typeof error.code === 'string' ? error.code : 'REQUEST_FAILED',
        message: typeof error.message === 'string' ? error.message : '',
      };
    }
    if (typeof maybe.message === 'string') {
      return { code: 'REQUEST_FAILED', message: maybe.message };
    }
  }
  return { code: 'REQUEST_FAILED', message: '' };
}

export function createCoffeeClient(config: CoffeeClientConfig): CoffeeApiClient {
  return new CoffeeApiClient(config);
}
