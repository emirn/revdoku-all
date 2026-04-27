class AddEmailToEnvelopeSupport < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    # Action Mailbox storage (from the gem install template). The unique index
    # on [message_id, message_checksum] is what dedups SNS redeliveries in
    # production — mailboxes never see duplicate bytes twice.
    create_table :action_mailbox_inbound_emails do |t|
      t.integer :status, default: 0, null: false
      t.string  :message_id, null: false
      t.string  :message_checksum, null: false
      t.timestamps
      t.index [ :message_id, :message_checksum ],
        unique: true, name: "index_action_mailbox_inbound_emails_uniqueness"
    end

    # Per-account inbound-routing token used in uploads+<token>@<domain>.
    add_column :accounts, :inbound_token, :string

    Account.reset_column_information
    Account.where(inbound_token: nil).find_each do |account|
      loop do
        token = SecureRandom.urlsafe_base64(18)
        break account.update_columns(inbound_token: token) unless Account.exists?(inbound_token: token)
      end
    end

    change_column_null :accounts, :inbound_token, false
    add_index :accounts, :inbound_token, unique: true

    # Encrypted JSON blob on envelopes carrying everything we know about the
    # inbound email: forwarder, parser result, original-from/subject/date,
    # source Message-ID. See Envelope#inbound_metadata.
    add_column :envelopes, :inbound_metadata_ciphertext, :text
  end

  def down
    remove_column :envelopes, :inbound_metadata_ciphertext

    remove_index :accounts, :inbound_token
    remove_column :accounts, :inbound_token

    drop_table :action_mailbox_inbound_emails
  end
end
