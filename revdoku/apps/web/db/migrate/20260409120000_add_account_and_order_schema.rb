# frozen_string_literal: true

# Three small schema changes on accounts + orders + envelope_revisions
# that all shipped in the same April 9–12 window:
#
#   1. Unique partial index on orders.(source, order_ref) for webhook
#      idempotency — each external event id can appear at most once.
#   2. envelope_revisions.account_id — denormalized for ActsAsTenant scoping;
#      backfilled from the parent envelope's account_id.
#   3. accounts.previous_subscription_sku — remembers the last paid SKU
#      after cancellation, for "resubscribe to previous plan" nudges.
class AddAccountAndOrderSchema < ActiveRecord::Migration[8.1]
  def up
    add_index :orders, [:source, :order_ref],
              unique: true,
              where: "source LIKE 'external%' AND order_ref IS NOT NULL",
              name: "index_orders_on_external_order_ref"

    add_reference :envelope_revisions, :account,
                  null: true, foreign_key: true, index: true
    execute <<~SQL.squish
      UPDATE envelope_revisions
      SET account_id = (
        SELECT envelopes.account_id
        FROM envelopes
        WHERE envelopes.id = envelope_revisions.envelope_id
      )
    SQL
    change_column_null :envelope_revisions, :account_id, false

    add_column :accounts, :previous_subscription_sku, :string
  end

  def down
    remove_column :accounts, :previous_subscription_sku
    remove_reference :envelope_revisions, :account, foreign_key: true
    remove_index :orders, name: "index_orders_on_external_order_ref"
  end
end
