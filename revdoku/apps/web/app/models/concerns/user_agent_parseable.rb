# frozen_string_literal: true

module UserAgentParseable
  extend ActiveSupport::Concern

  class_methods do
    def parse_user_agent(ua_string)
      ua = ua_string.to_s

      browser = case ua
                when /Edg/i then "Edge"
                when /OPR|Opera/i then "Opera"
                when /Chrome/i then "Chrome"
                when /Firefox/i then "Firefox"
                when /Safari/i then "Safari"
                else "Unknown browser"
                end

      os = case ua
           when /Windows/i then "Windows"
           when /Macintosh|Mac OS/i then "macOS"
           when /iPhone/i then "iOS"
           when /iPad/i then "iPadOS"
           when /Android/i then "Android"
           when /Linux/i then "Linux"
           else "Unknown OS"
           end

      device_type = case ua
                    when /Mobi|iPhone/i then "mobile"
                    when /iPad|Tablet/i then "tablet"
                    else "desktop"
                    end

      { "browser" => browser, "os" => os, "device_type" => device_type }
    end
  end

  def display_device
    info = device_info.presence || {}
    browser = info["browser"].presence || "Unknown browser"
    os = info["os"].presence || "Unknown OS"
    "#{browser} on #{os}"
  end
end
