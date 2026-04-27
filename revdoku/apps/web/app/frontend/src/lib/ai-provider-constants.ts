// Shared constants for the AI provider UI (Account → AI → Providers tab).

// Label shown in place of the add/rotate/remove controls when the instance
// does not allow per-account provider keys (BYOK). The underlying key in
// this state comes from the instance's ENV var configured by the operator,
// which we call a "built-in key" so users see that calls are working via
// the fleet-managed credential without exposing any details about it.
export const BUILT_IN_KEY_LABEL = 'Built-in key';

export const BUILT_IN_KEY_TOOLTIP =
  'This provider uses an instance-managed key. Per-account keys are not available on this deployment.';
