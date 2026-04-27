# frozen_string_literal: true

class CleanupExpiredTokensJob < ApplicationJob
  queue_as :default

  def perform
    scope = ApiKey.lapsed_or_past_expiry
    if dry_run?
      Rails.logger.info("CleanupExpiredTokensJob: [DRY RUN] would delete #{scope.count} expired tokens")
    else
      deleted = scope.delete_all
      Rails.logger.info("CleanupExpiredTokensJob: deleted #{deleted} expired tokens")
    end
  end
end
