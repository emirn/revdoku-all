# Be sure to restart your server when you modify this file.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  # Security credentials
  :passw, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc,
  # Per-account AI provider keys — sent on /api/v1/account/ai_provider_keys
  # CRUD and echoed in the resolved model_config passed to doc-api. `api_key`
  # and `base_url` scrub both paths from Rails logs. doc-api has its own
  # redaction (see src/lib/log-utils.ts).
  :api_key, :base_url, :ai_provider_keys,

  # HIPAA 18 identifiers — names, contact, demographics
  :name, :first_name, :last_name, :email, :phone, :fax,
  :address, :street, :city, :zip, :postal_code,
  :date_of_birth, :dob, :age,

  # HIPAA 18 identifiers — medical & financial
  :medical_record, :mrn, :health_plan, :account_number,
  :diagnosis, :treatment, :medication, :lab_result,
  :condition, :procedure, :vital_sign, :allergy,
  :biometric, :photo, :face_image,

  # App-specific PHI — filtered from API audit logs to prevent PHI duplication
  :rules, :system_prompt, :description, :source_text, :comment, :title,

  # File content — must never appear in any log (stored in S3 with versioning)
  :data, :file_data, :file_content, :base64,

  # Dynamic catch-changes for health/medical/patient/file fields
  -> (key, value) {
    value.replace("[PHI FILTERED]") if key.to_s.match?(/patient|medical|health|clinical/i)
  },
  -> (key, value) {
    if value.is_a?(String) && value.length > 1024 && key.to_s.match?(/data|content|body|blob|file/i)
      value.replace("[LARGE CONTENT FILTERED #{value.bytesize} bytes]")
    end
  }
]
