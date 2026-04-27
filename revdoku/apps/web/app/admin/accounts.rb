# frozen_string_literal: true

ActiveAdmin.register Account do
  actions :index, :show, :edit, :update

  permit_params :max_envelopes, :max_revisions, :max_checklists, :max_file_size_mb, :max_team_members

  index do
    id_column
    column :name
    column :personal
    column(:owner) { |a| link_to a.owner.name, admin_user_path(a.owner) }
    column(:members) { |a| a.members.count }
    column :security_level
    column :hipaa_enabled
    column :created_at
    actions
  end

  filter :name
  filter :personal
  filter :security_level
  filter :hipaa_enabled
  filter :created_at

  show do
    attributes_table do
      row :id
      row :prefix_id
      row :name
      row :personal
      row :security_level
      row :hipaa_enabled
      row(:owner) { |a| link_to a.owner.name, admin_user_path(a.owner) }
      row :max_envelopes
      row :max_revisions
      row :max_checklists
      row :max_file_size_mb
      row :max_team_members
      row :created_at
      row :updated_at
    end

    panel "Members" do
      table_for resource.members.includes(:user) do
        column(:user) { |m| link_to m.user.name, admin_user_path(m.user) }
        column(:email) { |m| m.user.email }
        column(:role) { |m| m.role }
        column :created_at
      end
    end

  end

  form do |f|
    f.inputs "Account Limits" do
      f.input :max_envelopes, hint: "Maximum number of envelopes (Trial default: 10; paid: 10,000)"
      f.input :max_revisions, hint: "Maximum total revisions across all envelopes (Trial default: 12; paid: 10,000)"
      f.input :max_checklists, hint: "Maximum number of checklists (Trial default: 12; paid: 10,000)"
      f.input :max_file_size_mb, hint: "Maximum file size in MB (Trial default: 20; paid: 50)"
      f.input :max_team_members, hint: "Maximum team members (Trial default: 1; paid: 100)"
    end
    f.actions
  end

  action_item :set_security_level, only: :show do
    unless resource.security_level_high?
      link_to "Set High Security", set_security_level_admin_account_path(resource), method: :post,
        data: { confirm: "Setting security level to HIGH will enforce 15-min sessions, 10-min idle timeout, mandatory 2FA, and full audit logging for all members. This cannot be lowered. Continue?" }
    end
  end

  action_item :enable_hipaa, only: :show do
    unless resource.hipaa_enabled?
      link_to "Enable HIPAA Compliance", enable_hipaa_admin_account_path(resource), method: :post,
        data: { confirm: "Enabling HIPAA compliance will restrict this account to HIPAA-certified AI models only. This cannot be undone. Continue?" }
    end
  end


  member_action :set_security_level, method: :post do
    @account = resource

    if @account.security_level_high?
      flash[:alert] = "Security level is already HIGH."
      redirect_to admin_account_path(@account)
      return
    end

    Account.transaction do
      @account.update!(security_level: :high)

      # Invalidate all session tokens to force re-login with 2FA
      user_ids = @account.user_ids
      sessions = ApiKey.sessions.usable_and_live.where(user_id: user_ids)
      invalidated = sessions.count
      sessions.destroy_all
      Rails.logger.info("[Security] Admin set security_level=high for account #{@account.prefix_id}, invalidated #{invalidated} sessions")
    end

    begin
      AuditLog.create!(
        path: "/admin/accounts/#{@account.id}/set_security_level",
        response_code: 200,
        source_type: "ADMIN",
        user_id: current_active_admin_user&.prefix_id,
        account_id: @account.prefix_id,
        ip: request.remote_ip,
        user_agent: request.user_agent&.truncate(100),
        request: { method: "POST", action: "set_security_level" }
      )
    rescue => e
      Rails.logger.error("[AuditLog] Failed to log set_security_level: #{e.message}")
    end

    flash[:notice] = "Security level set to HIGH for #{@account.name}. All sessions invalidated. This cannot be lowered."
    redirect_to admin_account_path(@account)
  end

  member_action :enable_hipaa, method: :post do
    @account = resource

    if @account.hipaa_enabled?
      flash[:alert] = "HIPAA compliance is already enabled."
      redirect_to admin_account_path(@account)
      return
    end

    @account.update!(hipaa_enabled: true)
    Rails.logger.info("[Security] Admin enabled HIPAA compliance for account #{@account.prefix_id}")

    begin
      AuditLog.create!(
        path: "/admin/accounts/#{@account.id}/enable_hipaa",
        response_code: 200,
        source_type: "ADMIN",
        user_id: current_active_admin_user&.prefix_id,
        account_id: @account.prefix_id,
        ip: request.remote_ip,
        user_agent: request.user_agent&.truncate(100),
        request: { method: "POST", action: "enable_hipaa" }
      )
    rescue => e
      Rails.logger.error("[AuditLog] Failed to log enable_hipaa: #{e.message}")
    end

    flash[:notice] = "HIPAA compliance enabled for #{@account.name}. AI models restricted to HIPAA-certified providers. This cannot be reversed."
    redirect_to admin_account_path(@account)
  end
end
