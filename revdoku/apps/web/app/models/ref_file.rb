# frozen_string_literal: true

# Pins a specific DocumentFileRevision to an EnvelopeRevision for use by
# rule-file enrichment at inspection time. Two flavors:
#
#   - Rule-scoped: `rule_id` set to a specific merged rule id → the file
#     satisfies a `#file` / `file:<id>` marker inside that rule's prompt.
#   - Checklist-scoped: `rule_id` NULL → the file is a general reference
#     attached to the whole checklist (satisfies a marker inside the
#     checklist's `system_prompt`).
#
# A `position` column lets one target hold multiple files in the future;
# v1 enforces length 1 via application-level validation (the Checklist
# marker-count validator + the controller's pre-flight check).
#
# Pins live on EnvelopeRevision, not on Report, so that re-runs on the
# same revision (reset / checklist switch / resume) reuse the same files
# without forcing the user to re-upload. Each Report's `enriched_rules`
# still freezes the exact revision ids it used at run time — that's the
# immutable history. The pin table is the mutable "what's currently
# attached to this envelope revision".
class RefFile < AccountRecord
  has_prefix_id :rref

  belongs_to :envelope_revision
  belongs_to :document_file_revision
  # Plaintext FK — see migration AddChecklistIdToRefFiles for the
  # rationale. Nullable for backfill safety; always set by new pins.
  belongs_to :checklist, optional: true

  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :rule_id, uniqueness: { scope: [:envelope_revision_id, :position] }, allow_nil: true
  validate :unique_checklist_scoped_pin

  before_validation :set_account_from_envelope_revision, on: :create

  scope :for_rule, ->(rule_id) { where(rule_id: rule_id).order(:position) }
  scope :checklist_scoped, -> { where(rule_id: nil).order(:position) }
  scope :rule_scoped, -> { where.not(rule_id: nil) }

  # Convenience: true when this pin is attached to the checklist as a whole
  # rather than to a specific rule.
  def checklist_scoped?
    rule_id.nil?
  end

  private

  def set_account_from_envelope_revision
    self.account ||= envelope_revision&.account
  end

  # ActiveModel's :uniqueness validator treats NULL as distinct, so we
  # enforce the checklist-scoped (rule_id NULL) unique-per-position rule
  # manually. A partial unique index in the DB provides the hard guarantee;
  # this AR-level check just produces a clean error for callers.
  def unique_checklist_scoped_pin
    return unless rule_id.nil?
    return unless envelope_revision_id

    scope = RefFile.where(envelope_revision_id: envelope_revision_id, rule_id: nil, position: position)
    scope = scope.where.not(id: id) if persisted?
    return unless scope.exists?

    errors.add(:base, "checklist-scoped reference file already exists at this position")
  end
end
