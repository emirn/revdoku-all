# frozen_string_literal: true

ActiveAdmin.register User do
  permit_params :first_name, :last_name, :email

  scope :all, default: true
  scope("With UTM") { |s| s.where.not(utm_source: nil) }
  scope("No UTM") { |s| s.where(utm_source: nil) }

  index do
    selectable_column
    id_column
    column :first_name
    column :last_name
    column :email
    column :admin
    column :utm_source
    column :sign_in_count
    column :current_sign_in_at
    column :created_at
    actions
  end

  filter :email
  filter :first_name
  filter :last_name
  filter :admin
  filter :utm_source
  filter :utm_campaign
  filter :utm_medium
  filter :created_at

  show do
    attributes_table do
      row :id
      row :prefix_id
      row :first_name
      row :last_name
      row :email
      row :admin
      row :sign_in_count
      row :current_sign_in_at
      row :last_sign_in_at
      row :current_sign_in_ip
      row :last_sign_in_ip
      row :confirmed_at
      row :two_factor_enabled do |u|
        status_tag(u.two_factor_enabled? ? "Enabled" : "Disabled")
      end
      row :created_at
      row :updated_at
    end

    panel "Signup Source" do
      attributes_table_for resource do
        row :utm_source
        row :utm_medium
        row :utm_campaign
        row :utm_content
        row :utm_term
      end
    end

    panel "Accounts" do
      table_for resource.accounts do
        column(:name) { |a| link_to a.name, admin_account_path(a) }
        column :personal
        column :created_at
      end
    end

    panel "Recent Logins" do
      table_for resource.login_histories.order(signed_in_at: :desc).limit(10) do
        column :signed_in_at
        column :ip_address
        column :user_agent
      end
    end
  end

  form do |f|
    f.inputs do
      f.input :first_name
      f.input :last_name
      f.input :email
    end
    f.actions
  end
end
