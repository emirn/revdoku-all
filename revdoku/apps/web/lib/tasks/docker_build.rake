# frozen_string_literal: true

# Skip Vite build during Docker builds when assets are pre-built
# This is triggered when SECRET_KEY_BASE_DUMMY is set during image build
if ENV["SECRET_KEY_BASE_DUMMY"].present? && ENV["SKIP_VITE_BUILD"].present?
  Rake::Task["vite:build_all"].clear if Rake::Task.task_defined?("vite:build_all")
  Rake::Task["vite:build"].clear if Rake::Task.task_defined?("vite:build")

  namespace :vite do
    desc "Skip Vite build (assets pre-built in Docker multi-stage build)"
    task :build_all do
      puts "Skipping vite:build_all - assets were pre-built in frontend-builder stage"
    end

    desc "Skip Vite build (assets pre-built in Docker multi-stage build)"
    task :build do
      puts "Skipping vite:build - assets were pre-built in frontend-builder stage"
    end
  end
end
