# frozen_string_literal: true

# Filter large string arguments from ActiveJob log output to prevent
# base64-encoded file data from flooding development logs.
#
# Rails' filter_parameters only applies to HTTP params, not ActiveJob arguments.
# This subscriber replaces the default ActiveJob logging and truncates any
# string argument longer than 1 KB.

ActiveSupport.on_load(:active_job) do
  ActiveJob::LogSubscriber.class_eval do
    private

    def args_info(job)
      return "" if job.arguments.blank?

      filtered = job.arguments.map do |arg|
        if arg.is_a?(String) && arg.bytesize > 1024
          "[FILTERED #{arg.bytesize} bytes]"
        else
          arg.inspect
        end
      end

      " with arguments: #{filtered.join(', ')}"
    end
  end
end
