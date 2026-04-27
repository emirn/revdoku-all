# frozen_string_literal: true

# Development-only safety net: snapshot the primary SQLite database before any
# `rails db:migrate` run. Rails has a long-standing bug where SQLite
# `remove_column` rebuilds the parent table and FK cascade fires on the child
# tables, silently wiping data (see rails/rails PR #55907). Litestream covers
# production; this covers local dev.
#
# Snapshots go to storage/backups/<timestamp>/ and we keep the last 10.

return unless Rails.env.development?

module DevDbBackup
  BACKUP_ROOT = Rails.root.join("storage", "backups")
  KEEP_LAST = 10
  # Only these databases are snapshotted — queue/cache/cable/audit are recreated
  # cheaply or contain only transient state.
  DB_BASENAMES = %w[development.sqlite3].freeze

  def self.snapshot!(label:)
    storage_dir = Rails.root.join("storage")
    sources = DB_BASENAMES.map { |name| storage_dir.join(name) }.select(&:exist?)
    return if sources.empty?

    timestamp = Time.now.strftime("%Y%m%d_%H%M%S")
    dest_dir = BACKUP_ROOT.join("#{timestamp}_#{label}")
    FileUtils.mkdir_p(dest_dir)

    sources.each do |src|
      checkpoint_wal(src)
      # Copy all three files so the snapshot is consistent even if the checkpoint
      # didn't fully drain the WAL (e.g. another process held the write lock).
      %w[ -wal -shm].unshift("").each do |suffix|
        file = Pathname.new("#{src}#{suffix}")
        FileUtils.cp(file, dest_dir.join(file.basename)) if file.exist?
      end
    end

    prune!
    Rails.logger.info "[dev_db_backup] snapshot saved to #{dest_dir.relative_path_from(Rails.root)}"
    puts "[dev_db_backup] snapshot saved to #{dest_dir.relative_path_from(Rails.root)}"
  rescue => e
    warn "[dev_db_backup] snapshot failed: #{e.class}: #{e.message}"
  end

  def self.checkpoint_wal(sqlite_path)
    db = SQLite3::Database.new(sqlite_path.to_s)
    db.execute("PRAGMA wal_checkpoint(TRUNCATE);")
    db.close
  rescue => e
    warn "[dev_db_backup] wal_checkpoint on #{sqlite_path.basename} failed: #{e.message}"
  end

  def self.prune!
    return unless BACKUP_ROOT.exist?
    dirs = BACKUP_ROOT.children.select(&:directory?).sort
    excess = dirs.size - KEEP_LAST
    return if excess <= 0
    dirs.first(excess).each { |d| FileUtils.rm_rf(d) }
  end
end

# Hook into ActiveRecord::Migrator.migrate. Runs before any actual migration
# work, inside the `rails db:migrate` invocation but BEFORE schema changes fire.
# We take the snapshot only when there is at least one pending migration so
# a no-op `db:migrate` doesn't churn the backups folder.
Rails.application.config.after_initialize do
  ActiveSupport.on_load(:active_record) do
    ActiveRecord::Migrator.prepend(Module.new do
      def migrate
        if respond_to?(:runnable, true) && runnable.any?
          label = runnable.first&.name&.underscore&.gsub(/\W+/, "_") || "pre_migrate"
          DevDbBackup.snapshot!(label: label[0, 50])
        end
        super
      end
    end)
  end
end
