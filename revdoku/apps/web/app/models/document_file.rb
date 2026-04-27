# frozen_string_literal: true

class DocumentFile < AccountRecord
  include UserTrackable

  has_prefix_id :df

  belongs_to :envelope, optional: true
  has_many :document_file_revisions, dependent: :destroy

  scope :account_scoped, -> { where(envelope_id: nil) }
  scope :library, -> { where(envelope_id: nil, reference: true) }

  before_validation :set_account_from_envelope, on: :create
  before_destroy :guard_referenced_by_ref_files

  def library?
    reference? && envelope_id.nil?
  end

  private

  def set_account_from_envelope
    self.account ||= envelope&.account
  end

  def guard_referenced_by_ref_files
    revision_ids = document_file_revisions.pluck(:id)
    return if revision_ids.empty?

    return unless RefFile.where(document_file_revision_id: revision_ids).exists?

    errors.add(:base, "Cannot delete a file that is referenced by an envelope revision. Delete the referencing envelope revisions first.")
    throw :abort
  end
end
