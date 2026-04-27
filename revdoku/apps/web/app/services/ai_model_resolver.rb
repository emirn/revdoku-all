# frozen_string_literal: true

# AI model catalog resolver.
#
# The YAML at config/ai_models.yml is organised as
#   shared.providers.<provider_key>.models[]
# (the pre-Apr-2026 region/alias/+hipaa structure is gone). Every model's id is
# "{provider_key}:{api_model_name}" — the suffix after the colon is what doc-api
# passes to the provider SDK via getModelNameForAPI.
#
# Public surface (kept stable for existing callers):
#   .resolve(model_id, operation:, account: nil)   — full config for doc-api
#   .find_model(model_id)                          — raw YAML model hash or nil
#   .default_model_id(operation, region: nil)      — YAML default for an operation
#   .credits_per_page(model_id)                    — billing
#   .production_aliases(region: nil)               — flat catalog (renamed concept: was
#                                                     tier-aliases, now the full curated
#                                                     model list sorted by credits)
#   .first_hipaa_model_id(region: nil)             — first model whose provider is
#                                                     hipaa; used as a safe
#                                                     fallback when a HIPAA account's
#                                                     preference points at a non-HIPAA
#                                                     provider
#   .provider_name(provider_key)                   — "Google Cloud", "OpenAI", etc.
#                                                     Reads `name:` from the catalog row.
#   .parse_model_id(id)                            — {provider, model_name}
#   .parse_alias_id(id)                            — legacy shim; aliases are gone so
#                                                     this just returns parse_model_id
#                                                     output plus hipaa: from provider
#   .display_name(entry), .star_rating(entry)      — UI helpers
#   .effective_region                              — "any" by default; reads
#                                                     account.preferred_region
#                                                     when a tenant is in scope
#
# Availability helpers (new for PR 1; used by UI in PR 4):
#   .providers_for_account(account)                — ordered provider list with
#                                                     {available, source, models}
#   .models_for_account(account, operation:)       — filtered list for the picker
#   .provider_available?(provider, account:)       — ENV key present OR enabled BYOK
class AiModelResolver
  DEFAULT_CREDITS_PER_PAGE = 10

  class ModelNotFoundError < StandardError; end

  # === Public lookups ===

  # Catalog config — sourced from config/ai_models.yml. Deployments may
  # override the entire catalog by dropping a replacement YAML at the
  # well-known overlay path; if present it is used verbatim (no merge).
  def self.config
    @_config ||= load_catalog
  end

  def self.load_catalog
    overlay = Rails.root.join("ee", "config", "ai_models.yml")
    return load_yaml_catalog(overlay) if overlay.exist?
    Rails.application.config_for(:ai_models)
  end

  # Load a catalog YAML manually. Matches config_for's shared/env-keyed
  # section convention.
  def self.load_yaml_catalog(path)
    raw = File.read(path)
    parsed = YAML.safe_load(ERB.new(raw).result, aliases: true) || {}
    data = parsed[Rails.env] || parsed[Rails.env.to_sym] ||
           parsed["shared"] || parsed[:shared] ||
           parsed
    deep_symbolize(data)
  end

  def self.deep_symbolize(value)
    case value
    when Hash  then value.each_with_object({}) { |(k, v), h| h[k.to_sym] = deep_symbolize(v) }
    when Array then value.map { |v| deep_symbolize(v) }
    else value
    end
  end
  private_class_method :load_yaml_catalog, :deep_symbolize

  # === Catalog accessors ===

  # The catalog as loaded. The resolver picks the slice for the caller's
  # effective region — see region_slice / effective_region below.
  def self.raw_catalog
    @_raw_catalog ||= load_catalog
  end

  # Active region for the current request. Single deployment-level value
  # (the per-account `preferred_region` switch was removed — see
  # Revdoku.default_region for the resolution chain). HIPAA-enabled
  # accounts still force "us" so PHI never reaches a non-HIPAA-eligible
  # catalog row even if the operator left the deployment unlocked.
  def self.effective_region
    account = current_tenant_account
    return "us" if account.respond_to?(:hipaa_enabled?) && account.hipaa_enabled?
    Revdoku.default_region.to_s
  end

  # The slice of the catalog the rest of the resolver reads from. Both
  # editions are region-keyed (`shared.regions.<name>`); the slice is the
  # block under the effective region with `regions.any` as the always-
  # present fallback. Returns an empty hash rather than nil so callers can
  # safely chain `[:providers]` / `[:aliases]`.
  def self.region_slice
    regions = (raw_catalog[:regions] || {})
    return {} if regions.empty?
    region = effective_region
    regions[region.to_sym] || regions[region.to_s] || regions[:any] || regions["any"] || {}
  end

  # The list of regions the UI may surface to the operator. The catalog
  # may define multiple region blocks but the deployment locks to ONE —
  # see `effective_region`. Returning a single-item list keeps the
  # existing frontend "single-region → render read-only label" branch
  # firing, so the picker auto-hides the (now removed) multi-region
  # selector without needing a second API field.
  def self.available_regions
    [effective_region]
  end

  def self.providers_hash
    (region_slice[:providers] || {}).with_indifferent_access
  end

  def self.provider_for(provider_key)
    providers_hash[provider_key.to_s]
  end

  # All models flattened. Each model hash is annotated with its `provider_key`
  # so callers can reach back to the provider-level config without another lookup.
  def self.all_models
    @_all_models_cache ||= providers_hash.flat_map do |provider_key, provider|
      (provider[:models] || []).map do |model|
        model.merge(provider_key: provider_key.to_s, provider: provider_key.to_s)
      end
    end
  end

  # Invalidate memoised state when config reloads (dev hot-reload safety).
  def self.reset_cache!
    @_all_models_cache = nil
    @_raw_catalog = nil
    @_config = nil
    @_presets = nil
  end

  # ENV var name for a provider's API key. Convention is fixed:
  # <PROVIDER_KEY_UPCASE>_API_KEY (no Revdoku prefix). Single source of
  # truth — never hardcode env var names elsewhere. The provider key in
  # ai_models.yml drives the name verbatim, so renaming a row in YAML
  # also renames the expected ENV var.
  def self.api_key_env_var(provider_key)
    "#{provider_key.to_s.upcase}_API_KEY"
  end

  # Region prefix used when synthesising a model id for a per-account
  # user-defined model (currently only `custom: true` providers).
  def self.catalog_region_prefix
    "#{effective_region}:"
  end

  # Named `revdoku_options` presets loaded from
  # config/revdoku_option_presets.yml (not ai_models.yml — that file is
  # strictly for models + aliases). A catalog model OR a user-defined
  # custom-provider model entry can carry `revdoku_options: "<preset_key>"`;
  # the resolver merges the preset's fields into the doc-api config before
  # the call. Explicit fields on the model still win over preset fields.
  def self.presets
    @_presets ||= begin
      path = Rails.root.join("config", "revdoku_option_presets.yml")
      raw = File.exist?(path) ? YAML.safe_load(ERB.new(File.read(path)).result, aliases: true) : {}
      (raw.is_a?(Hash) && raw["presets"].is_a?(Hash) ? raw["presets"] : {}).each_with_object({}) do |(k, v), acc|
        acc[k.to_s] = v.is_a?(Hash) ? v.transform_keys(&:to_sym) : {}
      end
    end
  end

  # Fetch a preset's field hash (symbol-keyed), or {} if the key is unknown
  # or the preset registry is empty. Callers merge this with per-model fields
  # using explicit-wins precedence.
  def self.preset_for(preset_key)
    return {} if preset_key.to_s.strip.empty?
    presets[preset_key.to_s] || {}
  end

  # Find a model by id. Every model id has the shape
  # "<region>:<provider>:<api_name>" with a non-empty region segment.
  # Ids whose region doesn't match the caller's effective region resolve
  # to nil because the catalog slice they'd live in isn't loaded.
  #
  # `account:` lets custom-provider lookups synthesize a model entry from
  # the account's user-defined models list (ai_provider_keys[custom_llm_*].
  # models). When the id points at a `custom: true` provider but isn't in
  # the catalog, we fall back to the account list so
  # "any:custom_llm_1:llama3.2" resolves to a real config even though the
  # catalog only ships two symbolic entries (gemma-family / generic).
  def self.find_model(model_id, account: nil)
    return nil if model_id.blank?
    # Aliases live in the active region's catalog slice and are 2-segment
    # ("<region>:<alias-name>" — e.g. "any:gpt-normal"). Resolve them before
    # parsing for the 3-segment concrete-model shape, which would reject
    # 2-segment ids by giving them an empty region segment.
    aliased = aliases_hash[model_id.to_s]
    return find_model_by_alias(model_id.to_s, aliased, account: account) if aliased

    parsed = parse_model_id(model_id)
    return nil if parsed[:region].blank?  # Reject 3-segment ids without a region
    hit = all_models.find { |m| m[:id] == model_id }
    return hit if hit

    # User-defined custom-provider model fallback. When the caller forgot
    # to pass `account:`, fall back to the tenant-context account so async
    # jobs and legacy code paths still resolve user-defined model ids.
    effective_account = account || current_tenant_account
    provider_key = parsed[:provider].to_s
    provider = provider_for(provider_key)
    if provider && provider[:custom] && effective_account.respond_to?(:provider_models)
      # The id's last segment is the upstream model_id — what doc-api
      # sends to the SDK via getModelNameForAPI. The user's per-row
      # `alias` is pure display metadata and never appears in resolved
      # ids; that's why two custom providers can each have their own
      # alias `gemma 4 deep` without colliding here.
      user_entry = effective_account.provider_models(provider_key).find { |m| m["model_id"] == parsed[:model_name] }
      if user_entry
        template = (provider[:models] || []).first || {}
        synth = template.merge(
          id: model_id,
          name: user_entry["alias"],
          provider_key: provider_key,
          provider: provider_key,
          credits_per_page: 0
        )
        preset = user_entry["revdoku_options"].to_s.strip.presence
        synth[:revdoku_options] = preset if preset
        return synth
      end
    end

    nil
  end

  # Best-effort resolution of the current tenant's account for code paths
  # that didn't thread `account:` explicitly. Tries Principal first (set by
  # the warden hook on every authenticated web request) then falls back to
  # ActsAsTenant.current_tenant (set by every controller's set_tenant hook
  # and by ActiveJob queue adapters that snapshot the tenant on enqueue).
  # Returns nil in contexts with no tenant — correct for user-defined
  # model lookups (no account = nothing to find).
  def self.current_tenant_account
    p_acct = (Principal.account if defined?(Principal) && Principal.respond_to?(:account))
    return p_acct if p_acct
    ActsAsTenant.current_tenant if defined?(ActsAsTenant) && ActsAsTenant.respond_to?(:current_tenant)
  rescue StandardError
    nil
  end
  private_class_method :current_tenant_account

  # Alias catalog: { "<region>:<alias>" => { name:, targets: [...] } }.
  # String keys so model-id string lookups hit directly.
  def self.aliases_hash
    (region_slice[:aliases] || {}).transform_keys(&:to_s)
  end

  # True when the given id is an alias (vs a concrete model id).
  def self.alias_id?(model_id)
    aliases_hash.key?(model_id.to_s)
  end

  # Resolve an alias id to its concrete model hash; nil if no target is
  # available. Downstream code (ReportCreationService, doc-api client) sends
  # the concrete model id via the returned hash's :id — the alias id is
  # preserved as alias_id for attribution / logging.
  #
  # Applies the same region-lock + HIPAA rules as aliases_for_account so a
  # stored default_ai_model that points at a now-filtered alias resolves
  # consistently. Returns nil when the alias's region doesn't match the
  # account's lock (caller should fall back to its plan-default model).
  def self.resolve_alias(alias_id, account: nil)
    entry = aliases_hash[alias_id.to_s]
    return nil unless entry

    locked_region = locked_region_for(account)
    return nil if locked_region && alias_region(alias_id.to_s) != locked_region

    raw_targets = Array(entry[:targets])
    targets = account&.respond_to?(:hipaa_enabled?) && account.hipaa_enabled? \
      ? raw_targets.map { |t| append_hipaa_suffix(t) } \
      : raw_targets
    resolved = first_available_target(targets, account: account)
    return nil unless resolved
    model = all_models.find { |m| m[:id] == resolved }
    return nil unless model
    model.merge(alias_id: alias_id.to_s, resolved_from_alias: true)
  end

  # All aliases as a flat list of hashes suitable for API responses. Each
  # entry includes resolved_id (first-available target given env keys /
  # account BYOK) and available: false when no target is reachable — the UI
  # renders the alias as disabled in that case.
  #
  # Region lock + HIPAA:
  #   - High-security accounts filter the alias set to a single region.
  #     HIPAA forces US regardless of the instance setting; plain high-
  #     security follows Revdoku.data_residency_region (unset → no lock).
  #   - HIPAA accounts additionally append "+hipaa" to every target so the
  #     resolver picks the HIPAA-BAA variant of each provider. Targets
  #     whose "+hipaa" variant isn't defined in the catalog naturally drop
  #     out of the fallback chain via first_available_target.
  #   - Core has neither high-security UX nor HIPAA enabled by default, so
  #     locked_region is nil and hipaa is false — behavior is unchanged.
  def self.aliases_for_account(account: nil)
    locked_region = locked_region_for(account)
    hipaa = !!account&.hipaa_enabled?

    aliases_hash.filter_map do |alias_id, entry|
      # Drop aliases whose region prefix doesn't match the lock. Alias ids
      # are "<region>:<name>" with an empty region slot in Core / any-region
      # commercial instances ("::<name>"); the comparison is on the leading
      # segment.
      next if locked_region && alias_region(alias_id) != locked_region

      raw_targets = Array(entry[:targets])
      targets = hipaa ? raw_targets.map { |t| append_hipaa_suffix(t) } : raw_targets
      resolved = first_available_target(targets, account: account)
      resolved_model = resolved && all_models.find { |m| m[:id] == resolved }
      {
        id: alias_id,
        name: entry[:name] || alias_id,
        description: entry[:description],
        stars: entry[:stars],
        targets: targets,
        resolved_id: resolved,
        available: !resolved.nil?,
        credits_per_page: resolved_model&.dig(:credits_per_page) || DEFAULT_CREDITS_PER_PAGE,
        hipaa: resolved_model ? !!provider_for(resolved_model[:provider_key])&.dig(:hipaa) : false
      }
    end
  end

  # Which region the account should be locked to, or nil for "no lock".
  # Rules (documented on aliases_for_account):
  #   - HIPAA enabled → always "us".
  #   - High-security (non-HIPAA) → Revdoku.data_residency_region (the
  #     instance-level setting). Unset → no lock even at high security.
  #   - Core and low-security commercial accounts → no lock.
  def self.locked_region_for(account)
    return nil if account.nil?
    return "us" if account.respond_to?(:hipaa_enabled?) && account.hipaa_enabled?
    if account.respond_to?(:security_level_high?) && account.security_level_high?
      return Revdoku.data_residency_region
    end
    nil
  end

  # Extract the region prefix from an alias id. Ids are "<region>:<name>"
  # so the region is everything up to the FIRST colon. Returns nil when
  # the prefix is empty (the "any region" convention used by Core).
  def self.alias_region(alias_id)
    region = alias_id.to_s.split(":", 2).first
    region.presence
  end

  # Turn "us:google_cloud:gemini-3.1-flash-image-preview" into
  # "us:google_cloud:gemini-3.1-flash-image-preview+hipaa", idempotent so
  # re-applying is safe. The model-id parser already splits on "+" when
  # looking up catalog entries, so the suffix is the existing BAA-variant
  # convention.
  def self.append_hipaa_suffix(target_id)
    target_id.to_s.include?("+hipaa") ? target_id.to_s : "#{target_id}+hipaa"
  end
  private_class_method :locked_region_for, :alias_region, :append_hipaa_suffix

  def self.first_available_target(targets, account: nil)
    targets.find do |target_id|
      model = all_models.find { |m| m[:id] == target_id }
      model && provider_available?(model[:provider_key], account: account)
    end
  end

  def self.find_model_by_alias(alias_id, entry, account: nil)
    resolved = first_available_target(Array(entry[:targets]), account: account)
    return nil unless resolved
    model = all_models.find { |m| m[:id] == resolved }
    return nil unless model
    model.merge(alias_id: alias_id, resolved_from_alias: true)
  end
  private_class_method :first_available_target, :find_model_by_alias

  # Backwards-compatible alias.
  def self.config
    region_slice
  end

  def self.display_name(entry)
    entry[:name].to_s
  end

  STAR = "★"
  def self.star_rating(entry)
    STAR * (entry[:stars] || 1)
  end

  # Single human-readable name for a provider. Reads `name:` from the catalog
  # row; falls back to a humanised provider key when the row is absent (e.g.
  # an account stored a key for a custom provider not declared in YAML).
  def self.provider_name(provider_key)
    key = provider_key.to_s
    provider = provider_for(key)
    (provider && provider[:name].to_s.presence) || key.gsub("_", " ").split.map(&:capitalize).join(" ")
  end

  # Parse a model id into its parts. The id shape is
  # "{region}:{provider_key}:{api_name}" — three colon-separated segments.
  # The api_name itself may contain colons (e.g. "openai/gpt-4.1") so we
  # only split on the FIRST two colons.
  def self.parse_model_id(id)
    base = id.to_s.split("+").first.to_s
    parts = base.split(":", 3)
    case parts.size
    when 3 then { region: parts[0], provider: parts[1], model_name: parts[2] }
    when 2 then { region: "",       provider: parts[0], model_name: parts[1] }   # legacy fallback
    else        { region: "",       provider: "",       model_name: parts.first.to_s }
    end
  end

  # Alias-aware id parsing. For a concrete id, returns parse_model_id output
  # plus the provider's hipaa flag. For an alias id, resolves to the first-
  # available target and derives hipaa/provider from there. Callers hold
  # either shape opaquely and get a uniform hash.
  def self.parse_alias_id(id)
    if alias_id?(id)
      resolved = resolve_alias(id)
      provider_key = resolved&.dig(:provider_key)
      return {
        region: parse_model_id(id)[:region],
        provider: provider_key.to_s,
        model_name: id.to_s.split(":", 3).last,
        hipaa: provider_key ? !!provider_for(provider_key)&.dig(:hipaa) : false,
        subtypes: [],
        name: aliases_hash[id.to_s][:name].to_s,
        alias_id: id.to_s
      }
    end
    parsed = parse_model_id(id)
    provider = provider_for(parsed[:provider])
    parsed.merge(hipaa: provider ? !!provider[:hipaa] : false, subtypes: [], name: parsed[:model_name])
  end

  # Alias-aware HIPAA check. Concrete ids use the provider's hipaa flag;
  # alias ids resolve to their first-available target and use that provider's
  # flag. Callers stay consistent whether they hold an alias or a concrete id.
  def self.model_is_hipaa?(model_id)
    if alias_id?(model_id)
      resolved = resolve_alias(model_id)
      return false unless resolved
      return !!provider_for(resolved[:provider_key])&.dig(:hipaa)
    end
    parsed = parse_model_id(model_id)
    provider = provider_for(parsed[:provider])
    provider ? !!provider[:hipaa] : false
  end

  # Alias-aware credits. find_model already resolves aliases to the concrete
  # model hash, but this override guards callers that bypass find_model.
  def self.credits_per_page(model_id)
    if alias_id?(model_id)
      resolved = resolve_alias(model_id)
      return resolved&.dig(:credits_per_page) || DEFAULT_CREDITS_PER_PAGE
    end
    entry = find_model(model_id)
    entry&.dig(:credits_per_page) || DEFAULT_CREDITS_PER_PAGE
  end

  def self.default_model_id(operation = :inspection)
    defaults = region_slice[:defaults] || {}
    defaults[operation.to_sym] || defaults[operation.to_s]
  end

  # Returns a flat list of "catalog" models, sorted by credits_per_page ascending.
  # Filters by provider attributes + their gating flags (e.g. providers marked
  # `custom: true` are hidden when `byok_customizable` is false in features.yml).
  # See provider_feature_enabled? for the mapping.
  def self.production_aliases
    models_visible_in_catalog.sort_by { |m| m[:credits_per_page] || DEFAULT_CREDITS_PER_PAGE }
  end

  def self.first_hipaa_model_id
    models_visible_in_catalog
      .find { |m| provider_for(m[:provider_key])&.dig(:hipaa) }
      &.dig(:id)
  end

  # === Availability (used by UI to show which providers are reachable) ===

  # True when the instance-level feature gate for this provider is satisfied.
  # Providers mark themselves with intrinsic attributes in ai_models.yml; this
  # method maps each attribute to the feature flag that gates it. Providers
  # with no gated attribute always pass.
  def self.provider_feature_enabled?(provider_key)
    provider = provider_for(provider_key)
    return false unless provider

    # `custom: true` providers (Custom LLM 1, future Custom LLM N — i.e. any
    # row whose base_url + models list are tenant-editable) are gated by
    # `byok_customizable`. Operators on shared multi-tenant cloud should
    # leave it false to avoid the SSRF surface a tenant-supplied base_url
    # would open.
    return false if provider[:custom] && !Revdoku.feature_enabled?(:byok_customizable)

    true
  end

  # Is a working API key available for this provider?
  #
  # Resolution rules:
  #   `custom: true` providers — available ONLY when the account has defined
  #   at least one user-model OR an ENV fallback exists. The catalog ships
  #   symbolic placeholders (gemma-family, generic) that mean nothing to a
  #   real LM Studio install; they don't count as "real models".
  #
  #   `byok: true` providers — available when the account has stored a key
  #   AND the instance-wide byok_enabled flag is on, OR when the operator
  #   has set the corresponding ENV var.
  #
  #   `byok: false` providers — only the operator's ENV key counts. The UI
  #   has no Add-key form for these, and the controller rejects api_key
  #   writes (defence in depth).
  def self.provider_available?(provider_key, account: nil)
    return false unless provider_feature_enabled?(provider_key)
    provider = provider_for(provider_key)
    return false unless provider

    if provider[:custom]
      return true if account.respond_to?(:provider_models) && account.provider_models(provider_key).any?
      return true if ENV[api_key_env_var(provider_key)].present?
      return false
    end

    # Env wins over per-account BYOK by policy: when the operator has
    # configured a key for a provider via its env var, all per-account
    # writes are blocked (controller rejects + UI hides the buttons) and
    # any stale per-account key is ignored at resolve time. Source of
    # truth: AiProviderKeysController#upsert_from_params.
    return true if ENV[api_key_env_var(provider_key)].present?

    if provider[:byok] && Revdoku.byok_enabled? && account.respond_to?(:ai_provider_key) && account.ai_provider_key(provider_key)
      return true
    end

    false
  end

  def self.providers_for_account(account: nil)
    providers_hash.map do |provider_key, provider|
      next nil unless provider_feature_enabled?(provider_key)

      available = provider_available?(provider_key, account: account)
      # `source` reflects WHICH key resolution path satisfied the request.
      # Env wins over a stored account key (env presence locks BYOK for
      # this provider); an account key only counts when `byok: true` on
      # this catalog row.
      source = if ENV[api_key_env_var(provider_key)].present?
        "env"
      elsif provider[:byok] && Revdoku.byok_enabled? && account.respond_to?(:ai_provider_key) && account.ai_provider_key(provider_key)
        "account"
      else
        "none"
      end

      account_model_id = account.respond_to?(:provider_model_id) ? account.provider_model_id(provider_key) : nil
      default_model_id = provider[:default_model_id].to_s.presence
      account_base_url = account.respond_to?(:provider_base_url) ? account.provider_base_url(provider_key) : nil
      default_base_url = provider[:base_url].to_s.presence

      # `custom: true` providers: the model list is owned entirely by the
      # account. Return the user's `models` array (possibly empty) — the
      # catalog's symbolic placeholders (`gemma-family`, `generic`) aren't
      # real models and must never reach the picker. Non-custom providers
      # keep their pinned catalog list.
      models_for_ui =
        if provider[:custom]
          user_models = account.respond_to?(:provider_models) ? account.provider_models(provider_key) : []
          user_models.map do |m|
            {
              # Region prefix differs per edition — use the helper instead
              # of hardcoding "::" so commercial accounts get
              # "us:custom_llm_1:..." (or whatever region this instance
              # runs) and Core stays "::". The id's last segment is the
              # upstream model_id (sent verbatim to the SDK); the friendly
              # alias is exposed via `name` for the picker label.
              id: "#{catalog_region_prefix}#{provider_key}:#{m["model_id"]}",
              name: m["alias"],
              credits_per_page: 0,
              stars: m["stars"] || 1,
              max_pages: 3,
              description: nil
            }
          end
        else
          (provider[:models] || []).map { |m| m.slice(:id, :name, :credits_per_page, :stars, :max_pages, :description) }
        end

      {
        provider_key: provider_key.to_s,
        name: provider[:name],
        hipaa: !!provider[:hipaa],
        zdr: !!provider[:zdr],
        available: available,
        source: source,
        model_id: account_model_id,
        default_model_id: default_model_id,
        # `byok` — owner may store a per-account API key (UI shows Add-key /
        # Rotate / Remove buttons; gated also by instance `byok_enabled`).
        # `custom` — owner may override base_url + maintain a per-account
        # models list (UI shows the custom-LLM editor block; gated also by
        # instance `byok_customizable`).
        byok: !!provider[:byok],
        custom: !!provider[:custom],
        base_url: account_base_url,
        default_base_url: default_base_url,
        models: models_for_ui
      }
    end.compact
  end

  def self.models_for_account(account: nil, operation: :inspection, include_unavailable: false)
    # Seed with catalog models, then REPLACE every `custom: true` provider
    # slice with whatever the account has defined. The catalog's symbolic
    # placeholders (`gemma-family`, `generic`) are always dropped from the
    # flat list — they don't correspond to real models any runtime can serve
    # — so a fresh install with no user-defined list contributes zero rows
    # for the custom provider.
    base = models_visible_in_catalog
    providers_hash.each do |provider_key, provider|
      next unless provider[:custom]
      base = base.reject { |m| m[:provider_key] == provider_key.to_s }
      user_models = account.respond_to?(:provider_models) ? account.provider_models(provider_key) : []
      provider_display = provider[:name].to_s.presence || "Custom"
      user_models.each do |m|
        # `alias` is the picker label (account-scoped, validated for
        # uniqueness in AiProviderKeysController). `model_id` is the
        # upstream API model name and forms the id's last segment.
        entry = {
          # See catalog_region_prefix — Core stays "::", commercial builds
          # get "us:" etc. Hardcoding "::" here would render the row in the
          # picker but make the model unresolvable on commercial deployments
          # because find_model rejects empty regions there.
          id: "#{catalog_region_prefix}#{provider_key}:#{m["model_id"]}",
          name: "#{m["alias"]} (#{provider_display})",
          provider_key: provider_key.to_s,
          provider: provider_key.to_s,
          credits_per_page: 0,
          stars: m["stars"] || 1,
          max_pages: 3
        }
        entry[:revdoku_options] = m["revdoku_options"].to_s.strip.presence if m["revdoku_options"]
        base << entry
      end
    end

    base.filter_map do |model|
      provider_key = model[:provider_key]
      available = provider_available?(provider_key, account: account)

      # HIPAA filter — accounts with hipaa_enabled get filtered to
      # providers flagged `hipaa: true` in the catalog.
      if account&.respond_to?(:hipaa_enabled?) && account.hipaa_enabled?
        next nil unless provider_for(provider_key)&.dig(:hipaa)
      end

      next nil if !available && !include_unavailable
      model.merge(available: available)
    end
  end

  # === Resolution (the core API used by ReportCreationService, CreateReportJob, etc.) ===

  # Returns a config hash for doc-api.
  def self.resolve(model_id = nil, operation: :inspection, account: nil)
    effective_id = model_id.presence || default_model_id(operation)
    raise ModelNotFoundError, "No default AI model configured for operation '#{operation}'." unless effective_id

    Rails.logger.info "[AiModelResolver#resolve] model_id=#{effective_id.inspect} operation=#{operation.inspect} account=#{account&.prefix_id.inspect} tenant=#{((Principal.account rescue nil)&.prefix_id).inspect}" if defined?(Rails)
    model = find_model(effective_id, account: account)
    unless model
      Rails.logger.warn "[AiModelResolver#resolve] FAILED model_id=#{effective_id.inspect} account=#{account&.prefix_id.inspect} — find_model returned nil" if defined?(Rails)
      raise ModelNotFoundError, "AI model '#{effective_id}' is not available. Please open the checklist settings and select a valid AI model."
    end

    if model[:enabled] == false
      raise ModelNotFoundError, "Model is not currently enabled: #{effective_id}"
    end

    provider_key = model[:provider_key]
    provider = provider_for(provider_key) || {}

    # Key resolution — precedence (most-specific wins):
    #   1. account.ai_provider_key(provider) → decrypted api_key inlined into
    #      config_hash[:api_key]. Honoured ONLY for `byok: true` rows AND
    #      when the instance-wide byok_enabled flag is on. The controller
    #      already rejects api_key writes for `byok: false` rows; this is
    #      defence in depth at resolve time, so a residual stored key from
    #      before the YAML flipped never silently overrides the operator's
    #      ENV-managed credential.
    #   2. ENV api_key_env_var → doc-api resolves at request time from process.env
    #
    # base_url is pinned from the catalog for all non-custom providers (users
    # cannot redirect cloud-provider traffic to arbitrary hosts). For
    # `custom: true` providers, the account may override base_url so owners
    # can point Revdoku at their own LM Studio / Ollama / vLLM endpoint or
    # any OpenAI-compatible service. doc-api prefers modelConfig.api_key
    # over process.env[api_key_env_var] when present
    # (apps/services/revdoku-doc-api/src/lib/ai.ts), so Rails only has to
    # decide whether to inline api_key. The api_key_source string is a
    # structured audit-log field for observability.
    account_entry = if account.respond_to?(:ai_provider_keys) && account.ai_provider_keys.is_a?(Hash)
      account.ai_provider_keys[provider_key.to_s]
    end
    byok_allowed = !!provider[:byok] && Revdoku.byok_enabled?
    account_api_key = (byok_allowed && account_entry.is_a?(Hash)) ? account_entry["api_key"].to_s.strip.presence : nil
    env_api_key_present = ENV[api_key_env_var(provider_key)].present?

    # Env wins over per-account BYOK by policy: when the operator has
    # set the env var, that's the only key this instance uses for this
    # provider. A stale account-stored key (e.g. from before the env
    # var was set) is ignored — leaving api_key unset here lets doc-api
    # fall through to process.env[api_key_env_var] (see lib/ai.ts).
    effective_api_key, api_key_source = if env_api_key_present
      [nil, "env"]
    elsif account_api_key
      [account_api_key, "account"]
    else
      [nil, "env"]
    end

    # Per-account base_url override: honoured ONLY for `custom: true` rows.
    account_base_url = nil
    if provider[:custom] && account_entry.is_a?(Hash)
      account_base_url = account_entry["base_url"].to_s.strip.presence
    end

    # Deep-merge provider-level + model-level request_params blocks. doc-api's
    # applyPredefinedParams will deep-merge this into the outgoing request body.
    # Used for things that belong at body roots other than `options` (e.g.
    # OpenRouter's `provider.data_collection: "deny"`). YAML-driven so doc-api
    # never has to grow a new per-provider branch.
    provider_params = (provider[:request_params] || {}).deep_stringify_keys
    model_params    = (model[:request_params]    || {}).deep_stringify_keys
    request_params  = provider_params.deep_merge(model_params)

    # Named preset expansion. A model (or a user-defined local model) can
    # carry `revdoku_options: "<preset_key>"`; the preset supplies defaults
    # for options / grid_mode / ai_coord_scale / response_format / max_pages.
    # Precedence per field: explicit model value > preset value > resolver
    # default. Unknown preset keys resolve to an empty hash (= no-op).
    preset = preset_for(model[:revdoku_options])

    config_hash = {
      id: model[:id],
      alias_id: model[:id],                   # No aliases anymore; echo id for callers that still read alias_id
      provider: provider_key,
      base_url: account_base_url || provider[:base_url] || model[:base_url],
      api_key_env_var: api_key_env_var(provider_key),
      # Precedence: model > preset > provider. Mirrors how `options` /
      # `response_format` / `grid_mode` / `ai_coord_scale` already resolve.
      # Lets a preset (e.g. revdoku_oi_reasoning_1) pin a value the
      # provider-level default would otherwise override — needed because
      # OpenAI's o-series rejects any custom temperature and demands 1.
      temperature: model[:temperature] || preset[:temperature] || provider[:temperature],
      options: model[:options] || preset[:options] || {},
      request_params: request_params,
      response_format: model[:response_format] || preset[:response_format] || "json_schema",
      headers: model[:headers] || provider[:headers] || {},
      hipaa: !!provider[:hipaa],
      zdr: model.key?(:zdr) ? model[:zdr] : (provider[:zdr] || false),
      grid_mode: model[:grid_mode] || preset[:grid_mode],
      ai_coord_scale: model[:ai_coord_scale] || preset[:ai_coord_scale] || 0,
      api_key_source: api_key_source
    }
    # Only inline the api_key when the account supplied one. When absent,
    # doc-api falls through to process.env[api_key_env_var].
    config_hash[:api_key] = effective_api_key if effective_api_key
    config_hash
  end

  # === Private helpers ===

  def self.models_visible_in_catalog
    all_models.reject { |m| m[:enabled] == false }.select { |m| provider_feature_enabled?(m[:provider_key]) }
  end

  private_class_method :models_visible_in_catalog
end
