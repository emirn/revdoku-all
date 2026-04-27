require "rails_helper"

RSpec.describe RuleFileResolver do
  describe ".scan_markers" do
    it "returns an empty array for nil / empty / plain prompts" do
      expect(described_class.scan_markers(nil)).to eq([])
      expect(described_class.scan_markers("")).to eq([])
      expect(described_class.scan_markers("plain rule, no marker")).to eq([])
    end

    it "captures a deferred #ref[description] marker" do
      markers = described_class.scan_markers("rule #ref[Upload the original Quote] done")
      expect(markers.length).to eq(1)
      expect(markers.first).to include(
        kind: :deferred,
        prefix_id: nil,
        description: "Upload the original Quote"
      )
    end

    it "captures a deferred #ref[] marker with empty description" do
      markers = described_class.scan_markers("rule #ref[] end")
      expect(markers.length).to eq(1)
      expect(markers.first).to include(kind: :deferred, prefix_id: nil, description: nil)
    end

    it "captures a latest-df pin" do
      markers = described_class.scan_markers("see #ref[file:df_abc123] for context")
      expect(markers.first).to include(kind: :latest_df, prefix_id: "df_abc123", description: nil)
    end

    it "captures a latest-df pin with a label" do
      markers = described_class.scan_markers("see #ref[file:df_abc123|Invoice] here")
      expect(markers.first).to include(kind: :latest_df, prefix_id: "df_abc123", description: "Invoice")
    end

    it "captures a pinned-dfrev marker with a label" do
      markers = described_class.scan_markers("pinned #ref[file:dfrev_xyz|v3 snapshot]")
      expect(markers.first).to include(kind: :pinned_dfrev, prefix_id: "dfrev_xyz", description: "v3 snapshot")
    end

    it "captures multiple markers in prompt order" do
      markers = described_class.scan_markers("a #ref[X] then #ref[file:df_abc] end")
      expect(markers.map { |m| m[:kind] }).to eq([:deferred, :latest_df])
    end

    it "does not match #ref when preceded by a word character" do
      expect(described_class.scan_markers("profile#ref[x]")).to eq([])
    end

    it "treats unknown schemes as deferred (round-trip body as description)" do
      markers = described_class.scan_markers("#ref[url:https://example.com]")
      expect(markers.first).to include(kind: :deferred, prefix_id: nil, description: "url:https://example.com")
    end
  end

  describe ".has_marker?" do
    it "returns true for every supported form" do
      expect(described_class.has_marker?("#ref[]")).to eq(true)
      expect(described_class.has_marker?("#ref[foo]")).to eq(true)
      expect(described_class.has_marker?("#ref[file:df_abc]")).to eq(true)
      expect(described_class.has_marker?("#ref[file:dfrev_xyz|pinned]")).to eq(true)
    end

    it "returns false for anything else" do
      expect(described_class.has_marker?("plain")).to eq(false)
      expect(described_class.has_marker?(nil)).to eq(false)
      expect(described_class.has_marker?("#file[x]")).to eq(false)
      expect(described_class.has_marker?("file:dfrev_x")).to eq(false)
    end
  end

  describe ".rewrite_with_refs" do
    it "rewrites deferred markers to the canonical #ref[file:<dfrev>|label] form" do
      rev = instance_double(
        DocumentFileRevision,
        ready?: true,
        mime_type: "text/csv",
        id: 1,
        prefix_id: "dfrev_abc"
      )
      result = described_class.rewrite_with_refs([
        { scope_key: "rule_1", prompt: "a #ref[Quote] b", revisions: [rev] }
      ])
      expect(result.success?).to eq(true)
      expect(result.entries.first.rewritten_prompt).to eq("a #ref[file:dfrev_abc|Quote] b")
      expect(result.references.length).to eq(1)
      expect(result.references.first.document_file_revision_prefix_id).to eq("dfrev_abc")
      expect(result.references.first.rule_id).to eq("rule_1")
    end

    it "omits the label when the source marker had no description" do
      rev = instance_double(
        DocumentFileRevision,
        ready?: true,
        mime_type: "text/plain",
        id: 2,
        prefix_id: "dfrev_xyz"
      )
      result = described_class.rewrite_with_refs([
        { scope_key: "rule_2", prompt: "see #ref[]", revisions: [rev] }
      ])
      expect(result.success?).to eq(true)
      expect(result.entries.first.rewritten_prompt).to eq("see #ref[file:dfrev_xyz]")
    end

    it "fails loudly when revision count does not match marker count" do
      rev = instance_double(DocumentFileRevision, ready?: true, mime_type: "text/csv", id: 3, prefix_id: "dfrev_a")
      result = described_class.rewrite_with_refs([
        { scope_key: "rule_3", prompt: "#ref[a] #ref[b]", revisions: [rev] }
      ])
      expect(result.success?).to eq(false)
      expect(result.error).to include("expected 2 reference file(s), got 1")
    end

    it "fails when a revision is not ready" do
      rev = instance_double(DocumentFileRevision, ready?: false, mime_type: "text/csv", id: 4, prefix_id: "dfrev_b")
      result = described_class.rewrite_with_refs([
        { scope_key: "rule_4", prompt: "rule #ref[desc]", revisions: [rev] }
      ])
      expect(result.success?).to eq(false)
      expect(result.error).to include("not ready")
    end

    it "marks has_images when a supplied revision is an image mime" do
      rev = instance_double(
        DocumentFileRevision,
        ready?: true,
        mime_type: "image/png",
        id: 5,
        prefix_id: "dfrev_img"
      )
      result = described_class.rewrite_with_refs([
        { scope_key: "rule_5", prompt: "logo #ref[]", revisions: [rev] }
      ])
      expect(result.success?).to eq(true)
      expect(result.entries.first.has_images).to eq(true)
    end
  end
end
