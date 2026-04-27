class AddUserScriptsToChecklistTemplates < ActiveRecord::Migration[8.1]
  def change
    add_column :checklist_templates, :user_scripts, :json, default: []
  end
end
