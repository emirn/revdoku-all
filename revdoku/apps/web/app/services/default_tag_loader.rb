# frozen_string_literal: true

# Creates 7 default color tags for new accounts (macOS Finder-style).
class DefaultTagLoader
  DEFAULTS = [
    { name: "Red",    color: "red",    position: 0 },
    { name: "Orange", color: "orange", position: 1 },
    { name: "Yellow", color: "yellow", position: 2 },
    { name: "Green",  color: "green",  position: 3 },
    { name: "Blue",   color: "blue",   position: 4 },
    { name: "Purple", color: "purple", position: 5 },
    { name: "Gray",   color: "gray",   position: 6 }
  ].freeze

  class << self
    def create_for_account(account)
      return if account.tags.any?

      DEFAULTS.each do |attrs|
        account.tags.create!(attrs)
      end
    end
  end
end
