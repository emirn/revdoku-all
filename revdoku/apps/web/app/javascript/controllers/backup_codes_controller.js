import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["continueButton", "savedNotice"]
  static values = { codes: String }

  download() {
    const blob = new Blob([this.codesValue], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "revdoku-backup-codes.txt"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    this.markSaved()
  }

  copy() {
    navigator.clipboard.writeText(this.codesValue).then(() => {
      this.markSaved()
    })
  }

  print() {
    window.print()
    this.markSaved()
  }

  markSaved() {
    this.continueButtonTarget.classList.remove("opacity-50", "cursor-not-allowed", "pointer-events-none")
    this.continueButtonTarget.classList.add("hover:bg-red-700", "cursor-pointer")
    this.savedNoticeTarget.classList.remove("hidden")
  }
}
