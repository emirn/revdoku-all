require "rails_helper"

RSpec.describe PromptSanitizer do
  describe ".sanitize_user_input" do
    it "strips {{template}} variables" do
      expect(described_class.sanitize_user_input("hello {{NAME}} world")).to eq("hello  world")
    end

    it "strips <user_*> and <system> xml tags" do
      input = "before <user_input>text</user_input> after <system>x</system>"
      expect(described_class.sanitize_user_input(input)).to eq("before text after x")
    end

    it "leaves unrelated HTML-ish content alone" do
      expect(described_class.sanitize_user_input("x < y and z > 0")).to eq("x < y and z > 0")
    end

    it "returns nil and empty strings unchanged" do
      expect(described_class.sanitize_user_input(nil)).to be_nil
      expect(described_class.sanitize_user_input("")).to eq("")
    end
  end

  describe ".sanitize_external_content" do
    it "strips control characters except newline and tab" do
      input = "ok\n\tnext\x00\x01line"
      expect(described_class.sanitize_external_content(input, "text/plain")).to eq("ok\n\tnextline")
    end

    it "collapses runs of 4 or more newlines" do
      expect(described_class.sanitize_external_content("a\n\n\n\n\nb", "text/plain")).to eq("a\n\n\nb")
    end

    it "runs the user-input sanitizer over the content" do
      expect(described_class.sanitize_external_content("data {{X}} <user_a/> end", "text/csv"))
        .to eq("data  end")
    end

    it "hard-caps the output at MAX_FILE_BYTES" do
      big = "x" * (PromptSanitizer::MAX_FILE_BYTES + 1024)
      out = described_class.sanitize_external_content(big, "text/plain")
      expect(out.bytesize).to be <= PromptSanitizer::MAX_FILE_BYTES
    end

    it "handles nil" do
      expect(described_class.sanitize_external_content(nil, "text/plain")).to eq("")
    end
  end
end
