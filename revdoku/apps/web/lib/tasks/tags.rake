# frozen_string_literal: true

namespace :tags do
  desc "Create default tags for accounts that have none, and auto-tag existing envelopes from their reports"
  task backfill: :environment do
    Account.find_each do |account|
      ActsAsTenant.with_tenant(account) do
        DefaultTagLoader.create_for_account(account) if account.tags.none?

        account.envelopes.kept.find_each do |envelope|
          report = envelope.latest_report
          next unless report&.checklist

          source_checklist = report.checklist.source_checklist || report.checklist
          AutoTagger.tag_from_checklist(envelope, source_checklist)
        end
      end
    end

    puts "Tags backfill completed."
  end
end
