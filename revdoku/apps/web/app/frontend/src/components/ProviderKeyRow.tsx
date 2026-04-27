import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiClient } from '@/lib/api-client';
import { BUILT_IN_KEY_LABEL, BUILT_IN_KEY_TOOLTIP } from '@/lib/ai-provider-constants';
import { starRating } from '@revdoku/lib';

// Strip the "<region>:<provider>:" prefix from a catalog id to get the
// sub-provider name doc-api actually sends to the upstream SDK. The
// catalog uses 3-segment ids of the form "<region>:<provider>:<model>"; the
// region segment may be empty (e.g. "::openai:gpt-4.1-…"). Splitting on the
// first two colons recovers the api_name and keeps any further colons
// (e.g. "openai/gpt-4.1") intact.
function subProviderId(catalogId: string): string {
  const parts = catalogId.split(':');
  if (parts.length < 3) return catalogId;
  return parts.slice(2).join(':');
}

// Per-provider Test button. Fires one 1-token AI call against the
// provider's saved or default model to verify the key + model id reach
// the upstream successfully. The result auto-clears after 8s so the row
// returns to its idle state.
function TestKeyButton({ providerKey, disabled, disabledTooltip }: {
  providerKey: string;
  disabled?: boolean;
  disabledTooltip?: string;
}) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [servedModel, setServedModel] = useState<string | null>(null);

  useEffect(() => {
    if (state !== 'ok' && state !== 'failed') return;
    const t = setTimeout(() => { setState('idle'); setMessage(null); setServedModel(null); }, 8000);
    return () => clearTimeout(t);
  }, [state]);

  const run = async () => {
    setState('testing');
    setMessage(null);
    setServedModel(null);
    const result = await ApiClient.testProviderKey(providerKey);
    if (result.ok) {
      setState('ok');
      setServedModel(result.served_model || null);
    } else {
      setState('failed');
      setMessage(result.message || 'Test failed.');
    }
  };

  const buttonTitle = disabled
    ? (disabledTooltip || 'Add a key first.')
    : 'Sends a 1-token request to the provider to verify the key. Minimal cost.';

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={disabled || state === 'testing'}
        title={buttonTitle}
      >
        {state === 'testing' ? 'Testing…' : 'Test'}
      </Button>
      {state === 'ok' && (
        <span className="text-[11px] text-green-700 dark:text-green-400" title={servedModel ? `served: ${servedModel}` : undefined}>
          ✓ Key works{servedModel ? ` (served: ${servedModel})` : ''}
        </span>
      )}
      {state === 'failed' && (
        <span className="text-[11px] text-red-700 dark:text-red-400" title={message || undefined}>
          ✗ {(message || 'Test failed.').slice(0, 80)}{(message || '').length > 80 ? '…' : ''}
        </span>
      )}
    </div>
  );
}

