require "rails_helper"

RSpec.describe InboundEmail::ForwardParser do
  def build_mail(subject:, body:, from: "user@example.com", to: "uploads+x@in.revdoku.com")
    Mail.new do
      to to
      from from
      subject subject
      message_id "<#{SecureRandom.hex(4)}@t>"
      text_part { body body }
    end
  end

  it "parses a Gmail-style forward block" do
    body = <<~BODY
      FYI.

      ---------- Forwarded message ---------
      From: Amazon Web Services <invoicing@aws.com>
      Date: Thu, Apr 2, 2026 at 1:11 AM
      Subject: Amazon Web Services Invoice Available [Account: 779412915967] [Invoice ID: EUINAM26-16342]
      To: <billing@company.com>

      Body text.
    BODY
    m = build_mail(subject: "Fwd: Amazon Web Services Invoice Available", body: body)

    r = described_class.parse(m)
    expect(r.forwarded).to be(true)
    expect(r.parser_method).to eq(:gmail_forward_header)
    expect(r.original_from).to eq("invoicing@aws.com")
    expect(r.original_from_name).to eq("Amazon Web Services")
    expect(r.original_subject).to eq("Amazon Web Services Invoice Available [Account: 779412915967] [Invoice ID: EUINAM26-16342]")
    expect(r.original_date_raw).to eq("Thu, Apr 2, 2026 at 1:11 AM")
    expect(r.original_date).to start_with("2026-04-02")
  end

  it "parses an Apple Mail forward block" do
    body = <<~BODY
      Begin forwarded message:

      From: Bob Builder <bob@contoso.com>
      Subject: Monthly statement — March 2026
      Date: April 1, 2026 at 9:05:22 AM PDT
      To: me@example.com
    BODY
    r = described_class.parse(build_mail(subject: "Fwd: stmt", body: body))
    expect(r.forwarded).to be(true)
    expect(r.parser_method).to eq(:apple_forward_header)
    expect(r.original_from).to eq("bob@contoso.com")
    expect(r.original_subject).to eq("Monthly statement — March 2026")
  end

  it "parses an Outlook -----Original Message----- block" do
    body = <<~BODY
      See attached.

      -----Original Message-----
      From: Carol Danvers <carol@marvel.com>
      Sent: Wednesday, April 1, 2026 2:30 PM
      To: Me <me@example.com>
      Subject: Contract for review — Q2 2026
    BODY
    r = described_class.parse(build_mail(subject: "FW: Contract for review", body: body))
    expect(r.forwarded).to be(true)
    expect(r.parser_method).to eq(:outlook_forward_header)
    expect(r.original_from).to eq("carol@marvel.com")
    expect(r.original_subject).to eq("Contract for review — Q2 2026")
  end

  it "returns forwarded: false when no pattern matches" do
    r = described_class.parse(build_mail(subject: "Hello", body: "Just a direct email."))
    expect(r.forwarded).to be(false)
    expect(r.parser_method).to eq(:none)
    expect(r.original_from).to be_nil
  end

  it "returns forwarded: false for a 'Fwd:' subject with no structured body block" do
    r = described_class.parse(build_mail(subject: "Fwd: Invoice", body: "no structure here"))
    expect(r.forwarded).to be(false)
  end
end
