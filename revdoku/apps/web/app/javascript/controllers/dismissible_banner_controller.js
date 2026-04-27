import { Controller } from "@hotwired/stimulus"

// Strips one-shot query params (e.g. ?purchased=1) from the URL bar on
// connect, so reloading the page does not redisplay the banner. The banner
// itself stays visible for the current render — we only clean up history.
export default class extends Controller {
  connect() {
    if (typeof window === "undefined" || !window.history?.replaceState) return
    const url = new URL(window.location.href)
    if (!url.searchParams.has("purchased")) return
    url.searchParams.delete("purchased")
    const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash
    window.history.replaceState({}, "", clean)
  }
}
