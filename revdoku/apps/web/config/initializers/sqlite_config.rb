# frozen_string_literal: true

# SQLite3 Configuration
#
# This initializer applies performance optimizations to all SQLite databases
# and creates audit log triggers for HIPAA compliance.

module SqliteConfig
  class << self
    def apply_performance_pragmas(connection)
      # Write-Ahead Logging for better concurrency
      connection.execute("PRAGMA journal_mode = WAL;")

      # Synchronous mode NORMAL for better performance with WAL
      # FULL would be safer but significantly slower
      connection.execute("PRAGMA synchronous = NORMAL;")

      # Busy timeout to handle concurrent access.
      # Previously 5000ms. That wasn't enough to cover the tail of a
      # CreateReportJob winding down (ActiveStorage purge+attach of rendered
      # pages cache, per-check update_column from renumber_check_indices,
      # account balance writes from adjust_credits) when a resume/re-run
      # fires on another Solid Queue thread in the same worker process
      # (config/queue.yml: threads: 3). Bumped to 30s so the incoming
      # transaction waits for the outgoing one rather than failing with
      # SQLite3::BusyException.
      connection.execute("PRAGMA busy_timeout = 30000;")

      # Foreign key enforcement
      connection.execute("PRAGMA foreign_keys = ON;")

      # Cache size (negative value = KB, positive = pages)
      # -20000 = 20MB cache
      connection.execute("PRAGMA cache_size = -20000;")

      # Memory-mapped I/O for better read performance
      # 256MB mmap
      connection.execute("PRAGMA mmap_size = 268435456;")

      # Temporary tables in memory
      connection.execute("PRAGMA temp_store = MEMORY;")
    end
  end
end

# Configure ActiveRecord to apply performance pragmas on connection
Rails.application.config.after_initialize do
  ActiveSupport.on_load(:active_record) do
    ActiveRecord::ConnectionAdapters::SQLite3Adapter.class_eval do
      alias_method :original_configure_connection, :configure_connection

      def configure_connection
        original_configure_connection

        # Apply performance pragmas
        SqliteConfig.apply_performance_pragmas(@raw_connection)
      end
    end
  end
end

# Create SQLite triggers for audit log immutability (HIPAA compliance)
# This runs after migrations to ensure the audit_logs table exists in the audit database
Rails.application.config.after_initialize do
  connection = AuditLog.connection
  next unless connection.table_exists?(:audit_logs)

  # Create update prevention trigger
  connection.execute(<<~SQL)
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs cannot be modified per HIPAA compliance requirements');
    END;
  SQL

  # Create delete prevention trigger
  connection.execute(<<~SQL)
    CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit logs cannot be deleted per HIPAA compliance requirements');
    END;
  SQL
rescue => e
  # Don't fail startup if triggers can't be created (e.g., during migrations)
  Rails.logger.warn("Could not create audit log triggers: #{e.message}")
end

