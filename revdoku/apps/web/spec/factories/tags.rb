FactoryBot.define do
  factory :tag do
    account
    sequence(:name) { |n| "Tag #{n}" }
    color { "blue" }
    sequence(:position) { |n| n }
  end
end
