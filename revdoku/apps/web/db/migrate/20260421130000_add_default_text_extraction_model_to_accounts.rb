# frozen_string_literal: true

class AddDefaultTextExtractionModelToAccounts < ActiveRecord::Migration[8.1]
  def change
    add_column :accounts, :default_text_extraction_model, :string
  end
end
