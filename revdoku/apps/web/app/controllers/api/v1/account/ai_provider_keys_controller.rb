# frozen_string_literal: true

# Per-account AI provider API keys. Backed by the encrypted JSON attribute
# Account#ai_provider_keys, so every stored key is Lockbox-encrypted with the
# account's own key and wiped on crypto-shred.
#
# URL surface:
#   GET    /api/v1/account/ai_provider_keys
#   POST   /api/v1/account/ai_provider_keys
#   PATCH  /api/v1/account/ai_provider_keys/:provider
#   DELETE /api/v1/account/ai_provider_keys/:provider
#
# Key validity is established two ways:
#   1. Running an actual review — the doc-api bubbles the upstream provider's
#      401/403 back to Rails. The friendly "Provider rejected the API key
#      (HTTP 401)" message reaches the user via the inspection error display
#      with a link to /account/ai.
#   2. The user-triggered POST :provider/test action (powering the "Test"
#      button on /account/ai → Providers tab). Reuses the same model_config
#      resolution path the review uses; doc-api's /api/v1/ai/test-key fires
#      one 1-token AI call against the resolved model. There is intentionally
#      NO automatic probe-on-save — that would duplicate code paths and add
#      latency to every save without exercising the real call shape.
#
# :provider is a string key matching a row in ai_models.yml (openai,
# google_cloud, custom_llm_1, …). Writes are bounded by the catalog: a
# row must declare `byok: true` to accept api_key writes, and `custom:
# true` to accept base_url / models / preset writes. Unknown provider
# keys default to both flags false and therefore reject every write.
class Api::V1::Account::AiProviderKeysController < Api::BaseController
  skip_after_action :verify_authorized
  before_action :ensure_feature_available!

  # GET index
  # Returns one row per provider in the catalog (plus any "custom" keys the
  # account has configured that aren't in the catalog). Never returns the
  # decrypted key — only a boolean "configured" and the last-4 suffix.
  def index
    keys = current_account.ai_provider_keys || {}
    catalog_providers = AiModelResolver.providers_hash.keys.map(&:to_s)
    all_provider_keys = (catalog_providers + keys.keys).uniq

    rows = all_provider_keys.map do |provider|
      entry = keys[provider]
      catalog = AiModelResolver.provider_for(provider)
      models_list = entry.is_a?(Hash) ? Array(entry["models"]).select do |m|
        m.is_a?(Hash) && m["alias"].to_s.strip.present? && m["model_id"].to_s.strip.present?
      end : []
      {
        provider: provider,
        name: catalog&.dig(:name) || provider.humanize,
        in_catalog: catalog.present?,
        # Per-provider permissions (default false in YAML — must be opted in).
        # `byok`   — user may store their own API key.
        # `custom` — user may override base_url + maintain a per-account
        #            models list.
        byok: !!catalog&.dig(:byok),
        custom: !!catalog&.dig(:custom),
        configured: entry.is_a?(Hash) && entry["api_key"].to_s.strip.present?,
        enabled: entry.is_a?(Hash) ? (entry["enabled"] != false) : false,
        key_suffix: entry.is_a?(Hash) ? mask(entry["api_key"]) : nil,
        model_id: entry.is_a?(Hash) ? entry["model_id"].to_s.strip.presence : nil,
        default_model_id: catalog&.dig(:default_model_id).to_s.presence,
        base_url: entry.is_a?(Hash) ? entry["base_url"].to_s.strip.presence : nil,
        default_base_url: catalog&.dig(:base_url).to_s.presence,
        # User-defined custom-provider models — each row carries its own
        # `revdoku_options` (per-row preset). Structured objects leave
        # room for stars / description without a format change.
        models: models_list,
        env_var_fallback_available: catalog &&
          ENV[AiModelResolver.api_key_env_var(provider)].present?
      }
    end

    render_api_success({ keys: rows })
  end

  # POST create — upsert on provider
  def create
    upsert_from_params
  end

  # PATCH update — upsert on :provider URL segment
  def update
    upsert_from_params(provider_override: params[:provider])
  end

  # DELETE destroy
  def destroy
    current_account.remove_ai_provider_key(params[:provider])
    render_api_success(removed: params[:provider])
  end

  # POST test — fire one 1-token AI call against the provider's saved or
  # default model to verify the key + model are reachable. Reuses the same
  # AiModelResolver path a real review uses so success here means the next
  # review will also pass auth. No automatic probe — only triggered by the
  # user clicking the Test button on /account/ai.
  def test
    provider = params[:provider].to_s.strip
    return render_api_bad_request("provider is required") if provider.blank?

    catalog = AiModelResolver.provider_for(provider)
    model_id = current_account.provider_model_id(provider).presence ||
               catalog&.dig(:default_model_id).to_s.presence
    return render_api_bad_request("no model configured for #{provider}") if model_id.blank?

    # Resolver expects a region-prefixed model id. Custom-provider model
    # rows only carry the per-provider sub-id, so prepend the region +
    # provider segments. Catalog providers (openai, google_cloud, …) ship
    # default_model_id as the bare api name, which also needs prefixing.
    full_model_id = if model_id.start_with?("#{AiModelResolver.effective_region}:")
      model_id
    else
      "#{AiModelResolver.catalog_region_prefix}#{provider}:#{model_id}"
    end

    begin
      model_config = AiModelResolver.resolve(full_model_id, operation: :inspection, account: current_account)
    rescue AiModelResolver::ModelNotFoundError => e
      return render json: { ok: false, message: e.message }
    end

    result = RevdokuDocApiClient.client.test_key(model_config)
    render json: result
  end

  private

  def upsert_from_params(provider_override: nil)
    provider = (provider_override || params[:provider]).to_s.strip
    return render_api_bad_request("provider is required") if provider.blank?

    catalog = AiModelResolver.provider_for(provider)
    is_byok_provider   = !!catalog&.dig(:byok)
    is_custom_provider = !!catalog&.dig(:custom)

    # Debug: log incoming params (secrets masked) + which kwargs we'll send
    # to Account#set_ai_provider_key. Paired with the after-write log below.
    safe_params = params.to_unsafe_h.except(:controller, :action, :format, :provider).merge(
      api_key: params[:api_key].present? ? "[#{params[:api_key].to_s.length} chars]" : nil
    )
    Rails.logger.info "[AiProviderKeys] upsert_from_params provider=#{provider} byok=#{is_byok_provider} custom=#{is_custom_provider} params=#{safe_params.inspect}"

    # Two write gates:
    #   1. api_key writes require BOTH the instance flag (Revdoku.byok_enabled?)
    #      AND the per-row catalog flag (`byok: true`). Either disabled →
    #      reject. When BYOK is disabled at the instance level, the resolver
    #      will fall through to the operator's <PROVIDER_KEY>_API_KEY env var
    #      at request time, so doc-api still works.
    #   2. base_url / models writes require the per-row catalog flag
    #      (`custom: true`). The instance-wide `byok_customizable` flag
    #      controls whether the row is even reachable in the UI; this
    #      controller guard is defence in depth against direct API calls.
    has_api_key  = params.key?(:api_key)  && params[:api_key].to_s.strip.present?
    has_model_id = params.key?(:model_id)
    has_enabled  = params.key?(:enabled)
    has_base_url = params.key?(:base_url)
    has_models   = params.key?(:models)

    if has_api_key && !Revdoku.byok_enabled?
      return render_api_forbidden("Per-account API keys are not allowed on this instance — set the operator's #{provider.upcase}_API_KEY env var instead.")
    end

    if has_api_key && !is_byok_provider
      return render_api_forbidden("Per-account API keys are not accepted for this provider (operator-managed only).")
    end

    # Env wins over per-account BYOK by policy: when the operator has
    # configured #{PROVIDER}_API_KEY, the per-account key form is hidden
    # in the UI and writes are rejected here as defence in depth. The
    # resolver honours the same rule — see AiModelResolver#provider_available?
    # and #resolve.
    if has_api_key && ENV[AiModelResolver.api_key_env_var(provider)].present?
      return render_api_forbidden("This provider's key is configured by the operator via #{AiModelResolver.api_key_env_var(provider)} — per-account keys are disabled while it's set.")
    end

    if (has_base_url || has_models) && !is_custom_provider
      has_base_url = false
      has_models = false
    end

    unless has_api_key || has_model_id || has_enabled || has_base_url || has_models
      return render_api_bad_request("provide api_key, model_id, enabled, base_url, or models")
    end

    kwargs = {}
    kwargs[:api_key]  = params[:api_key].to_s if has_api_key
    kwargs[:enabled]  = ActiveModel::Type::Boolean.new.cast(params[:enabled]) if has_enabled
    # Empty string clears the preference; any non-empty string wins.
    kwargs[:model_id] = params[:model_id].to_s if has_model_id
    kwargs[:base_url] = params[:base_url].to_s if has_base_url

    if has_models
      raw = params[:models]
      raw = raw.to_unsafe_h.values if raw.respond_to?(:to_unsafe_h)
      normalized = Array(raw).filter_map do |m|
        m = m.to_unsafe_h if m.respond_to?(:to_unsafe_h)
        next nil unless m.is_a?(Hash)
        m.stringify_keys
      end

      # E3 — alias uniqueness + format validation. Bail before persisting so
      # a partial save can't leave the account with a colliding alias.
      validation_error = validate_custom_models(provider, normalized)
      if validation_error
        return render_api_error(validation_error, status: :unprocessable_entity, code: "ALIAS_VALIDATION_ERROR")
      end

      kwargs[:models] = normalized
    end

    Rails.logger.info "[AiProviderKeys] kwargs → set_ai_provider_key(#{provider}, #{kwargs.except(:api_key).inspect}#{kwargs.key?(:api_key) ? ', api_key: [REDACTED]' : ''})"

    current_account.set_ai_provider_key(provider, **kwargs)
    current_account.reload

    entry = current_account.ai_provider_keys&.dig(provider) || {}
    Rails.logger.info "[AiProviderKeys] after save provider=#{provider} entry_keys=#{entry.keys.inspect} base_url_stored=#{entry["base_url"].inspect} models_count=#{Array(entry["models"]).size}"

    render_api_success({
      provider: provider,
      configured: entry["api_key"].to_s.strip.present?,
      enabled: entry["enabled"] != false,
      model_id: entry["model_id"].to_s.strip.presence,
      base_url: entry["base_url"].to_s.strip.presence,
      models: Array(entry["models"]).select do |m|
        m.is_a?(Hash) && m["alias"].to_s.strip.present? && m["model_id"].to_s.strip.present?
      end
    })
  end

  # E3 — alias rules:
  #   - Format: letters first, then letters/digits/space/_/- (1-64 chars).
  #   - In-provider uniqueness: an alias may not appear twice in the same
  #     custom provider's models list.
  #   - Built-in collision: an alias may not equal any built-in alias's
  #     suffix (after the region prefix) OR display name (case-insensitive).
  #   - Cross-custom-provider collision IS allowed by design (per user
  #     direction): the same alias may live in custom_llm_1 AND custom_llm_2.
  #     The picker disambiguates with the "(provider name)" suffix already
  #     applied in models_for_account.
  #
  # Returns nil on success, an error message string on the first failure.
  ALIAS_FORMAT = /\A[A-Za-z][A-Za-z0-9 _\-]{0,63}\z/

  def validate_custom_models(provider_key, models_normalized)
    seen = Set.new
    builtin_blocked = builtin_alias_names_set

    models_normalized.each do |m|
      alias_name = m["alias"].to_s.strip
      model_id   = m["model_id"].to_s.strip
      next if alias_name.blank? || model_id.blank?  # set_ai_provider_key drops these silently

      unless alias_name.match?(ALIAS_FORMAT)
        return "Alias '#{alias_name}' is not a valid identifier (letters first, then letters / digits / space / underscore / hyphen, ≤64 chars)."
      end

      key = alias_name.downcase
      if seen.include?(key)
        return "Alias '#{alias_name}' is used more than once in #{provider_key}. Each alias must be unique within a provider."
      end
      seen << key

      if builtin_blocked.include?(key)
        return "Alias '#{alias_name}' collides with a built-in alias — pick a different name."
      end
    end

    nil
  end

  # Set of built-in alias identifiers a custom alias must not collide with.
  # Includes both the alias-id suffix (after the region prefix) and the
  # display name, lowercased, so neither "gpt-normal" nor "GPT · Standard"
  # can be re-used as a custom alias.
  def builtin_alias_names_set
    Set.new.tap do |set|
      AiModelResolver.aliases_for_account(account: current_account).each do |a|
        # alias id is "<region>:<slug>" — keep only the slug
        slug = a[:id].to_s.split(":", 2).last
        set << slug.to_s.downcase if slug.present?
        set << a[:name].to_s.downcase if a[:name].present?
      end
    end
  end

  # Returns "<prefix>…<suffix>" so the chip in /account/ai is recognisable
  # without leaking the secret. Most providers ship keys with a stable
  # prefix (sk-, sk-or-v1-, AKIA…) — surfacing 6 leading chars plus the
  # last 4 lets owners tell two saved keys apart at a glance. Short keys
  # (< 12 chars) collapse to last-4-only since a prefix would overlap.
  def mask(key)
    key = key.to_s
    return nil if key.length < 4
    return "…#{key[-4..]}" if key.length < 12
    "#{key[0, 6]}…#{key[-4..]}"
  end

  # The controller is always reachable — the per-action gates live inside
  # #upsert_from_params (api_key writes need byok_enabled + per-row `byok`;
  # base_url / models writes need per-row `custom`). Kept as a hook so an
  # operator overlay can short-circuit the entire endpoint by redefining it.
  def ensure_feature_available!
    nil
  end
end
