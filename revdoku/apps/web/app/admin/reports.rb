# frozen_string_literal: true

ActiveAdmin.register Report do
  actions :index, :show

  controller do
    def scoped_collection
      Report.unscoped
    end
  end

  index do
    id_column
    column(:account) { |r| r.account ? link_to(r.account.name, admin_account_path(r.account)) : "N/A" }
    column :job_status
    column :ai_model
    column(:checks) { |r| Check.unscoped.where(report_id: r.id).count }
    column :created_at
    actions
  end

  filter :job_status
  filter :ai_model
  filter :created_at

  show do
    attributes_table do
      row :id
      row :prefix_id
      row(:account) { |r| r.account ? link_to(r.account.name, admin_account_path(r.account)) : "N/A" }
      row(:envelope_id) { |r| r.envelope_revision.envelope_id }
      row :envelope_revision_id
      row :job_status
      row :ai_model
      row(:checks_count) { |r| Check.unscoped.where(report_id: r.id).count }
      row :error_message
      row :created_at
      row :updated_at
    end
  end
end
