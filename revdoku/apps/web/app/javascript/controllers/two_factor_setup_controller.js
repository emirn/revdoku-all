import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["step", "indicator"]
  static values = { current: { type: Number, default: 1 } }

  connect() {
    this.showStep(this.currentValue)
  }

  next() {
    if (this.currentValue < this.stepTargets.length) {
      this.currentValue++
      this.showStep(this.currentValue)
    }
  }

  previous() {
    if (this.currentValue > 1) {
      this.currentValue--
      this.showStep(this.currentValue)
    }
  }

  showStep(n) {
    this.stepTargets.forEach((el, i) => {
      el.classList.toggle("hidden", i + 1 !== n)
    })

    this.indicatorTargets.forEach((el, i) => {
      const stepNum = i + 1
      const isActive = stepNum === n
      const isCompleted = stepNum < n

      el.classList.toggle("bg-red-600", isActive || isCompleted)
      el.classList.toggle("text-white", isActive || isCompleted)
      el.classList.toggle("bg-gray-200", !isActive && !isCompleted)
      el.classList.toggle("text-gray-600", !isActive && !isCompleted)
    })
  }
}