# ─────────────────────────────────────────────────────────────────────────────
# SQLite FK cascade protection for destructive ALTER TABLE operations.
#
# PROBLEM: Rails' SQLite3 adapter implements `remove_column`, `change_column`,
# etc. by calling `alter_table` → `move_table` → `copy_table` + `drop_table`.
# That DROP on the parent table fires ON DELETE CASCADE (and ON DELETE SET NULL)
# on any child rows, wiping / corrupting them silently. Rails' `alter_table`
# wraps the work in `disable_referential_integrity`, which sets
# `PRAGMA foreign_keys = OFF`, but SQLite silently ignores that PRAGMA when
# a transaction is already open — and `Migrator#ddl_transaction` wraps every
# migration in a transaction. Net effect: `disable_referential_integrity` is a
# no-op inside migrations, and destructive alter_table calls on an FK-parent
# table silently cascade-delete / null-out child rows.
#
# rails/rails PR #55907 was the first attempt at this (reordered
# `disable_referential_integrity` / `transaction` inside `alter_table`). It
# does NOT fix the issue because real migrations always have an outer
# `ddl_transaction`; #55907's own tests only exercise the adapter with no
# outer transaction, so they pass while production still loses data.
#
# rails/rails PR #57128 is the correct fix. Backported here as a monkey-patch
# against Rails 8.1.2 (`query_all` — introduced in Rails 8.2 edge — is replaced
# with `query`; otherwise the logic is identical to the upstream PR).
#
# When `alter_table` detects it is running inside a single joinable outer
# transaction AND the target table is referenced by a destructive FK
# (`ON DELETE CASCADE` or `ON DELETE SET NULL`), it commits the outer
# transaction, runs the table rebuild with referential integrity correctly
# disabled, then reopens a fresh transaction in `ensure` so the caller's
# migration flow continues. Migrations whose alter_table calls target leaf
# tables (no destructive FK children) take the original fast path and stay
# fully atomic.
#
# STABILITY: `alter_table` has been in the SQLite3 adapter since Rails 4.2
# with the same signature. Prepending handles the private-method visibility
# (the method is currently private on the adapter). We guard against API
# drift by only prepending if the method exists.
# ─────────────────────────────────────────────────────────────────────────────
module SqliteAlterTableCascadeSafety
  # FK on_delete actions that mutate child rows when the parent table is
  # dropped during SQLite's table-rebuild. RESTRICT / NO ACTION raise an
  # error instead of corrupting data, so they're not listed here.
  DESTRUCTIVE_FK_ACTIONS = ["CASCADE", "SET NULL"].freeze

  def alter_table(table_name, foreign_keys = foreign_keys(table_name), check_constraints = check_constraints(table_name), **options, &block)
    altered_table_name = "a#{table_name}"

    caller = lambda do |definition|
      rename = options[:rename] || {}
      foreign_keys.each do |fk|
        if column = rename[fk.options[:column]]
          fk.options[:column] = column
        end
        to_table = strip_table_name_prefix_and_suffix(fk.to_table)
        definition.foreign_key(to_table, **fk.options)
      end
      check_constraints.each do |chk|
        definition.check_constraint(chk.expression, **chk.options)
      end
      block.call(definition) if block
    end

    restart =
      open_transactions == 1 &&
      current_transaction.joinable? &&
      referenced_by_destructive_foreign_key?(table_name)

    if restart
      materialize_transactions
      commit_db_transaction
    end

    begin
      disable_referential_integrity do
        transaction(requires_new: restart) do
          move_table(table_name, altered_table_name, options.merge(temporary: true))
          move_table(altered_table_name, table_name, &caller)
        end
      end
    ensure
      begin_db_transaction if restart
    end
  end

  private

  def referenced_by_destructive_foreign_key?(table_name)
    table_name = table_name.to_s
    # sqlite_master holds every user table. For each OTHER table, inspect its
    # outgoing FKs via `PRAGMA foreign_key_list(<name>)` — columns:
    #   [id, seq, table, from, to, on_update, on_delete, match]
    # and flag any FK whose target table is `table_name` with a destructive
    # on_delete action.
    table_rows = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name != #{quote(table_name)}")
    table_rows.any? do |row|
      other = row.is_a?(Array) ? row.first : row["name"]
      next false if other.nil? || other == table_name
      fk_rows = query("PRAGMA foreign_key_list(#{quote(other)})")
      fk_rows.any? do |fk|
        to_table  = fk.is_a?(Array) ? fk[2] : fk["table"]
        on_delete = fk.is_a?(Array) ? fk[6] : fk["on_delete"]
        to_table == table_name && DESTRUCTIVE_FK_ACTIONS.include?(on_delete)
      end
    end
  end
end

Rails.application.config.after_initialize do
  ActiveSupport.on_load(:active_record) do
    adapter = ActiveRecord::ConnectionAdapters::SQLite3Adapter
    if adapter.private_method_defined?(:alter_table) || adapter.method_defined?(:alter_table)
      adapter.prepend(SqliteAlterTableCascadeSafety)
    else
      warn "[sqlite_config] SQLite3Adapter#alter_table not found — FK cascade safety patch not installed (Rails internals changed?)"
    end
  end
end
