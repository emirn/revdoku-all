# frozen_string_literal: true

class Tag < AccountRecord
  include AccountEncryptable

  has_prefix_id :tag
  has_encrypted :name, key: :lockbox_encryption_key

  belongs_to :account
  belongs_to :parent_tag, class_name: "Tag", optional: true
  has_many :child_tags, class_name: "Tag", foreign_key: :parent_tag_id, dependent: :destroy
  has_many :envelope_tags, dependent: :destroy
  has_many :envelopes, through: :envelope_tags

  COLORS = %w[red orange yellow green blue purple gray].freeze

  validates :color, inclusion: { in: COLORS }
  validate :parent_tag_must_belong_to_same_account
  validate :prevent_cycles

  scope :ordered, -> { order(position: :asc) }

  # --- Batch methods (avoid N+1 when processing multiple tags) ---

  # Computes full_path for all tags in the collection using in-memory lookup.
  # Returns { tag.id => "Grandparent/Parent/Child" }.
  # All tags must already be loaded (no extra queries).
  def self.compute_full_paths(tags)
    tag_map = tags.index_by(&:id)
    paths = {}

    compute = ->(tag) {
      return paths[tag.id] if paths.key?(tag.id)
      if tag.parent_tag_id.nil? || !tag_map.key?(tag.parent_tag_id)
        paths[tag.id] = tag.name
      else
        parent_path = compute.call(tag_map[tag.parent_tag_id])
        paths[tag.id] = "#{parent_path}/#{tag.name}"
      end
      paths[tag.id]
    }

    tags.each { |t| compute.call(t) }
    paths
  end

  # Collects all descendant IDs of root_id from an already-loaded collection.
  # Returns an array of integer IDs (does NOT include root_id itself).
  def self.descendant_ids_from_collection(tags, root_id)
    children_map = tags.group_by(&:parent_tag_id)
    result = []
    queue = [root_id]
    while (current_id = queue.shift)
      (children_map[current_id] || []).each do |child|
        result << child.id
        queue << child.id
      end
    end
    result
  end

  # --- Instance methods (convenience, but trigger queries per call) ---

  # Returns all ancestor tags from parent up to root (bottom-up order).
  # NOTE: Triggers one query per ancestor level. Prefer compute_full_paths for batch use.
  def ancestors
    chain = []
    current = parent_tag
    while current
      chain << current
      current = current.parent_tag
    end
    chain
  end

  # Returns all descendant tags (recursive).
  # NOTE: Triggers one query per node. Prefer descendant_ids_from_collection for batch use.
  def descendants
    result = []
    child_tags.each do |child|
      result << child
      result.concat(child.descendants)
    end
    result
  end

  # Returns self plus all descendants
  def self_and_descendants
    [self] + descendants
  end

  # Computes the full display path like "Grandparent/Parent/Child".
  # NOTE: Triggers N queries (one per ancestor). Prefer compute_full_paths for batch use.
  def full_path
    (ancestors.reverse.map(&:name) + [name]).join("/")
  end

  private

  def parent_tag_must_belong_to_same_account
    return unless parent_tag_id.present?
    return unless parent_tag

    if parent_tag.account_id != account_id
      errors.add(:parent_tag, "must belong to the same account")
    end
  end

  def prevent_cycles
    # New records have nil id — nothing can reference them, so no cycle is possible
    return unless parent_tag_id.present? && persisted?

    if ancestors.any? { |a| a.id == id }
      errors.add(:parent_tag, "would create a cycle")
    end
  end
end