export interface ProviderKeyRowProps {
  providerKey: string;           // "openai" | "google_cloud" | "aws_bedrock" | "custom_llm_1" | …
  providerName: string;          // "OpenAI" / "Google Cloud" / "Custom LLM 1" / …
  source: 'account' | 'env' | 'none';
  available: boolean;
  hipaaEligible: boolean;
  modelCount: number;
  // Instance-wide BYOK gate. When false, the row never shows the Add-key /
  // Rotate / Remove controls regardless of per-provider `byok`.
  byokEnabled: boolean;
  // Instance-wide gate for `custom: true` providers (`byok_customizable`
  // flag). When false, custom-provider rows still render but their base_url
  // / models / preset editor block stays hidden — operator-managed deploys
  // (multi-tenant cloud) flip this off to close the SSRF surface a tenant-
  // supplied base_url would open.
  customizableEnabled: boolean;
  // Per-provider permissions from the catalog. Both default to false in YAML;
  // a row must explicitly opt in for the corresponding UI to render.
  //   byok    — owner may store their own API key for this provider.
  //   custom  — owner may override base_url AND maintain a per-account
  //             models list. Implies the custom-LLM editor block.
  byok: boolean;
  custom: boolean;
  // Per-account key state (null when this account hasn't configured one;
  // may still be available via env fallback — see `source`).
  accountKey: {
    enabled: boolean;
    keySuffix: string | null;
  } | null;
  // Provider-relative model list (full provider:api ids). Used to populate
  // the expanded models view shown when the user clicks the row header.
  // Empty when the provider ships no catalog entries (e.g. an account
  // stored a key for a custom provider not declared in the YAML).
  models: Array<{
    id: string;
    name: string;
    stars?: number;
    hipaa?: boolean;
    description?: string;
    max_pages?: number;
    credits_per_page?: number;
  }>;
  // Account's chosen sub-provider model id (e.g. "gpt-4.1-2025-04-14"); null
  // when the owner hasn't picked one.
  modelId: string | null;
  // Catalog's provider-level default sub-provider model id; used as the UI
  // fallback when modelId is null.
  defaultModelId: string | null;
  // Custom-only: the account's base_url override + the catalog default shown
  // as placeholder. Ignored for non-custom providers.
  baseUrl: string | null;
  defaultBaseUrl: string | null;
  // Custom-only: user-defined model list. Rendered as a structured add /
  // remove editor; each row carries `alias` (picker label, account-scoped
  // identifier — uniqueness validated server-side) and `model_id` (the
  // upstream API model name sent verbatim to the SDK), plus an optional
  // preset key.
  customModels: Array<{ alias: string; model_id: string; revdoku_options?: string | null; stars?: number }>;
  // Catalog's list of available presets (from /api/v1/ai_models). Populates
  // the per-row preset dropdown for each user-defined model. Empty array is
  // fine — the dropdown renders just "(none)" and the feature is a no-op.
  revdokuOptionPresets: Array<{ key: string; desc: string | null }>;
  // Map of full model id ("any:openai:gpt-4.1-…") → list of alias display
  // names that target this model. Used to render alias chips next to each
  // model in the expanded provider list. Click on a chip switches the
  // /account/ai page to the Aliases tab.
  aliasesByModelId?: Map<string, string[]>;
  onSwitchToAliases?: () => void;
  onChanged: () => void;
}

/**
 * One-row-per-provider widget. Two independent permission axes from the
 * catalog (`byok:` / `custom:` in ai_models.yml) drive what the owner can
 * change here:
 *   byok=true   → Add-key / Rotate / Remove controls (also gated by the
 *                 instance `byok_enabled` flag)
 *   custom=true → base_url + per-account models editor (also gated by the
 *                 instance `byok_customizable` flag)
 * Keys are stored encrypted per-account in Account#ai_provider_keys.
 */
