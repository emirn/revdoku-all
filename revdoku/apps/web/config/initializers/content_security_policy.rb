# Be sure to restart your server when you modify this file.

# Define an application-wide content security policy.
# See the Securing Rails Applications Guide for more information:
# https://guides.rubyonrails.org/security.html#content-security-policy-header

Rails.application.configure do
  config.content_security_policy do |policy|
    policy.default_src :self
    policy.font_src    :self, :data
    policy.img_src     :self, :data, :blob
    policy.object_src  :none
    policy.script_src  :self
    policy.connect_src :self, :blob

    # Allow @vite/client to hot reload javascript changes in development
    if Rails.env.development?
      policy.script_src  *policy.script_src, :unsafe_eval, "http://#{ViteRuby.config.host_with_port}"
      policy.connect_src *policy.connect_src, "ws://#{ViteRuby.config.host_with_port}", "http://#{ViteRuby.config.host_with_port}"
    end

    # Allow blob: for PDF.js worker
    policy.script_src *policy.script_src, :blob if Rails.env.test?
    policy.worker_src :self, :blob

    # Allow inline styles for PDF.js rendering and shadcn/ui components
    policy.style_src :self, :unsafe_inline

    # Extension hook for deployments to append additional source domains.
    Revdoku.extend_content_security_policy(policy)
  end

  # Generate nonces for inline scripts
  config.content_security_policy_nonce_generator = ->(request) { SecureRandom.base64(16) }
  config.content_security_policy_nonce_directives = %w[script-src]

  # Enforce the Content Security Policy
  config.content_security_policy_report_only = false
end
