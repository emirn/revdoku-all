class AddDefaultForNewAccountToChecklistTemplates < ActiveRecord::Migration[8.1]
  # Column only; population is driven by the `*Name` prefix in
  # config/default_checklist_templates.txt, applied on deploy by
  # `rake checklist_templates:sync` (run from db/seeds.rb).
  def up
    add_column :checklist_templates, :default_for_new_account, :boolean, default: false, null: false
  end

  def down
    remove_column :checklist_templates, :default_for_new_account
  end
end
