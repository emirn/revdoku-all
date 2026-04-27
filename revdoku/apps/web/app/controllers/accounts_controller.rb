# frozen_string_literal: true

class AccountsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_account, except: [:index, :new, :create, :select, :choose]
  before_action :authorize_admin, only: [:edit, :update]

  layout "devise", only: [:select]

  # GET /accounts/select
  def select
    @accounts = current_user.accounts.sorted
    # If only one account, skip selection and go straight to app
    if @accounts.count <= 1
      session[:current_account_id] = @accounts.order(:id).first&.id
      return redirect_to stored_location_for(current_user) || authenticated_root_path
    end
  end

  # POST /accounts/select
  def choose
    account = current_user.accounts.find_by(id: params[:account_id])
    unless account
      redirect_to select_account_path, alert: "Account not found."
      return
    end
    session[:current_account_id] = account.id

    # Audit log: record which account the user selected at login
    WardenAuditHelper.create_audit_log!(
      path: "/accounts/select",
      response_code: 200,
      source_type: "WEB",
      user_id: current_user.prefix_id,
      account_id: account.prefix_id,
      ip: request.remote_ip,
      user_agent: request.user_agent&.truncate(100),
      request: { method: "POST", action: "account_select", account_name: account.name }
    )

    redirect_to stored_location_for(current_user) || authenticated_root_path, notice: "Signed in to #{account.name}"
  end

  def index
    @accounts = current_user.accounts.sorted
  end

  def show
    @members = @account.members.sorted.includes(:user)
  end

  def new
    @account = Account.new
  end

  def create
    @account = current_user.owned_accounts.build(account_params)
    @account.personal = false

    if @account.save
      @account.members.create!(user: current_user, role: :owner)
      @account.complete_setup!
      redirect_to @account, notice: "Team created successfully."
    else
      render :new, status: :unprocessable_entity
    end
  end

  def edit
  end

  def update
    if @account.update(account_params)
      redirect_to @account, notice: "Team updated successfully."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def switch
    account = current_user.accounts.find(params[:id])
    session[:current_account_id] = account.id
    redirect_to root_path, notice: "Switched to #{account.name}"
  end

  private

  def set_account
    @account = current_user.accounts.find(params[:id])
  end

  def account_params
    params.require(:account).permit(:name, :avatar)
  end

  def authorize_admin
    membership = @account.members.find_by(user: current_user)
    unless membership&.may_administer_members?
      redirect_to @account, alert: "You are not authorized to perform this action."
    end
  end
end
