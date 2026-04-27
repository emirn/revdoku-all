// API configuration for Rails backend integration
// Uses HttpOnly cookies for security - browser sends them automatically

export interface SecurityConfig {
  security_level: string;  // "low" | "high"
  hipaa_enabled: boolean;
  session_ttl_seconds: number;
  idle_timeout_seconds: number;
  requires_2fa: boolean;
  user_2fa_enabled: boolean;
  full_audit_logging: boolean;
  audit_retention_days: number;
}

export interface FeaturesConfig {
  diff_viewer: boolean;
  batch_review: boolean;
  api_key_management: boolean;
  per_page_view: boolean;
  sessions_management: boolean;
  checklist_versions: boolean;
  one_time_credits: boolean;
  // Optional feature flag — undefined is falsy so the Review dialog's
  // credit block stays hidden when not declared.
  show_review_credits?: boolean;
}

export interface LimitsConfig {
  maxFileSize: number;
  maxFileSizeMb: number;
  maxEnvelopeSize: number;
  maxEnvelopeSizeMb: number;
}

export interface LegalUrlsConfig {
  terms?: string | null;
  privacy?: string | null;
  source_code?: string | null;
}

export interface ApiConfig {
  baseUrl: string;
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    name: string;
  };
  account?: {
    id: string;
    name: string;
    personal: boolean;
  };
  accounts?: Array<{
    id: string;
    name: string;
    personal: boolean;
  }>;
  security?: SecurityConfig;
  limits?: LimitsConfig;
  features?: FeaturesConfig;
  appVersion?: string;
  appRevision?: string;
  legal?: LegalUrlsConfig;
}

let apiConfig: ApiConfig | null = null;
let refreshTimerId: ReturnType<typeof setInterval> | null = null;

export async function getApiConfig(): Promise<ApiConfig> {
  if (apiConfig) return apiConfig;

  try {
    // fetch from Rails manifest endpoint
    const response = await fetch('/envelopes/manifest', {
      credentials: 'include' // Include HttpOnly cookies
    });
    const manifest = await response.json();
    apiConfig = {
      baseUrl: manifest.api.baseUrl,
      authenticated: manifest.authenticated ?? false,
      user: manifest.user,
      account: manifest.account,
      accounts: manifest.accounts,
      security: manifest.security,
      limits: manifest.limits,
      features: manifest.features,
      appVersion: manifest.appVersion,
      appRevision: manifest.appRevision,
      legal: manifest.legal
    };

    if (apiConfig.authenticated) {
      startTokenRefreshTimer();
    }
  } catch (error) {
    console.error('Failed to load API configuration:', error);
    throw new Error('Failed to load API configuration');
  }

  return apiConfig;
}

// Check if user is authenticated (based on manifest response)
export async function isAuthenticated(): Promise<boolean> {
  const config = await getApiConfig();
  return config.authenticated;
}

// Clear cached config (useful after logout or session change)
export function clearApiConfigCache(): void {
  apiConfig = null;
  stopTokenRefreshTimer();
}

// Refresh the session token via backend endpoint
async function refreshToken(): Promise<boolean> {
  try {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.ok;
  } catch {
    return false;
  }
}

const DEFAULT_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function getTokenRefreshInterval(): number {
  const idleTimeout = apiConfig?.security?.idle_timeout_seconds;
  if (idleTimeout && idleTimeout < 3600) {
    // High security: refresh at 2/3 of idle timeout to stay ahead of expiry
    return Math.floor(idleTimeout * 1000 * 2 / 3);
  }
  return DEFAULT_REFRESH_INTERVAL;
}

function startTokenRefreshTimer(): void {
  stopTokenRefreshTimer();
  const interval = getTokenRefreshInterval();
  refreshTimerId = setInterval(async () => {
    const success = await refreshToken();
    if (!success) {
      stopTokenRefreshTimer();
      redirectToLogin();
    }
  }, interval);
}

function stopTokenRefreshTimer(): void {
  if (refreshTimerId !== null) {
    clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
}

function redirectToLogin(): void {
  clearApiConfigCache();
  window.location.href = '/users/sign_in';
}

async function getFullEndpointUrl(endpoint: string): Promise<string> {
  const config = await getApiConfig();

  // Normalize base + endpoint to exactly one slash between
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  if (base) {
    return `${base}${path}`;
  } else {
    return path;
  }
}

export async function apiJsonResponse<T>(response: Response): Promise<T> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Failed to parse JSON response (status ${response.status})`);
  }
  if (json && typeof json === 'object' && 'data' in json) {
    return (json as Record<string, unknown>).data as T;
  }
  return json as T;
}

// Endpoints that should not trigger the global save indicator
const SAVE_INDICATOR_EXCLUDE = ['/auth/refresh', '/export', '/status', '/manifest'];

export async function apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
  // Check authentication status first
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    throw new Error('Not authenticated - please log in');
  }

  // Construct URL - if baseUrl is empty, endpoint should be a full path starting with /
  const url = await getFullEndpointUrl(endpoint);
  const headers = new Headers(options.headers);

  // Note: No Authorization header needed - browser sends HttpOnly cookie automatically

  // Check if we should skip setting Content-Type (for file uploads)
  const skipContentType = headers.get('X-Skip-Content-Type');
  if (skipContentType) {
    headers.delete('X-Skip-Content-Type');
  }

  // Ensure JSON content type for POST/PUT requests (unless skipped)
  if (!skipContentType && (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH') && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const isMutation = options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH' || options.method === 'DELETE';
  const shouldTrack = isMutation && !SAVE_INDICATOR_EXCLUDE.some(ex => endpoint.includes(ex));

  if (shouldTrack) {
    document.dispatchEvent(new CustomEvent('api:save:start'));
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include' // Browser sends HttpOnly cookie automatically
  });

  if (shouldTrack) {
    if (response.ok) {
      document.dispatchEvent(new CustomEvent('api:save:end'));
    } else {
      document.dispatchEvent(new CustomEvent('api:save:error'));
    }
  }

  // Clear the 403 redirect-loop guard on any successful response
  if (response.ok) {
    sessionStorage.removeItem('__revdoku_account_error_signout');
  }

  // On 401, redirect to login
  if (response.status === 401) {
    redirectToLogin();
  }

  // On 403 with unrecoverable account errors, sign out to clear stale session.
  // Guard with sessionStorage to prevent infinite redirect loops: if sign-out
  // doesn't fix the account issue, the second attempt shows the error normally.
  if (response.status === 403) {
    try {
      const cloned = response.clone();
      const body = await cloned.json();
      const msg = (typeof body?.error === 'object' ? body.error.message : body?.error) || body?.message || '';
      if (typeof msg === 'string' && (msg.includes('not a member') || msg.includes('No valid account'))) {
        const guardKey = '__revdoku_account_error_signout';
        if (!sessionStorage.getItem(guardKey)) {
          sessionStorage.setItem(guardKey, '1');
          // Devise sign_out requires DELETE; submit a hidden form with CSRF token
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/users/sign_out';
          const methodInput = document.createElement('input');
          methodInput.type = 'hidden';
          methodInput.name = '_method';
          methodInput.value = 'delete';
          form.appendChild(methodInput);
          const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
          if (csrfToken) {
            const csrfInput = document.createElement('input');
            csrfInput.type = 'hidden';
            csrfInput.name = 'authenticity_token';
            csrfInput.value = csrfToken;
            form.appendChild(csrfInput);
          }
          document.body.appendChild(form);
          form.submit();
        }
      }
    } catch {
      // ignore parse errors — let the 403 propagate normally
    }
  }

  return response;
}
