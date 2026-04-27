# frozen_string_literal: true

ActiveAdmin.register_page "Dashboard" do
  menu priority: 1, label: "Dashboard"

  content title: "Revdoku Admin Dashboard" do
    div class: "admin-dashboard" do
      panel "Usage Summary" do
        table_for [
          ["Users", User.count],
          ["Accounts", Account.count],
          ["Envelopes", Envelope.unscoped.count],
          ["Reports", Report.unscoped.count],
          ["Checklists", Checklist.unscoped.templates.count]
        ] do
          column("Metric") { |row| row[0] }
          column("Count") { |row| row[1] }
        end
      end

      panel "Recent Signups (last 10)" do
        table_for User.order(created_at: :desc).limit(10) do
          column(:name) { |u| link_to u.name, admin_user_path(u) }
          column(:email)
          column(:signed_up) { |u| u.created_at.strftime("%b %d, %Y %H:%M") }
          column(:admin) { |u| status_tag(u.admin? ? "Yes" : "No") }
        end
      end

      panel "Recent Login Activity (last 10)" do
        table_for LoginHistory.includes(:user).order(signed_in_at: :desc).limit(10) do
          column(:user) { |lh| link_to lh.user.name, admin_user_path(lh.user) }
          column(:email) { |lh| lh.user.email }
          column(:signed_in_at) { |lh| lh.signed_in_at.strftime("%b %d, %Y %H:%M") }
          column(:ip_address)
        end
      end
    end
  end
end
