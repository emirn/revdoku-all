require "rails_helper"

RSpec.describe Tag, type: :model do
  let(:account) { create(:account) }

  describe "associations" do
    it "can have a parent tag" do
      parent = create(:tag, account: account, name: "Parent")
      child = create(:tag, account: account, name: "Child", parent_tag: parent)

      expect(child.parent_tag).to eq(parent)
      expect(parent.child_tags).to include(child)
    end
  end

  describe "validations" do
    it "rejects a parent from a different account" do
      other_account = create(:account)
      parent = create(:tag, account: other_account, name: "Other")
      child = build(:tag, account: account, name: "Child", parent_tag: parent)

      expect(child).not_to be_valid
      expect(child.errors[:parent_tag]).to include("must belong to the same account")
    end

    it "prevents direct cycle (A.parent = A)" do
      tag = create(:tag, account: account, name: "A")
      tag.parent_tag = tag

      expect(tag).not_to be_valid
      expect(tag.errors[:parent_tag]).to include("would create a cycle")
    end

    it "prevents indirect cycle (A → B → A)" do
      a = create(:tag, account: account, name: "A")
      b = create(:tag, account: account, name: "B", parent_tag: a)

      a.parent_tag = b
      expect(a).not_to be_valid
      expect(a.errors[:parent_tag]).to include("would create a cycle")
    end

    it "prevents deep cycle (A → B → C → A)" do
      a = create(:tag, account: account, name: "A")
      b = create(:tag, account: account, name: "B", parent_tag: a)
      c = create(:tag, account: account, name: "C", parent_tag: b)

      a.parent_tag = c
      expect(a).not_to be_valid
      expect(a.errors[:parent_tag]).to include("would create a cycle")
    end
  end

  describe "dependent: :destroy" do
    it "cascades delete to nested children" do
      parent = create(:tag, account: account, name: "Parent")
      child = create(:tag, account: account, name: "Child", parent_tag: parent)
      grandchild = create(:tag, account: account, name: "Grandchild", parent_tag: child)

      expect { parent.destroy! }.to change(Tag, :count).by(-3)
      expect(Tag.exists?(child.id)).to be false
      expect(Tag.exists?(grandchild.id)).to be false
    end
  end

  describe "#full_path" do
    it "returns just the name for a root tag" do
      tag = create(:tag, account: account, name: "Root")
      expect(tag.full_path).to eq("Root")
    end

    it "returns slash-separated path for nested tags" do
      grandparent = create(:tag, account: account, name: "Grandparent")
      parent = create(:tag, account: account, name: "Parent", parent_tag: grandparent)
      child = create(:tag, account: account, name: "Child", parent_tag: parent)

      expect(child.full_path).to eq("Grandparent/Parent/Child")
    end
  end

  describe "#self_and_descendants" do
    it "returns the correct recursive set" do
      root = create(:tag, account: account, name: "Root")
      child_a = create(:tag, account: account, name: "A", parent_tag: root)
      child_b = create(:tag, account: account, name: "B", parent_tag: root)
      grandchild = create(:tag, account: account, name: "A1", parent_tag: child_a)

      result = root.self_and_descendants
      expect(result).to contain_exactly(root, child_a, child_b, grandchild)
    end
  end

  describe "#ancestors" do
    it "returns ancestors bottom-up" do
      grandparent = create(:tag, account: account, name: "Grandparent")
      parent = create(:tag, account: account, name: "Parent", parent_tag: grandparent)
      child = create(:tag, account: account, name: "Child", parent_tag: parent)

      expect(child.ancestors).to eq([parent, grandparent])
    end

    it "returns empty array for root tags" do
      root = create(:tag, account: account, name: "Root")
      expect(root.ancestors).to eq([])
    end
  end
end
