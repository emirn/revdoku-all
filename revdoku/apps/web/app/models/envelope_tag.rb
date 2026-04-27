# frozen_string_literal: true

class EnvelopeTag < ApplicationRecord
  belongs_to :envelope
  belongs_to :tag
  validates :tag_id, uniqueness: { scope: :envelope_id }
end
