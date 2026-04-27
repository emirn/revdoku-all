# frozen_string_literal: true

# Track-changes is no longer a per-checklist property. It moved to a
# per-review runtime flag on the Review dialog that only appears when
# the current envelope revision has a prior revision to diff against.
# Keeping it on the Checklist row would silently re-enable for every
# review of every revision, which is exactly the conflation we're
# removing.
#
# Snapshot checklists stored inside Report#inspection_context still
# carry `track_changes` at the JSON level — that remains correct, since
# a report snapshot records what ran for that specific run.
class DropTrackChangesFromChecklists < ActiveRecord::Migration[8.1]
  def change
    remove_column :checklists, :track_changes, :boolean, default: false, null: false
  end
end
