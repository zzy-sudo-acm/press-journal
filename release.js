const positionKey = `press-journal:${location.pathname}:update-position`

async function refreshLoadedAssets() {
  const assets = new Set(performance.getEntriesByType("resource").map(entry => entry.name))
  const localCode = [...assets].filter(name => {
    const url = new URL(name)
    return url.origin === location.origin && /\.(css|js)$/.test(url.pathname)
  })
  await Promise.all(localCode.map(async url => {
    const response = await fetch(url, { cache: "reload" })
    await response.arrayBuffer()
  }))
}

export function restoreReadingAfterUpdate() {
  if (!document.body.classList.contains("reading-mode")) return
  try {
    const saved = JSON.parse(sessionStorage.getItem(positionKey))
    sessionStorage.removeItem(positionKey)
    if (saved?.hash === location.hash && Number.isFinite(saved.y)) window.scrollTo(0, saved.y)
  } catch {
    // The article can still be opened normally.
  }
}

export function watchForSiteUpdates() {
  const current = Date.parse(document.lastModified)
  if (!Number.isFinite(current)) return
  const notice = document.querySelector("#update-notice")
  const refresh = notice.querySelector("[data-apply-update]")
  let available = 0
  let dismissed = 0
  let checking = false

  async function check() {
    if (checking || document.visibilityState !== "visible") return
    checking = true
    try {
      const url = new URL("./", location.href)
      url.searchParams.set("check", String(Date.now()))
      const response = await fetch(url, { method: "HEAD", cache: "no-store" })
      if (!response.ok) return
      const published = Date.parse(response.headers.get("Last-Modified"))
      if (!Number.isFinite(published)) return
      available = published > current ? published : 0
      notice.hidden = !available || available === dismissed
    } catch {
      // The next check can run when the connection returns.
    } finally {
      checking = false
    }
  }

  refresh.addEventListener("click", async () => {
    if (!available) return
    const version = available
    refresh.disabled = true
    refresh.textContent = "更新中…"
    try {
      await refreshLoadedAssets()
    } catch {
      refresh.disabled = false
      refresh.textContent = "重试更新"
      return
    }
    if (document.body.classList.contains("reading-mode")) {
      try {
        sessionStorage.setItem(positionKey, JSON.stringify({ hash: location.hash, y: window.scrollY }))
      } catch {
        // The site can still be updated.
      }
    }
    const url = new URL(location.href)
    url.searchParams.set("v", String(version))
    location.replace(url.href)
  })
  notice.querySelector("[data-dismiss-update]").addEventListener("click", () => {
    dismissed = available
    notice.hidden = true
  })
  document.addEventListener("visibilitychange", check)
  window.addEventListener("pageshow", check)
  window.addEventListener("focus", check)
  setInterval(check, 60_000)
  check()
}
