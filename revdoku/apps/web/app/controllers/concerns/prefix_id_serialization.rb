# frozen_string_literal: true

module PrefixIdSerialization
  extend ActiveSupport::Concern

  # Convert internal IDs to prefix_ids in response objects
  # This ensures we never expose internal database IDs in API responses

  def change_id_to_prefix_in_object(record, json_options: {})
    return nil if record.nil?

    data = record.as_json(json_options)
    data = data.with_indifferent_access

    # Replace id with prefix_id
    if record.respond_to?(:prefix_id) && record.prefix_id.present?
      data[:id] = record.prefix_id
    end

    # Remove internal id field
    data.delete("id") if data[:id].blank?

    # Convert foreign key references
    convert_foreign_keys(data, record)

    data
  end

  private

  def convert_foreign_keys(data, record)
    # Common foreign key patterns
    foreign_key_patterns = %w[
      account_id user_id envelope_id checklist_id report_id
      envelope_revision_id document_file_id envelope_checklist_id
      invited_by_id owner_id created_by_id updated_by_id
    ]

    foreign_key_patterns.each do |fk|
      next unless data.key?(fk)

      association_name = fk.sub(/_id$/, "")
      reflection = record.class.reflect_on_association(association_name.to_sym)
      next data.delete(fk) unless reflection

      # Only resolve prefix_id from already-loaded associations to avoid N+1 queries
      if record.association(association_name).loaded?
        associated = record.send(association_name)
        if associated.respond_to?(:prefix_id) && associated.prefix_id.present?
          data[fk] = associated.prefix_id
        end
      else
        # Remove raw internal ID to avoid exposing it in the API
        data.delete(fk)
      end
    end
  end
end
