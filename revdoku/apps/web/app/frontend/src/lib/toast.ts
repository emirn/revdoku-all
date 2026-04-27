export type AppToastPayload = {
  message: string;
  type?: 'success' | 'error' | 'info';
  durationMs?: number;
  action?: { label: string; onClick: () => void };
};

export function showToast(message: string, type: AppToastPayload['type'] = 'success', durationMs = 2500, action?: AppToastPayload['action']) {
  const payload: AppToastPayload = { message, type, durationMs, action };
  document.dispatchEvent(new CustomEvent('app:toast', { detail: payload }));
}

