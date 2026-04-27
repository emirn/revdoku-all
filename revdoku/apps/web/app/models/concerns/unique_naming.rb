# frozen_string_literal: true

module UniqueNaming
  extend ActiveSupport::Concern

  class_methods do
    # Append local timestamp to make a name unique.
    # Example: "Invoice Check" -> "Invoice Check 28 Feb 2026 2:24pm"
    def timestamped_name(base_name, time_zone: "UTC")
      tz = ActiveSupport::TimeZone[time_zone] || ActiveSupport::TimeZone["UTC"]
      local_time = Time.current.in_time_zone(tz)
      stamp = local_time.strftime("%-d %b %Y %-l:%M%P")
      "#{base_name} #{stamp}"
    end
  end
end
