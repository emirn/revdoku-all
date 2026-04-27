class ApplicationJob < ActiveJob::Base
  # Automatically retry jobs that encountered a deadlock
  # retry_on ActiveRecord::Deadlocked

  # Most jobs are safe to ignore if the underlying records are no longer available
  # discard_on ActiveJob::DeserializationError

  # DRY RUN is ON by default. Set DRY_RUN=false in environment to execute real mutations.
  def dry_run?
    ENV.fetch("DRY_RUN", "true").downcase != "false"
  end
end
