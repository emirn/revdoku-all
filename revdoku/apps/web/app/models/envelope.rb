# frozen_string_literal: true

class Envelope < AccountRecord
  include AccountEncryptable
  include UserTrackable
  include UniqueNaming

  has_prefix_id :env

  has_encrypted :title, key: :lockbox_encryption_key
  has_encrypted :user_scripts, key: :lockbox_encryption_key, type: :json
  has_encrypted :inbound_metadata, key: :lockbox_encryption_key, type: :json

  store :report_settings, accessors: [
    :show_checklist_name, :show_rules, :show_audit_logs, :show_title_info,
    :show_compliance_summary, :show_compliance_percent, :show_default_footer, :last_checklist_id,
    :show_page_images, :show_check_details, :show_extracted_data, :show_pages_with_checks,
    :show_pages_without_checks, :show_checklist_info, :show_checklist_general_prompt,
    :show_checklist_rules_summary, :show_checklist_rules_details,
    :show_checklist_envelope_rules, :show_timezone, :show_revision_comparison,
    :show_check_attribution, :show_envelope_datetime, :show_envelope_revisions_info,
    :show_checklist_ai_model, :show_page_filenames, :show_page_summary_icons,
    :show_group_header, :show_group_checklist, :show_group_pages,
    :show_group_footer, :show_checklist_ai_model_info
  ], coder: JSON
  store :view_settings, accessors: [
    :check_filter, :report_check_filter, :report_layout_mode, :show_annotations, :view_mode,
    :raw_font_family, :raw_highlight_mode, :raw_label_font_scale,
    :ref_viewer_x, :ref_viewer_y, :ref_viewer_width, :ref_viewer_height
  ], coder: JSON

  VALID_HIGHLIGHT_MODES = [0, 1, 2, 3].freeze
  VALID_FONT_FAMILIES = %w[sans-serif serif monospace].freeze

  def label_font_scale
    (raw_label_font_scale || 1.0).to_f
  end

  def label_font_scale=(value)
    self.raw_label_font_scale = value.to_f.clamp(0.5, 3.0)
  end

  def highlight_mode
    mode = raw_highlight_mode
    mode.present? ? mode.to_i : Checklist.highlight_modes[:rectangle]
  end

  def highlight_mode=(value)
    int_val = value.to_i
    self.raw_highlight_mode = VALID_HIGHLIGHT_MODES.include?(int_val) ? int_val : nil
  end

  def font_family
    raw_font_family
  end

  def font_family=(value)
    self.raw_font_family = VALID_FONT_FAMILIES.include?(value.to_s) ? value.to_s : nil
  end

  belongs_to :account
  has_many :document_files, dependent: :destroy
  has_many :envelope_revisions, dependent: :destroy
  has_many :reports, through: :envelope_revisions, dependent: :destroy
  has_many :envelope_tags, dependent: :destroy
  has_many :tags, through: :envelope_tags

  validates :title, length: { maximum: 255 }, allow_blank: true

  # Virtual attribute — pass `auto_tag_paths: ["Source/Email"]` on create/update
  # and each path is resolved (or created) via AutoTagger#tag_by_path! after
  # save. Paths use "/" to express hierarchy; intermediate tags are auto-created
  # and linked via parent_tag. Idempotent.
  attr_accessor :auto_tag_paths
  after_save :apply_auto_tag_paths

  # Status enum for envelope workflow
  enum :status, {
    new: 0,
    working: 1,
    completed: 3
  }, prefix: true

  # Source tracking: how was this envelope created?
  enum :source, { web: 0, api: 1, email: 2 }, prefix: true

  # Archive scopes
  scope :active, -> { where(archived_at: nil) }
  scope :archived, -> { where.not(archived_at: nil) }

  # Starred scope
  scope :starred, -> { where(starred: true) }

  MAX_AUTO_TITLE_LENGTH = 150

  # Generates a title from an array of filenames, keeping extensions
  # @param filenames [Array<String>] Array of filenames
  # @return [String] Combined title, truncated to MAX_AUTO_TITLE_LENGTH characters
  def self.generate_title_from_filenames(filenames)
    return "" if filenames.blank?

    # Keep full filenames (including extension), sanitize for safe display
    sanitized_names = filenames.map do |filename|
      ActionController::Base.helpers.strip_tags(filename).strip
    end

    combined = sanitized_names.join(" ")

    # Truncate to max length, avoiding cutting in the middle of a word if possible
    if combined.length > MAX_AUTO_TITLE_LENGTH
      truncated = combined[0, MAX_AUTO_TITLE_LENGTH]
      # Try to cut at the last space to avoid cutting mid-word
      last_space = truncated.rindex(" ")
      if last_space && last_space > MAX_AUTO_TITLE_LENGTH / 2
        truncated = truncated[0, last_space]
      end
      truncated.strip
    else
      combined
    end
  end

  # Updates the envelope title from document file revision names if title is blank
  # @param file_revisions [Array<DocumentFileRevision>] File revisions to extract names from
  def update_title_from_files!(file_revisions)
    return unless title.blank?
    return if file_revisions.blank?

    filenames = file_revisions.map(&:name).compact
    new_title = self.class.generate_title_from_filenames(filenames)
    update!(title: new_title) if new_title.present?
  end

  # after_save callback — resolve/create each path via AutoTagger and attach.
  # Nil/empty lists are a no-op so the callback is free to run on every save.
  def apply_auto_tag_paths
    paths = Array(auto_tag_paths).map(&:to_s).map(&:strip).reject(&:empty?)
    return if paths.empty?

    self.auto_tag_paths = nil  # one-shot: don't re-apply on later saves
    paths.each { |path| AutoTagger.tag_by_path!(self, path) }
  end

  def editable?
    !archived? && !status_completed?
  end

  # Archive the envelope (hide from main view)
  def archive!
    update!(archived_at: Time.current)
  end

  # Unarchive the envelope (restore to main view)
  def unarchive!
    update!(archived_at: nil)
  end

  def archived?
    archived_at.present?
  end

  # Access check - only account members can access envelopes
  # Optimized: account membership is already verified in set_current_context,
  # so avoid loading the full account.users collection.
  def accessible_by?(user)
    return true if Principal.account && account_id == Principal.account.id
    account.users.include?(user)
  end

  # All account members have full permissions
  # Write permissions are restricted when envelope is locked
  def user_permissions(user)
    return {} unless accessible_by?(user)

    can_write = !archived?

    {
      envelope_view: true,
      envelope_revision_create: can_write,
      envelope_revision_manage: can_write,
      report_create: can_write,
      report_view: true,
      report_check_create: can_write,
      envelope_meta_edit: can_write,
      report_export: true,
      envelope_delete: can_write,
      envelope_archive: true
    }
  end

  def can?(user, permission)
    user_permissions(user)[permission.to_sym] == true
  end

  def can_any?(user, *permissions)
    perms = user_permissions(user)
    permissions.any? { |p| perms[p.to_sym] == true }
  end

  def can_all?(user, *permissions)
    perms = user_permissions(user)
    permissions.all? { |p| perms[p.to_sym] == true }
  end

  def user_role(user)
    accessible_by?(user) ? "owner" : nil
  end

  # Permission check helpers - all account members have full access
  def can_view?(user)
    accessible_by?(user)
  end

  def can_create_revision?(user)
    accessible_by?(user)
  end

  def can_manage_revisions?(user)
    accessible_by?(user)
  end

  def can_run_report?(user)
    accessible_by?(user)
  end

  def can_view_report?(user)
    accessible_by?(user)
  end

  def can_add_manual_checks?(user)
    accessible_by?(user)
  end

  def can_edit_metadata?(user)
    accessible_by?(user)
  end

  def can_export?(user)
    accessible_by?(user)
  end

  def can_delete?(user)
    accessible_by?(user)
  end

  def owner?(user)
    accessible_by?(user)
  end

  def all_users_with_access
    account.users
  end

  def as_json(options = {})
    base = super(options)
    base["title"] = title
    base.except("title_ciphertext", "locked", "locked_at", "locked_by_id")
  end

  def latest_report
    envelope_revisions.order(revision_number: :desc).first&.report
  end

  def self.ransackable_attributes(auth_object = nil)
    %w[status created_at source archived_at starred]
  end
end
