# frozen_string_literal: true

ActiveAdmin.register Checklist do
  actions :index, :show

  controller do
    def scoped_collection
      Checklist.unscoped
    end
  end

  index do
    id_column
    column :name
    column(:account) { |c| link_to c.account.name, admin_account_path(c.account) }
    column :ai_model
    column(:rules_count) { |c| c.rules.is_a?(Array) ? c.rules.size : 0 }
    column :created_at
    actions
  end

  filter :created_at

  show do
    attributes_table do
      row :id
      row :prefix_id
      row :name
      row(:account) { |c| link_to c.account.name, admin_account_path(c.account) }
      row :ai_model
      row(:rules_count) { |c| c.rules.is_a?(Array) ? c.rules.size : 0 }
      row :created_at
      row :updated_at
    end
  end
end
