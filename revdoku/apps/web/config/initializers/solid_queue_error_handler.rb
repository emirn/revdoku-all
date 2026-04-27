# frozen_string_literal: true

# Forward Solid Queue job failures to ExceptionNotification
# so background errors (e.g. email delivery failures) get reported.
Rails.application.config.solid_queue.on_thread_error = ->(exception) do
  Rails.logger.error("[SolidQueue] Thread error: #{exception.class} - #{exception.message}\n#{exception.backtrace.first(5).join("\n")}")
end
