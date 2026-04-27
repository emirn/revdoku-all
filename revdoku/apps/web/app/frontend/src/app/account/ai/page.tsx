import { useEffect, useState, useCallback } from 'react';
import { ApiClient } from '@/lib/api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Sliders, Plug, Layers } from 'lucide-react';
import { formatModelOptionLabel, buildPickerOptions } from '@/lib/ai-model-utils';
import { starRating } from '@revdoku/lib';
import type { IAIModelOption } from '@/lib/ai-model-utils';
import AiModelInfoCard from '@/components/envelope-page/AiModelInfoCard';
import ProviderKeyRow from '@/components/ProviderKeyRow';

type ModelsResponse = Awaited<ReturnType<typeof ApiClient.getModels>>;
type ProviderRow = NonNullable<ModelsResponse['providers']>[number];
type AccountKey = Awaited<ReturnType<typeof ApiClient.listProviderKeys>>['keys'][number];
type RevdokuOptionPreset = NonNullable<ModelsResponse['revdoku_option_presets']>[number];

export default function AccountAiPage() {
  const [models, setModels] = useState<IAIModelOption[]>([]);
  const [aliases, setAliases] = useState<IAIModelOption[]>([]);
  // Concrete models only (no aliases mixed in). Used to render the
  // per-alias target list — each target id is looked up here to display
  // the actual model name + provider it points at.
  const [concreteModels, setConcreteModels] = useState<IAIModelOption[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [accountKeys, setAccountKeys] = useState<AccountKey[]>([]);
  const [revdokuOptionPresets, setRevdokuOptionPresets] = useState<RevdokuOptionPreset[]>([]);
  const [byokEnabled, setByokEnabled] = useState(false);
  const [customizableEnabled, setCustomizableEnabled] = useState(false);
  const [generationModel, setGenerationModel] = useState<string>('');
  const [inspectionModel, setInspectionModel] = useState<string>('');
  const [textExtractionModel, setTextExtractionModel] = useState<string>('');
  const [textExtractionDefault, setTextExtractionDefault] = useState<string>('');
  // Deployment-locked region (server-side default; not a per-account
  // setting). Surfaced as a read-only label in the UI.
  const [preferredRegion, setPreferredRegion] = useState<string>('any');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Aliases is the default landing tab: it surfaces what the picker will
  // show during reviews / checklist generation, and each alias card
  // points at the providers it needs. New users immediately see the
  // shape of the catalog; existing users get a quick "is everything
  // wired up" view. Providers stays one click away for editing keys.
  const [activeTab, setActiveTab] = useState<'defaults' | 'providers' | 'aliases'>('aliases');

  const refresh = useCallback(async () => {
    const [modelsRes, profileRes, keysRes] = await Promise.all([
      ApiClient.getModels(),
      ApiClient.getAccountProfile(),
      ApiClient.listProviderKeys().catch(() => ({ keys: [] as AccountKey[] })),
    ]);

    // Show aliases first, then concrete models. Keep disabled entries in
    // the list — operators should be able to pre-select a default before
    // configuring the corresponding provider key. The dropdown marks
    // disabled ones with "— configure <provider> key" so the user knows
    // they need to set up credentials before reviews can run.
    const aliasesPayload = modelsRes.aliases || [];
    const concreteModelsPayload = modelsRes.models || [];
    // Picker shows aliases + user's Custom-LLM models only — never the
    // cloud-provider concrete models (those exist purely as alias targets).
    const pickerOptions = buildPickerOptions({
      aliases: aliasesPayload,
      models: concreteModelsPayload,
      providers: modelsRes.providers || [],
    });
    setModels(pickerOptions);
    setAliases(aliasesPayload);
    setConcreteModels(concreteModelsPayload);
    setProviders(modelsRes.providers || []);
    setRevdokuOptionPresets(modelsRes.revdoku_option_presets || []);
    setByokEnabled(!!modelsRes.feature_flags?.byok_enabled);
    setCustomizableEnabled(!!modelsRes.feature_flags?.byok_customizable);
    setPreferredRegion(modelsRes.preferred_region || 'any');
    setAccountKeys(keysRes.keys || []);
    // eslint-disable-next-line no-console
    console.log('[account/ai] refresh: providers →', (modelsRes.providers || []).map(p => ({ provider_key: p.provider_key, byok: p.byok, custom: p.custom, base_url: p.base_url, default_base_url: p.default_base_url, model_id: p.model_id })));
    // eslint-disable-next-line no-console
    console.log('[account/ai] refresh: accountKeys →', (keysRes.keys || []).map(k => ({ provider: k.provider, byok: k.byok, custom: k.custom, base_url: k.base_url, configured: k.configured, model_count: k.models?.length ?? 0 })));

    const extractionDefault = modelsRes.default_text_extraction_model_id || '';
    setTextExtractionDefault(extractionDefault);

    const acct = profileRes.profile.current_account;
    setGenerationModel(acct.default_checklist_generation_model || modelsRes.default_model_id || '');
    setInspectionModel(acct.default_checklist_model || modelsRes.default_model_id || '');
    setTextExtractionModel(acct.default_text_extraction_model || extractionDefault);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load AI settings');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [refresh]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await ApiClient.updateAiPreferences({
        default_checklist_generation_model: generationModel || null,
        default_checklist_model: inspectionModel || null,
        default_text_extraction_model: textExtractionModel || null,
      });
      setGenerationModel(result.default_checklist_generation_model || '');
      setInspectionModel(result.default_checklist_model || '');
      setTextExtractionModel(result.default_text_extraction_model || textExtractionDefault);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse bg-muted rounded" />
        <div className="h-64 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  if (error && models.length === 0) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-destructive">
        <p>{error}</p>
      </div>
    );
  }

  const keyByProvider = new Map(accountKeys.map(k => [k.provider, k]));
  // Look up a concrete model by its full id (e.g. "any:openai:gpt-4.1-…").
  // Drives the per-alias target list — each target id resolves to the
  // model name + provider name shown in the row.
  const modelById = new Map(concreteModels.map(m => [m.id, m]));
  // Build alias index: model_id → list of alias names that target it. Used
  // both on the Aliases tab (each alias card lists its served models) and
  // on the Providers tab (each model row shows alias chips that link
  // back to the Aliases tab).
  const aliasesByTargetId = new Map<string, string[]>();
  aliases.forEach(a => {
    (a.targets || []).forEach(t => {
      const arr = aliasesByTargetId.get(t) || [];
      // Strip the trailing "(NO providers configured!)" suffix added by
      // serialize_alias when nothing's wired up — we want clean chips
      // here even for unavailable aliases.
      const cleanName = (a.name || a.id).replace(/\s*\(NO providers configured!\)\s*$/i, '');
      arr.push(cleanName);
      aliasesByTargetId.set(t, arr);
    });
  });

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'defaults' | 'providers' | 'aliases')}>
      <TabsList>
        <TabsTrigger value="aliases">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Aliases
          </span>
        </TabsTrigger>
        <TabsTrigger value="providers">
          <span className="inline-flex items-center gap-1.5">
            <Plug className="h-3.5 w-3.5" />
            Providers
          </span>
        </TabsTrigger>
        <TabsTrigger value="defaults">
          <span className="inline-flex items-center gap-1.5">
            <Sliders className="h-3.5 w-3.5" />
            Default
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="defaults">
        <Card>
          <CardHeader>
            <CardTitle>Default</CardTitle>
            <CardDescription>
              Choose which AI models are used by default for your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Region is deployment-locked (Revdoku.default_region on the
                server); we surface the value as a read-only label so users
                know which catalog their reviews route through, without
                implying it's a per-account choice. */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                AI Region
              </label>
              <p className="text-sm text-foreground">
                <span className="font-mono">{preferredRegion}</span>
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Document Review Model
              </label>
              <p className="text-xs text-muted-foreground">
                Default model assigned to new checklists for running reviews
              </p>
              <select
                value={inspectionModel}
                onChange={(e) => setInspectionModel(e.target.value)}
                className="w-full max-w-md rounded-md border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {formatModelOptionLabel(model)}
                  </option>
                ))}
              </select>
              {models.find(m => m.id === inspectionModel) && (
                <div className="max-w-md mt-1">
                  <AiModelInfoCard model={models.find(m => m.id === inspectionModel)!} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Checklist Generation Model
              </label>
              <p className="text-xs text-muted-foreground">
                Used when generating checklist rules from source text
              </p>
              <select
                value={generationModel}
                onChange={(e) => setGenerationModel(e.target.value)}
                className="w-full max-w-md rounded-md border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {formatModelOptionLabel(model)}
                  </option>
                ))}
              </select>
              {models.find(m => m.id === generationModel) && (
                <div className="max-w-md mt-1">
                  <AiModelInfoCard model={models.find(m => m.id === generationModel)!} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Text Extraction Model
              </label>
              <p className="text-xs text-muted-foreground">
                Used to extract page text from uploaded files and reference
                files, and to build change-detection baselines for reviews
                on revisions 2+. Basic is the recommended default — the
                task is straightforward OCR, so the lower cost and faster
                response outweigh a stronger model.
              </p>
              <select
                value={textExtractionModel}
                onChange={(e) => setTextExtractionModel(e.target.value)}
                className="w-full max-w-md rounded-md border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {formatModelOptionLabel(model)}
                  </option>
                ))}
              </select>
              {models.find(m => m.id === textExtractionModel) && (
                <div className="max-w-md mt-1">
                  <AiModelInfoCard model={models.find(m => m.id === textExtractionModel)!} />
                </div>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-md p-3">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>
              {saved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved</span>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="aliases">
        <Card>
          <CardHeader>
            <CardTitle>Aliases</CardTitle>
            <CardDescription>
              Friendly names the picker shows during reviews and checklist
              generation. Each alias resolves to the first configured provider
              from its target list — set keys on the <strong>Providers</strong> tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">Built-in</h3>
              {aliases.length === 0 && (
                <p className="text-sm text-muted-foreground">No built-in aliases defined for this region.</p>
              )}
              {aliases.map(a => {
              const targetIds = a.targets || [];
              // Resolve each target id to its concrete model (for the
              // model name) AND look up whether the target's provider
              // has a working key (via the providers payload, where
              // serialize_alias already gave us a per-provider configured
              // flag).
              const providerConfigured = new Map((a.providers || []).map(p => [p.key, p.configured]));
              const targetRows = targetIds.map(tid => {
                const m = modelById.get(tid);
                const providerKey = m?.provider || tid.split(':')[1] || '';
                return {
                  targetId: tid,
                  model: m,
                  providerKey,
                  providerName: m?.provider_name || providerKey,
                  configured: !!providerConfigured.get(providerKey),
                };
              });
              const resolvedRow = targetRows.find(r => r.configured);
              return (
                <div
                  key={a.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Same indigo chip styling as the alias chips on
                            the Providers tab — consistent visual language
                            for "this is an alias name". */}
                        <span className="text-sm px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 font-medium">
                          {a.name}
                        </span>
                        <span className="text-amber-500 dark:text-amber-400 text-xs">
                          {starRating(a.stars)}
                        </span>
                        {a.hipaa && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                            HIPAA
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-muted-foreground select-all">
                          {a.id}
                        </span>
                      </div>
                      {a.description && (
                        <p className="text-xs text-muted-foreground">{a.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px]">
                    <span className="text-muted-foreground">Resolves to: </span>
                    {resolvedRow ? (
                      <span className="text-foreground font-medium">
                        {resolvedRow.providerName}
                        {resolvedRow.model?.name ? ` · ${resolvedRow.model.name}` : ''}
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 font-medium">No working provider configured</span>
                    )}
                  </div>
                  {targetRows.length > 0 && (
                    <ul className="text-[11px] space-y-1 pl-3 border-l border-border">
                      {targetRows.map((r, idx) => {
                        // Sub-provider id is what the upstream SDK actually
                        // sees — e.g. "gpt-4.1-2025-04-14" out of
                        // "any:openai:gpt-4.1-2025-04-14". Splitting on
                        // the first two colons keeps any further colons
                        // (e.g. OpenRouter's "openai/o4-mini") intact.
                        const parts = r.targetId.split(':');
                        const subId = parts.length >= 3 ? parts.slice(2).join(':') : r.targetId;
                        return (
                          <li key={r.targetId} className="flex items-start gap-2 flex-wrap">
                            <span className="text-muted-foreground tabular-nums">{idx + 1}.</span>
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-muted-foreground">provider:</span>
                                <span className="text-foreground font-medium">{r.providerName}</span>
                                {r.configured ? (
                                  <span className="text-green-700 dark:text-green-400">✓ configured</span>
                                ) : (
                                  <span className="text-red-600 dark:text-red-400">(not configured!)</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-muted-foreground">model:</span>
                                {r.model?.name && (
                                  <span className="text-foreground">{r.model.name}</span>
                                )}
                                <span className="font-mono text-muted-foreground select-all">{subId}</span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
              })}
            </div>

            {/* Custom-provider aliases. Sourced from the providers payload
                (one row per Custom LLM provider, each row's models[] are
                the user-defined aliases). Hidden when the user hasn't
                defined any. */}
            {(() => {
              const customRows = providers
                .filter(p => p.custom)
                .flatMap(p => {
                  const acct = keyByProvider.get(p.provider_key);
                  const models = acct?.models || [];
                  return models.map(m => ({ provider: p, model: m }));
                });
              if (customRows.length === 0) return null;
              return (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-foreground">Custom (your providers)</h3>
                  {customRows.map(({ provider: p, model: m }) => {
                    const providerAvailable = !!p.available;
                    return (
                      <div
                        key={`${p.provider_key}:${m.alias}:${m.model_id}`}
                        className="rounded-lg border border-border bg-card p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Same indigo chip styling as built-in alias
                                  names so the alias-as-noun reads
                                  consistently across both lists. The
                                  separate purple "Custom" badge keeps
                                  custom vs built-in distinguishable. */}
                              <span className="text-sm px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 font-medium">
                                {m.alias}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                                Custom
                              </span>
                              <span className="text-[11px] text-muted-foreground">in {p.name}</span>
                              <span className="font-mono text-[11px] text-muted-foreground select-all">
                                {m.model_id}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="text-[11px]">
                          <span className="text-muted-foreground">Resolves to: </span>
                          {providerAvailable ? (
                            <span className="text-foreground font-medium">{p.name} · {m.alias}</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400 font-medium">No working provider key</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="providers">
        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              {byokEnabled
                ? "Setup API keys for a AI providers below."
                : "Providers available on this server."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {providers.length === 0 && (
              <p className="text-sm text-muted-foreground">No providers configured in this instance.</p>
            )}
            {providers.map(p => {
              const acctKey = keyByProvider.get(p.provider_key);
              return (
                <ProviderKeyRow
                  key={p.provider_key}
                  providerKey={p.provider_key}
                  providerName={p.name}
                  source={p.source}
                  available={p.available}
                  hipaaEligible={p.hipaa}
                  modelCount={p.models.length}
                  byokEnabled={byokEnabled}
                  customizableEnabled={customizableEnabled}
                  byok={!!p.byok}
                  custom={!!p.custom}
                  accountKey={acctKey && acctKey.configured ? {
                    enabled: acctKey.enabled,
                    keySuffix: acctKey.key_suffix,
                  } : null}
                  models={p.models}
                  modelId={p.model_id ?? null}
                  defaultModelId={p.default_model_id ?? null}
                  baseUrl={p.base_url ?? null}
                  defaultBaseUrl={p.default_base_url ?? null}
                  customModels={acctKey?.models ?? []}
                  revdokuOptionPresets={revdokuOptionPresets}
                  aliasesByModelId={aliasesByTargetId}
                  onSwitchToAliases={() => setActiveTab('aliases')}
                  onChanged={refresh}
                />
              );
            })}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
