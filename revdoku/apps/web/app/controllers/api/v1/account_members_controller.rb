# frozen_string_literal: true

class Api::V1::AccountMembersController < Api::BaseController
  skip_after_action :verify_authorized # Access controlled by authorize_admin! before_action
  before_action :authorize_admin!
  before_action :set_account_member, only: [:destroy]

  # POST /api/v1/account/members
  # Direct add-by-email: the owner supplies an email; the user must already
  # have a Revdoku account. If so, create an AccountMember link immediately;
  # the added user simply logs in and sees the new account. CE keeps this
  # flow minimal — no invitation tokens, no accept/decline state, no emails.
  def create
    email = params[:email].to_s.strip.downcase
    return render_api_bad_request("Email is required") if email.blank?

    unless current_account.can_add_member?
      return render_api_error("Seat limit reached for this account", status: :unprocessable_entity)
    end

    user = User.find_by(email: email)
    unless user
      return render_api_error(
        "No Revdoku account exists for #{email}. Ask the user to sign up first, then add them.",
        status: :unprocessable_entity
      )
    end

    if current_account.users.exists?(id: user.id)
      return render_api_error("#{email} is already a member of this account", status: :unprocessable_entity)
    end

    member = current_account.members.create!(user: user, role: :collaborator)
    render_api_created({ member: serialize_member(member) })
  end

  # DELETE /api/v1/account/members/:id
  def destroy
    unless @account_member.dischargeable?
      return render_api_error("Account owner cannot be removed", status: :unprocessable_entity)
    end

    @account_member.destroy
    render_api_success({ message: "Member removed" })
  end

  private

  def set_account_member
    @account_member = current_account.members.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    render_api_not_found("Member not found")
  end

  def authorize_admin!
    unless Principal.account_member&.may_administer_members?
      render_api_forbidden("Only administrators can manage members")
    end
  end

  def serialize_member(member)
    {
      id: member.id,
      user: {
        id: member.user.prefix_id,
        email: member.user.email,
        name: member.user.name.presence || member.user.email
      },
      role: member.role,
      created_at: member.created_at
    }
  end
end
