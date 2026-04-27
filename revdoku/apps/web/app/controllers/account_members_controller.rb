# frozen_string_literal: true

class AccountMembersController < ApplicationController
  before_action :authenticate_user!
  before_action :set_account
  before_action :set_account_member, only: [:edit, :update, :destroy]
  before_action :authorize_admin

  def edit
  end

  def update
    if @account_member.update(account_member_params)
      redirect_to @account, notice: "Member updated successfully."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  def destroy
    if @account_member.dischargeable?
      @account_member.destroy
      redirect_to @account, notice: "Member removed."
    else
      redirect_to @account, alert: "Cannot remove account owner."
    end
  end

  private

  def set_account
    @account = current_user.accounts.find(params[:account_id])
  end

  def set_account_member
    @account_member = @account.members.find(params[:id])
  end

  def account_member_params
    params.require(:account_member).permit(:role)
  end

  def authorize_admin
    membership = @account.members.find_by(user: current_user)
    unless membership&.may_administer_members?
      redirect_to @account, alert: "You are not authorized to manage members."
    end
  end
end
