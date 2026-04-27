FactoryBot.define do
  factory :account do
    owner { nil }
    name { "MyString" }
    personal { false }
  end
end
