# frozen_string_literal: true

# View façade for Cloudflare Turnstile bot challenge. Views call
# `turnstile_widget` / `turnstile_script_tag` unconditionally; the
# default implementation emits empty HTML. Deployments that install
# the `rails_cloudflare_turnstile` gem replace these methods at boot
# via a method override.
module TurnstileHelper
  def turnstile_widget
    "".html_safe
  end

  def turnstile_script_tag
    "".html_safe
  end
end
