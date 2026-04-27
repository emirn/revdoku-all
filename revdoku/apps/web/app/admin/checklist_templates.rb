# frozen_string_literal: true

ActiveAdmin.register ChecklistTemplate do
  menu priority: 8

  permit_params :name, :system_prompt, :visible, :sort_order, :default_for_new_account

  index do
    id_column
    column :name
    column(:rules_count) { |t| t.rules.is_a?(Array) ? t.rules.size : 0 }
    column :visible
    column("Default", :default_for_new_account) { |t| t.default_for_new_account? ? status_tag("Yes", class: "ok") : "" }
    column :sort_order
    column :created_at
    actions
  end

  filter :name
  filter :visible
  filter :default_for_new_account, label: "Default for new accounts"
  filter :created_at

  show do
    attributes_table do
      row :id
      row :name
      row :system_prompt
      row(:rules_count) { |t| t.rules.is_a?(Array) ? t.rules.size : 0 }
      row(:rules) do |t|
        ul do
          (t.rules || []).each do |rule|
            li rule["prompt"] || rule[:prompt]
          end
        end
      end
      row :visible
      row("Default for new accounts") { |t| t.default_for_new_account? ? "Yes" : "No" }
      row :sort_order
      row :created_at
      row :updated_at
    end
  end

  form do |f|
    f.inputs do
      f.input :name
      f.input :system_prompt, as: :text
      f.input :visible
      f.input :default_for_new_account, label: "Default for new accounts", hint: "When on, this template is auto-created as a Checklist on every new account via DefaultChecklistLoader."
      f.input :sort_order
    end
    f.actions
  end

  # Custom import page
  action_item :import, only: :index do
    link_to "Import from Text", import_admin_checklist_templates_path
  end

  collection_action :import, method: :get do
    render "admin/checklist_templates/import"
  end

  collection_action :do_import, method: :post do
    text = params[:text].to_s.strip
    if text.blank?
      redirect_to import_admin_checklist_templates_path, alert: "No text provided."
      return
    end

    result = ChecklistTemplate.import_from_text(text)
    imported_names = result[:imported].map(&:name)
    skipped_names = result[:skipped]

    parts = []
    parts << "Imported #{imported_names.size}: #{imported_names.join(', ')}" if imported_names.any?
    parts << "Skipped #{skipped_names.size} duplicates: #{skipped_names.join(', ')}" if skipped_names.any?

    redirect_to admin_checklist_templates_path, notice: parts.join(" | ").presence || "Nothing to import."
  end
end
