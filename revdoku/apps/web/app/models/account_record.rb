# frozen_string_literal: true

class AccountRecord < ApplicationRecord
  self.abstract_class = true
  acts_as_tenant :account
end
