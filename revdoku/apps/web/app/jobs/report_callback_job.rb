# frozen_string_literal: true

# Posts a terminal-status notification to the callback URL stored in
# Report#meta["callback_url"]. Default implementation is a no-op so call
# sites can enqueue unconditionally; deployments that need real HTTP
# delivery prepend a module replacing #perform.
class ReportCallbackJob < ApplicationJob
  queue_as :default

  def perform(_report_prefix_id, _status)
  end
end
