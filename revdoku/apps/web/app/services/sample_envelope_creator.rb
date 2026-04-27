# frozen_string_literal: true

# Creates a sample envelope with a completed report for new accounts,
# so first-time users see an example of what an inspected document looks like.
#
# Delegates to EnvelopeFixtureImporter for the actual import logic.
# The fixture JSON at FIXTURE_PATH is self-contained: it embeds the PDF as
# base64 and includes checklist snapshot data, report checks, and coordinates.
#
# Depends on the account's default checklists already existing (the
# `create_default_checklists` callback runs before `create_sample_envelope`
# in Account) — only needed when fixture lacks embedded checklist_snapshot.
class SampleEnvelopeCreator
  FIXTURE_PATH = Rails.root.join("config", "sample_data", "sample_envelope_fixture.json")

  class << self
    def create_for_account(account)
      return if account.envelopes.any? # idempotency guard

      fixture = load_fixture
      return unless fixture

      result = EnvelopeFixtureImporter.call(account, fixture)
      unless result[:success]
        Rails.logger.warn("SampleEnvelopeCreator: import failed: #{result[:message]}")
      end
    end

    private

    def load_fixture
      return nil unless File.exist?(FIXTURE_PATH)
      JSON.parse(File.read(FIXTURE_PATH))
    rescue JSON::ParserError => e
      Rails.logger.error("SampleEnvelopeCreator: bad fixture JSON: #{e.message}")
      nil
    end
  end
end
