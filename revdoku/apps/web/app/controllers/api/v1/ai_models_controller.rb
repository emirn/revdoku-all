# frozen_string_literal: true

class Api::V1::AiModelsController < Api::BaseController
  skip_after_action :verify_authorized # Read-only config data, no resource authorization needed

  # GET /api/v1/ai_models
  # Emits the provider-centric catalog. Frontend uses this for the /account/ai
  # page (provider rows + default-model dropdowns) and the Review dialog's
  # per-run model override.
  #
  # Each model entry carries an `available` boolean — true when a working key
  # is configured for its provider (on the current account, or via the
  # instance's ENV var fallback). Unavailable providers still render in the
  # picker with disabled rows so users can see what they could unlock by
  # configuring a key or upgrading their plan.
  def index
    AiModelResolver.reset_cache! if Rails.env.development?

    # Rich, nested shape keyed on provider. Single payload covers both the
    # provider picker (`providers` array) and the default-model dropdowns
    # (same `providers[].models`, pre-filtered for availability and HIPAA).
    providers = AiModelResolver.providers_for_account(account: current_account).map do |p|
      {
        provider_key: p[:provider_key],
        name: p[:name],
        hipaa: p[:hipaa],
        zdr: p[:zdr],
        available: p[:available],
        source: p[:source], # "account" | "env" | "none"
        # Account's preferred sub-provider model id (e.g. "gpt-4.1-2025-04-14");
        # nil when the owner hasn't chosen one — UI falls back to default_model_id.
        model_id: p[:model_id],
        default_model_id: p[:default_model_id],
        # Per-provider permissions from the catalog (defaults false).
        # `byok`   — UI may render the Add-key form (also gated by instance
        #            byok_enabled).
        # `custom` — UI may render the base_url + per-account models editor
        #            (also gated by instance byok_customizable).
        byok: p[:byok],
        custom: p[:custom],
        base_url: p[:base_url],
        default_base_url: p[:default_base_url],
        models: p[:models]
      }
    end

    # Flat list for the Review / envelope dropdowns that want "every
    # selectable model" without regrouping. `include_unavailable: true`
    # keeps grey-out rows in the picker so the user sees what's coming.
    all_models = AiModelResolver.models_for_account(
      account: current_account,
      operation: :inspection,
      include_unavailable: true
    ).map { |m| serialize_model(m) }

    # Named aliases — the ONLY thing the picker should render. Each alias
    # targets an ordered list of concrete model ids and resolves to the
    # first whose provider is reachable with the current account's keys.
    # The chosen alias id flows through to the report request and is
    # resolved to a concrete model at call time by AiModelResolver.
    aliases = AiModelResolver.aliases_for_account(account: current_account).map { |a| serialize_alias(a) }

    # Named behaviour presets (`revdoku_options`). The Providers tab's local
    # provider row uses this list to populate its "Default preset" dropdown
    # so the user can pick how Rails should configure the request envelope
    # for every model they've registered locally.
    revdoku_option_presets = AiModelResolver.presets.map do |key, preset|
      { key: key, desc: preset[:desc].to_s.presence }
    end

    render_api_success({
      providers: providers,
      models: all_models,
      aliases: aliases,
      revdoku_option_presets: revdoku_option_presets,
      default_model_id: current_account&.default_ai_model(:inspection) || AiModelResolver.default_model_id(:inspection),
      default_checklist_generation_model_id: current_account&.default_ai_model(:checklist_generation) || AiModelResolver.default_model_id(:checklist_generation),
      default_text_extraction_model_id: current_account&.default_ai_model(:text_extraction) || AiModelResolver.default_model_id(:text_extraction),
      # Region context for the picker. Always single-item — the deployment
      # locks to one region (Revdoku.default_region). The frontend's
      # "single region → render read-only label" branch handles display.
      available_regions: AiModelResolver.available_regions,
      preferred_region: AiModelResolver.effective_region,
      feature_flags: {
        hipaa_mode: Revdoku.hipaa_mode_enabled?,
        byok_customizable: Revdoku.byok_customizable_enabled?,
        byok_enabled: Revdoku.byok_enabled?
      }
    })
  end

  private

  def serialize_model(model)
    provider_key = model[:provider_key] || model[:provider]
    preset = AiModelResolver.preset_for(model[:revdoku_options])
    {
      id: model[:id],
      name: model[:name],
      provider: provider_key,
      provider_name: AiModelResolver.provider_name(provider_key),
      badges: build_badges(model, provider_key),
      available: model[:available] != false,
      disabled: !(model[:available] != false && model[:enabled] != false),
      disabled_text: disabled_text_for(model),
      credits_per_page: model[:credits_per_page] || AiModelResolver::DEFAULT_CREDITS_PER_PAGE,
      stars: model[:stars] || 1,
      max_pages: model[:max_pages] || preset[:max_pages],
      hipaa: AiModelResolver.model_is_hipaa?(model[:id]),
      description: model[:description],
      description_checklist: model[:description_checklist]
    }
  end

  def serialize_alias(a)
    providers = alias_providers(a[:targets])
    fully_unconfigured = !a[:available]
    # When zero providers are configured, swap the authored "(auto)" suffix
    # on the alias name for "(NO providers configured!)". This puts the
    # warning on the MOST visible surface — the picker label itself
    # ("GPT-4.1 (NO providers configured!) ★★★ · 10 cr/page") — instead of
    # hiding it inside a separate disabled_text parenthetical. disabled_text
    # is cleared in that branch so the frontend doesn't double-annotate.
    display_name =
      if fully_unconfigured
        a[:name].to_s.sub(/\s*\(auto\)\s*/i, " ").strip + " (NO providers configured!)"
      else
        a[:name]
      end
    {
      id: a[:id],
      name: display_name,
      provider: "alias",
      provider_name: "Auto",
      badges: (["Auto"] + (a[:hipaa] ? ["HIPAA"] : [])).compact,
      available: !fully_unconfigured,
      disabled: fully_unconfigured,
      # Cleared when the name already carries "(NO providers configured!)"
      # — otherwise the picker label duplicates the warning.
      disabled_text: nil,
      credits_per_page: a[:credits_per_page],
      stars: a[:stars] || 3,
      hipaa: a[:hipaa],
      description: a[:description],
      targets: a[:targets],
      resolved_id: a[:resolved_id],
      # Ordered provider list the alias will try at resolve time. Each entry
      # carries a `configured` flag so the UI can surface "[not configured]"
      # warnings per provider without calling a second endpoint.
      providers: providers
    }
  end

  # Walk an alias's targets and return one ordered entry per provider with
  # its configured state. De-duplicates if the same provider appears in
  # multiple targets (it shouldn't in practice, but guard is cheap).
  def alias_providers(targets)
    seen = {}
    Array(targets).each do |target_id|
      # parse_model_id returns :provider (the YAML key, same string
      # providers_for_account uses when calling provider_available?). The
      # earlier :provider_key spelling silently produced nil → an empty
      # alias_providers list → every alias target rendering as "(not
      # configured!)" in the Aliases tab even when the provider's env key
      # was set.
      key = AiModelResolver.parse_model_id(target_id)[:provider].to_s
      next if key.blank? || seen.key?(key)
      seen[key] = {
        key: key,
        name: AiModelResolver.provider_name(key),
        configured: AiModelResolver.provider_available?(key, account: current_account)
      }
    end
    seen.values
  end

  def build_badges(model, provider_key)
    badges = [AiModelResolver.provider_name(provider_key)]
    badges << "HIPAA" if AiModelResolver.model_is_hipaa?(model[:id]) && Revdoku.hipaa_mode_enabled?
    badges.compact
  end

  def disabled_text_for(model)
    return nil if model[:available] != false && model[:enabled] != false
    return "coming soon" if model[:enabled] == false
    return "Configure #{AiModelResolver.provider_name(model[:provider_key])} provider" if model[:available] == false
    nil
  end
end
