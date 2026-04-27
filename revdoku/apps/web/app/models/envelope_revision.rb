# frozen_string_literal: true

class EnvelopeRevision < AccountRecord
  include AccountEncryptable
  include UserTrackable

  has_prefix_id :envrv

  has_encrypted :comment, key: :lockbox_encryption_key
  has_encrypted :revision_rules, key: :lockbox_encryption_key, type: :json

  belongs_to :envelope, touch: true

  before_validation :set_account_from_envelope, on: :create

  has_and_belongs_to_many :document_file_revisions,
                          join_table: :document_file_revisions_envelope_revisions

  # Returns file revisions in user-specified order (by position column on join table).
  # Use this instead of `document_file_revisions` when display order matters.
  # Cannot use an order scope on the HABTM itself because Rails preloader
  # loads records in a separate query without joining the join table.
  def ordered_document_file_revisions
    DocumentFileRevision
      .joins("INNER JOIN document_file_revisions_envelope_revisions ON document_file_revisions_envelope_revisions.document_file_revision_id = document_file_revisions.id")
      .where("document_file_revisions_envelope_revisions.envelope_revision_id = ?", id)
      .order("document_file_revisions_envelope_revisions.position ASC")
  end

  has_one :report, dependent: :destroy
  has_many :ref_files, dependent: :destroy

  validates :revision_number, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  # --- Custom Rules (envelope-level user rules stored per revision) ---

  # Normalization module prepended AFTER has_encrypted so it wraps Lockbox's getter.
  # MRO: RevisionRulesOverride#revision_rules → Lockbox's revision_rules (decrypts) → AR attribute
  # IMPORTANT: Using `def revision_rules` directly would REPLACE the Lockbox getter,
  # causing super to skip decryption entirely (data silently lost as []).
  module RevisionRulesOverride
    def revision_rules
      value = super
      value.is_a?(Array) ? value : []
    end
  end
  prepend RevisionRulesOverride

  # Add a custom rule to this revision
  def add_revision_rule(prompt:, created_by_id: nil)
    next_seq = (revision_rules.map { |r| extract_crule_seq(r[:id] || r["id"]) }.compact.max || -1) + 1

    new_rule = {
      id: "#{prefix_id}_crule_#{next_seq}",
      prompt: prompt,
      order: revision_rules.length,
      origin: "user",
      created_by_id: created_by_id,
      source_envelope_revision_id: prefix_id
    }.compact

    update!(revision_rules: revision_rules + [new_rule])
    new_rule
  end

  # Add multiple custom rules in a single database write
  def add_revision_rules_batch(rules_data)
    new_rules = revision_rules.dup
    next_seq = (new_rules.map { |r| extract_crule_seq(r[:id] || r["id"]) }.compact.max || -1) + 1

    rules_data.each do |data|
      new_rules << {
        id: "#{prefix_id}_crule_#{next_seq}",
        prompt: data[:prompt],
        order: new_rules.length,
        origin: "user",
        created_by_id: data[:created_by_id],
        source_envelope_revision_id: prefix_id
      }.compact
      next_seq += 1
    end

    update!(revision_rules: new_rules)
    new_rules
  end

  # Remove a custom rule by ID (only for this revision's own rules)
  def remove_revision_rule(rule_id)
    updated = revision_rules.reject { |r| (r[:id] || r["id"]).to_s == rule_id.to_s }
    update!(revision_rules: updated)
  end

  # Update a custom rule's prompt by ID
  def update_revision_rule(rule_id, prompt:)
    updated = revision_rules.map do |r|
      if (r[:id] || r["id"]).to_s == rule_id.to_s
        r.merge("prompt" => prompt)
      else
        r
      end
    end
    update!(revision_rules: updated)
  end

  # Collect revision_rules from ALL revisions of the same envelope (rev 0..this),
  # ordered by revision_number. Each rule already has source_envelope_revision_id.
  def all_revision_rules
    EnvelopeRevision
      .where(envelope: envelope)
      .where("revision_number <= ?", revision_number)
      .order(:revision_number)
      .flat_map(&:revision_rules)
  end

  # Collect reference files from ALL revisions of the same envelope up to
  # (and including) this one — mirrors all_revision_rules. The user sees a
  # unified list without revision boundaries; each RefFile still
  # records which envelope_revision it was added in via the FK.
  #
  # For files that appear in multiple revisions (e.g. the user kept the
  # same quote across rev 0 and rev 1), dedup by (rule_id, position) —
  # the latest revision's pin wins.
  def all_ref_files
    revision_ids = EnvelopeRevision
      .where(envelope: envelope)
      .where("revision_number <= ?", revision_number)
      .order(:revision_number)
      .pluck(:id)
    # Latest revision wins for each (rule_id, position) tuple
    RefFile
      .where(envelope_revision_id: revision_ids)
      .includes(:document_file_revision)
      .order(:position)
      .index_by { |rf| [rf.rule_id, rf.position] }
      .values
  end

  # Serialized metadata for every reference file pinned anywhere in this
  # envelope's revision history up to (and including) this revision.
  # Using the cross-revision set — not just THIS revision's `ref_files`
  # — means chip rendering for a check description whose marker cites a
  # dfrev from an older revision still resolves to a filename instead of
  # showing the raw prefix_id.
  # Consumers: reports_controller#format_report,
  # envelopes_controller#serialize_envelope_revision, HighlightOverlay
  # chip rendering.
  def ref_files_meta
    all_ref_files.filter_map do |pin|
      rev = pin.document_file_revision
      next nil unless rev
      text_content = Array(rev.page_texts).map { |p| p["text"] || p[:text] }.join("\n\n")
      {
        document_file_revision_prefix_id: rev.prefix_id,
        rule_id: pin.rule_id,
        mime_type: rev.mime_type,
        filename: rev.name,
        description: rev.name,
        text_content: text_content.presence,
        already_in_library: rev.in_account_library?
      }
    end
  end

  def as_json(options = {})
    base = super(options)
    base["comment"] = comment
    base["revision_rules"] = revision_rules
    base.except("comment_ciphertext", "revision_rules_ciphertext")
  end

  validate :unique_document_file_revisions

  def add_document_file_revision(document_file_revision)
    return if document_file_revisions.include?(document_file_revision)

    max_pos = self.class.connection.select_value(
      "SELECT MAX(position) FROM document_file_revisions_envelope_revisions WHERE envelope_revision_id = #{id}"
    )
    next_position = (max_pos || -1) + 1

    self.class.connection.execute(
      "INSERT INTO document_file_revisions_envelope_revisions (envelope_revision_id, document_file_revision_id, position) VALUES (#{id}, #{document_file_revision.id}, #{next_position})"
    )

    document_file_revisions.reset
  end

  def add_document_file_revisions(revisions)
    revisions.each { |revision| add_document_file_revision(revision) }
  end

  def previous_revision
    rev_number = revision_number
    return nil if rev_number.nil? || rev_number <= 0

    EnvelopeRevision.where(envelope: envelope)
                    .where(revision_number: rev_number - 1)
                    .order(:id)
                    .first
  end

  private

  def set_account_from_envelope
    self.account ||= envelope&.account
  end

  def extract_crule_seq(rule_id)
    return nil unless rule_id.is_a?(String)
    match = rule_id.match(/_crule_(\d+)\z/)
    match ? match[1].to_i : nil
  end

  def unique_document_file_revisions
    return unless document_file_revisions.any?

    revision_ids = document_file_revisions.map(&:id)
    if revision_ids.uniq.length != revision_ids.length
      errors.add(:document_file_revisions, "cannot contain duplicates")
    end
  end
end