export default function ProviderKeyRow({
  providerKey,
  providerName,
  source,
  available,
  hipaaEligible,
  modelCount,
  byokEnabled,
  customizableEnabled,
  byok,
  custom,
  accountKey,
  models,
  modelId: _modelId,
  defaultModelId: _defaultModelId,
  baseUrl,
  defaultBaseUrl,
  customModels,
  revdokuOptionPresets,
  aliasesByModelId,
  onSwitchToAliases,
  onChanged,
}: ProviderKeyRowProps) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Click-to-expand on non-custom rows. Custom rows have their own
  // editor block and stay always-rendered when expanded; the chevron +
  // expanded list also fire for cloud providers (Google Cloud, AWS
  // Bedrock, OpenRouter, OpenAI) so users can preview which models the
  // provider serves.
  const [expanded, setExpanded] = useState(false);

  // Custom-provider inline editors. Saved independently of the key via
  // PATCH so operators don't have to re-enter the key to change base_url.
  const [baseUrlDraft, setBaseUrlDraft] = useState(baseUrl ?? '');
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  // Structured per-row model editor. Each entry is { alias, model_id,
  // revdoku_options }. The editor opens EMPTY when the account has no
  // saved models — auto-seeding a placeholder row ("my-model" / "mymodel")
  // misled users into thinking the provider was configured before they'd
  // ever clicked Save. Rows missing alias OR model_id are dropped on save
  // (see saveCustomSettings).
  type DraftModel = { alias: string; model_id: string; revdoku_options: string };
  const seedRow = (): DraftModel => ({ alias: '', model_id: '', revdoku_options: '' });
  const [draftModels, setDraftModels] = useState<DraftModel[]>(
    () => customModels.map((m) => ({ alias: m.alias, model_id: m.model_id, revdoku_options: (m.revdoku_options ?? '') }))
  );

  // Keep the local draft in sync when the server-fetched prop changes (for
  // instance after `onChanged()` triggers a refresh). Without this effect,
  // React holds on to the initial useState value forever — so a fresh save
  // can get overwritten by a stale draft on the next render.
  useEffect(() => { setBaseUrlDraft(baseUrl ?? ''); }, [baseUrl]);
  useEffect(() => {
    setDraftModels(
      customModels.map((m) => ({ alias: m.alias, model_id: m.model_id, revdoku_options: (m.revdoku_options ?? '') }))
    );
  }, [customModels]);
  const [localSaving, setLocalSaving] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);

  const addModelRow = () =>
    setDraftModels((rows) => [...rows, seedRow()]);
  const removeModelRow = (idx: number) =>
    setDraftModels((rows) => rows.filter((_, i) => i !== idx));
  const updateModelRow = (idx: number, patch: Partial<DraftModel>) =>
    setDraftModels((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const hasAccountKey = !!accountKey;

  const save = async () => {
    if (!apiKey.trim()) { setError('Key is required'); return; }
    setBusy(true);
    setError(null);
    try {
      if (hasAccountKey) {
        await ApiClient.updateProviderKey(providerKey, { api_key: apiKey });
      } else {
        await ApiClient.addProviderKey(providerKey, apiKey);
      }
      setEditing(false);
      setApiKey('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove your ${providerName} key? The account will fall back to the shared key (if configured).`)) return;
    setBusy(true);
    setError(null);
    try {
      await ApiClient.removeProviderKey(providerKey);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusy(false);
    }
  };

  // Persist base_url + user-defined model list together. Sent as a
  // structured `models:` array (each row carries its own preset) so the
  // controller doesn't have to re-parse a CSV — the per-row preset choice
  // sticks even when rows have different families (e.g. one Gemma, one
  // generic OpenAI-compat).
  const saveCustomSettings = async () => {
    // Base URL is required. The catalog default (http://localhost:1234/v1)
    // only works for LM Studio running on the same host — anyone else
    // needs to be explicit. Models with empty ids are dropped on save;
    // the provider just won't appear in the picker until at least one
    // non-empty id remains.
    const trimmedUrl = baseUrlDraft.trim();
    if (trimmedUrl.length === 0) {
      setBaseUrlError('Base URL is required (e.g. http://localhost:1234/v1 for LM Studio, http://localhost:11434/v1 for Ollama, or the full URL of a remote endpoint).');
      return;
    }
    setBaseUrlError(null);
    setLocalSaving(true);
    setError(null);
    try {
      const cleaned = draftModels
        .map((m) => ({ alias: m.alias.trim(), model_id: m.model_id.trim(), revdoku_options: m.revdoku_options.trim() }))
        // Drop rows missing either field. Server-side validation also
        // catches alias collisions / format issues and surfaces them via
        // a 422 — the catch block below renders the message inline.
        .filter((m) => m.alias.length > 0 && m.model_id.length > 0)
        .map((m) => ({
          alias: m.alias,
          model_id: m.model_id,
          ...(m.revdoku_options ? { revdoku_options: m.revdoku_options } : {}),
        }));
      const patch: Parameters<typeof ApiClient.updateProviderKey>[1] = {
        base_url: trimmedUrl,
        models: cleaned,
      };
      // eslint-disable-next-line no-console
      console.log('[ProviderKeyRow] saveCustomSettings patch →', providerKey, patch);
      const resp = await ApiClient.updateProviderKey(providerKey, patch);
      // eslint-disable-next-line no-console
      console.log('[ProviderKeyRow] saveCustomSettings response ←', providerKey, resp);
      setLocalSaved(true);
      setTimeout(() => setLocalSaved(false), 2000);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save custom-provider settings');
    } finally {
      setLocalSaving(false);
    }
  };

  // Status chip. When BYOK is disabled on the instance, surface the
  // Built-in key chip if the provider is reachable via env, otherwise
  // "Not configured". No "Your key" / "Built-in key" split — users on
  // this deployment cannot bring their own key, so we skip nuance that
  // implies they could.
  const statusChip = (() => {
    if (!byokEnabled) {
      return available
        ? { text: BUILT_IN_KEY_LABEL, color: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300', tooltip: BUILT_IN_KEY_TOOLTIP }
        : { text: 'Not configured', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', tooltip: undefined };
    }
    if (source === 'account') return { text: 'Your key', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', tooltip: undefined };
    if (source === 'env') return { text: BUILT_IN_KEY_LABEL, color: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300', tooltip: BUILT_IN_KEY_TOOLTIP };
    return { text: 'Not configured', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', tooltip: undefined };
  })();

  // Every provider row is collapsible. Non-custom providers expand to
  // show the catalog model list; custom providers (when the instance
  // permits it) expand to show the editor (Base URL / Models / Preset).
  // Empty-catalog non-custom providers (rare — e.g. an account stored a
  // key for a custom provider not declared in the YAML) skip the chevron
  // since there's nothing to reveal.
  const showCustomEditor = custom && customizableEnabled;
  const expandable = showCustomEditor || models.length > 0;

  // Aliases that target ANY model on this provider, deduped + ordered by
  // first appearance. Powers the "used by …" chip strip on the collapsed
  // header so users see which built-in aliases depend on this provider's
  // key without expanding the row. Click switches to the Aliases tab.
  const providerAliasNames: string[] = (() => {
    if (!aliasesByModelId) return [];
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const m of models) {
      const names = aliasesByModelId.get(m.id) || [];
      for (const n of names) {
        if (!seen.has(n)) { seen.add(n); ordered.push(n); }
      }
    }
    return ordered;
  })();
  // Rendered as a sibling row below the header — NOT inside the
  // expandable header `<button>` (nested interactive elements are
  // invalid HTML).
  const renderProviderAliasChips = () => {
    if (providerAliasNames.length === 0) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap mt-2 pl-5">
        <span className="text-[10px] text-muted-foreground">used by:</span>
        {providerAliasNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={onSwitchToAliases}
            title="Open Aliases tab"
            className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900 cursor-pointer"
          >
            {name}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="border border-border rounded-md p-3">
      <div className="flex items-center gap-3 min-w-0">
        {expandable ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-controls={`provider-models-${providerKey}`}
            className="flex-1 min-w-0 text-left -m-1 p-1 rounded hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2 flex-wrap">
              {expanded
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
              <span className="font-medium text-sm">{providerName}</span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusChip.color}`}
                title={statusChip.tooltip}
              >
                {statusChip.text}
              </span>
              {hipaaEligible && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">HIPAA-eligible</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 ml-5">
              {modelCount} model{modelCount === 1 ? '' : 's'}
              {byokEnabled && hasAccountKey && accountKey!.keySuffix && <span> · <span className="font-mono">{accountKey!.keySuffix}</span></span>}
              {byokEnabled && hasAccountKey && !accountKey!.enabled && <span> · disabled</span>}
              {!expanded && <span className="ml-1 text-muted-foreground/70">— click to view</span>}
            </div>
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{providerName}</span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusChip.color}`}
                title={statusChip.tooltip}
              >
                {statusChip.text}
              </span>
              {hipaaEligible && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">HIPAA-eligible</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {modelCount} model{modelCount === 1 ? '' : 's'}
              {byokEnabled && hasAccountKey && accountKey!.keySuffix && <span> · <span className="font-mono">{accountKey!.keySuffix}</span></span>}
              {byokEnabled && hasAccountKey && !accountKey!.enabled && <span> · disabled</span>}
            </div>
          </div>
        )}

        {/* Test button is shown whenever there's *something* to test —
            either the account stored a key (byok-eligible row) or the
            instance has an env-fallback key configured. Hidden only for
            unconfigured non-byok providers, where a test would have
            nothing to send. */}
        <div className="flex gap-1.5 flex-shrink-0">
          {!editing && (available || (byokEnabled && byok && hasAccountKey)) && (
            <TestKeyButton
              providerKey={providerKey}
              disabled={busy}
            />
          )}
          {/* Add key / Rotate / Remove all suppressed when source === 'env'
              — the operator owns the key on this provider and per-account
              writes (including deletes of stale stored keys) are policy-
              blocked. Stale keys are silently ignored at resolve time
              (see AiModelResolver#resolve), so leaving them in storage is
              harmless. */}
          {byokEnabled && byok && !editing && source !== 'env' && (
            <>
              <Button variant="outline" size="sm" onClick={() => { setEditing(true); setApiKey(''); }} disabled={busy}>
                {hasAccountKey ? 'Rotate' : 'Add key'}
              </Button>
              {hasAccountKey && (
                <Button variant="outline" size="sm" onClick={remove} disabled={busy}>Remove</Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Aliases this provider's models are referenced by. Click any chip
          to jump to the Aliases tab. Rendered as a sibling row outside
          the header `<button>` to keep nesting valid. */}
      {renderProviderAliasChips()}

      {byokEnabled && byok && editing && (
        <div className="mt-3 space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`${providerName} API key`}
            className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm"
            autoFocus
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy} size="sm" className="bg-purple-600 hover:bg-purple-700">
              {busy ? 'Saving…' : (hasAccountKey ? 'Save new key' : 'Save key')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setEditing(false); setError(null); }} disabled={busy}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Your key is encrypted at rest with your account key and never echoed back. To replace it later, click Rotate.
            After saving, click <strong>Test</strong> to fire a 1-token request and confirm the key works.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>
      )}

      {byokEnabled && byok && !available && !editing && source === 'none' && (
        <p className="text-xs text-muted-foreground mt-2">
          This provider's models won't appear in pickers until a key is configured — either your account's key above, or the instance's shared key.
        </p>
      )}
      {byokEnabled && byok && source === 'env' && (
        <p className="text-xs text-muted-foreground mt-2">
          This provider's key is configured by the operator (built-in). Per-account keys are disabled for {providerName} on this instance.
        </p>
      )}
      {!byok && !available && (
        <p className="text-xs text-muted-foreground mt-2">
          Operator-managed only — set the <code className="text-[11px]">{providerKey.toUpperCase()}_API_KEY</code> environment variable on the server to enable this provider.
        </p>
      )}

      {/* Expanded models list — surfaces what `models` field returns from
          /api/v1/ai_models so users can see which models a provider serves
          before configuring it. Custom providers skip this in favour of
          the structured editor block below. */}
      {expanded && !showCustomEditor && models.length > 0 && (
        <div
          id={`provider-models-${providerKey}`}
          className="mt-3 space-y-2 border-t border-border pt-3"
        >
          <ul className="space-y-2">
            {models.map((m) => {
              const sub = subProviderId(m.id);
              const aliasNames = aliasesByModelId?.get(m.id) || [];
              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-0.5 rounded-md bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-amber-500 dark:text-amber-400 text-xs flex-shrink-0">
                      {starRating(m.stars)}
                    </span>
                    <span className="font-medium text-sm">{m.name}</span>
                    {m.hipaa && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                        HIPAA
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-muted-foreground select-all">
                      {sub}
                    </span>
                    {aliasNames.length > 0 && (
                      <span className="ml-auto inline-flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">used by:</span>
                        {aliasNames.map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={onSwitchToAliases}
                            title="Open Aliases tab"
                            className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900 cursor-pointer"
                          >
                            {name}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <div className="text-[11px] text-muted-foreground">
                      {m.description}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Custom-endpoint editor: base_url + structured models list. Rendered
          for providers marked `custom: true` in the catalog AND when the
          instance flag `byok_customizable` is on. Each model row carries
          its own id + preset so a Custom LLM provider can host different
          model families with different presets. API key is optional: LM
          Studio and Ollama ignore it; a remote endpoint behind auth needs
          it (use the Add-key form above when `byok: true`). Stored
          encrypted at rest on Account#ai_provider_keys.
          Hidden until the user expands the row, same as cloud providers. */}
      {showCustomEditor && expanded && (
        <form
          autoComplete="off"
          onSubmit={(e) => e.preventDefault()}
          className="mt-3 space-y-3 border-t border-border pt-3"
        >
          {/* Honeypot fields — Chrome's autofill heuristic is label-blind.
              If it sees a form without an obvious email+password pair, it
              starts guessing: the first text input becomes the "email". By
              planting a hidden, non-displayed email+password pair BEFORE
              the real inputs we give Chrome somewhere to dump its autofill
              so the visible Base URL field stays untouched. Works reliably
              across Chromium-based browsers. */}
          <input
            type="email"
            name="email"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`base-url-${providerKey}`}>
              Base URL <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <input
              id={`base-url-${providerKey}`}
              type="url"
              inputMode="url"
              required
              // Randomised name per mount so password-manager rules that
              // key on name can't match, and the browser never associates a
              // previously-saved value with the field. autoComplete="off"
              // alone doesn't stop Chrome; the honeypot pair above is the
              // load-bearing part of this defence.
              name={`rvdk-base-url-${providerKey}-${Math.random().toString(36).slice(2, 8)}`}
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              spellCheck={false}
              value={baseUrlDraft}
              onChange={(e) => {
                setBaseUrlDraft(e.target.value);
                if (baseUrlError) setBaseUrlError(null);
              }}
              placeholder={defaultBaseUrl ?? 'http://localhost:1234/v1'}
              disabled={localSaving}
              aria-invalid={!!baseUrlError}
              aria-describedby={`base-url-hint-${providerKey}`}
              className={`w-full rounded-md border bg-background text-foreground px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 ${baseUrlError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-input focus:ring-ring'
                }`}
            />
            {baseUrlError ? (
              <p id={`base-url-hint-${providerKey}`} className="text-[11px] text-red-600 dark:text-red-400">
                {baseUrlError}
              </p>
            ) : (
              <p id={`base-url-hint-${providerKey}`} className="text-[11px] text-muted-foreground">
                Full URL including <code>/v1</code>. LM Studio: <code>http://localhost:1234/v1</code>. Ollama: <code>http://localhost:11434/v1</code>. Remote endpoints are fine too.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Models</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addModelRow}
                disabled={localSaving}
                className="text-[11px] h-7 px-2"
              >
                + Add model
              </Button>
            </div>
            {draftModels.length === 0 ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                No models defined yet. Click <strong>+ Add model</strong> above to define one (alias + model id), then <strong>Save settings</strong> — the provider stays hidden from the picker and shows "Not configured" until at least one row is saved.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground px-1">
                  <span>Alias</span>
                  <span>Model id</span>
                  <span>Preset</span>
                  <span></span>
                </div>
                <ul className="space-y-2">
                  {draftModels.map((m, idx) => (
                    <li key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
                      <input
                        type="text"
                        value={m.alias}
                        onChange={(e) => updateModelRow(idx, { alias: e.target.value })}
                        placeholder="my-local-gemma"
                        disabled={localSaving}
                        aria-label={`Alias ${idx + 1}`}
                        title="Picker label. Account-scoped — must be unique within this provider and not collide with a built-in alias."
                        className="rounded-md border border-input bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <input
                        type="text"
                        value={m.model_id}
                        onChange={(e) => updateModelRow(idx, { model_id: e.target.value })}
                        placeholder="gemma-3-9b-instruct"
                        disabled={localSaving}
                        aria-label={`Model id ${idx + 1}`}
                        title="Sent verbatim to the upstream endpoint (e.g. gemma-3-9b-instruct, llama3.2, google/gemma-4-e4b)."
                        className="rounded-md border border-input bg-background text-foreground px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <select
                        value={m.revdoku_options}
                        onChange={(e) => updateModelRow(idx, { revdoku_options: e.target.value })}
                        disabled={localSaving}
                        aria-label={`Preset for model ${idx + 1}`}
                        className="rounded-md border border-input bg-background text-foreground px-2 py-1 text-xs"
                      >
                        <option value="">none</option>
                        {revdokuOptionPresets.map((p) => (
                          <option key={p.key} value={p.key} title={p.desc ?? undefined}>{p.key}</option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeModelRow(idx)}
                        disabled={localSaving}
                        aria-label={`Remove model ${idx + 1}`}
                        className="text-[11px] h-7 px-2 text-muted-foreground hover:text-red-600"
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-[11px] text-muted-foreground">
              <strong>Alias</strong> is the friendly name shown in the picker (and on the Aliases tab). It must be unique within this provider and must not match a built-in alias. <strong>Model id</strong> is the literal name sent to your endpoint (<code>llama3.2</code>, <code>gemma-3-9b-instruct</code>, etc.) — use <code>mymodel</code> when the endpoint doesn't care. The preset bundles options / grid_mode / coord-scale for that model family — pick <code>none</code> for a plain OpenAI-compat call.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={saveCustomSettings}
              disabled={localSaving}
              size="sm"
              variant="outline"
            >
              {localSaving ? 'Saving…' : 'Save settings'}
            </Button>
            {localSaved && <span className="text-[11px] text-green-600 dark:text-green-400">Saved</span>}
          </div>
        </form>
      )}
    </div>
  );
}
