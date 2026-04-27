# frozen_string_literal: true

# Account-scoped AI catalog region. Drives which slice of the
# `shared.regions.<name>` tree the resolver reads for this account.
# HIPAA-enabled accounts are forced to "us" by Account model validation.
class AddPreferredRegionToAccounts < ActiveRecord::Migration[8.1]
  def change
    add_column :accounts, :preferred_region, :string, default: "any", null: false
  end
end
