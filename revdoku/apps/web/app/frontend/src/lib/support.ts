// Customer-facing support contact. Empty by default; deployments inject
// an address via Vite's VITE_SUPPORT_EMAIL env var at build time.
// Components that render a support link should guard on
// `SUPPORT_EMAIL.length > 0` so the link disappears when no inbox is set.
export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || '';
export const SUPPORT_MAILTO = SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=Issue` : '';
