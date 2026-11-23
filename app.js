import {
  deleteArticle, exportJournal, importJournal, loadJournal, localDay, mondayOf,
  readingStats, readingStreaks, safeSourceUrl, saveArticle, shiftDay, updateArticle
} from "./journal.js?v=4"
import { articleBackup, createTransferLink, readTransferLink } from "./transfer.js?v=4"
import { restoreReadingAfterUpdate, watchForSiteUpdates } from "./release.js?v=4"
import { cleanPublisherText, fetchPublicArticle, identifyArticleLink, publishers } from "./link-import.js?v=9"

const sample = {
  id: "sample",
  title: "The Quiet Work of a Public Bench",
  source: "原创试读",
  text: `On a Tuesday morning, I watched a man fold a newspaper into quarters and slide it under his elbow. He was sitting on a bench facing a street that had nothing especially worth looking at. A delivery van was reversing. Someone was trying to persuade a dog to cross the road. The man had apparently found plenty to keep him there.

Urban design is usually easiest to notice when it asks us to move. A crossing turns green, a sign points towards a station, a pavement widens to accommodate a queue. A bench interrupts that logic. It gives a person a legitimate reason to occupy a place without buying anything or announcing where they are going.

The most useful benches are rarely arranged around a view. They are set outside a pharmacy, halfway up a hill, near a stop where the buses run late. Their importance becomes apparent to the person carrying two heavy bags, or to someone who used to walk a little farther before needing to rest. What looks like spare furniture from a passing car may be the thing that makes a short errand possible.

Placement makes a difference. A seat facing a wall offers privacy but very little to look at. A seat facing the street can be more companionable, even when nobody speaks. At a small square near my flat, two benches sit at right angles. People often choose the one from which they can see the bakery door. There is no spectacle there, only an irregular succession of familiar faces, paper bags and small decisions about what to carry home.

Cities spend a great deal of energy finding out where people want to go. It is harder to measure where they would like to stay, especially when staying is a small, unplanned decision. A good bench makes that decision easy. By the time I passed the same spot again, the man and his newspaper had gone. Someone else had taken his place.`
}

const pages = { desk: "阅读书桌", library: "文章收藏", calendar: "打卡日历", reader: "阅读文章", import: "导入文章" }
const main = document.querySelector("#main")
const editor = document.querySelector("#editor-dialog")
const editorForm = document.querySelector("#editor-form")
const editorError = document.querySelector("#editor-error")
const saveButton = document.querySelector("#save-button")
const linkImportDialog = document.querySelector("#link-import-dialog")
const linkImportForm = document.querySelector("#link-import-form")
const linkImportUrl = document.querySelector("#link-import-url")
const linkImportButton = document.querySelector("#link-import-button")
const linkImportError = document.querySelector("#link-import-error")
const linkImportOrigin = document.querySelector("#link-import-origin")
const deleteDialog = document.querySelector("#delete-dialog")
const deleteForm = document.querySelector("#delete-form")
const deleteError = document.querySelector("#delete-error")
const deleteButton = document.querySelector("#delete-button")
const sidebarToggle = document.querySelector("#sidebar-toggle")
const stampDialog = document.querySelector("#stamp-dialog")
const backupDialog = document.querySelector("#backup-dialog")
const backupFile = document.querySelector("#backup-file")
const backupError = document.querySelector("#backup-error")
const transferDialog = document.querySelector("#transfer-dialog")
const transferLink = document.querySelector("#transfer-link")
const transferStatus = document.querySelector("#transfer-status")
const copyTransfer = document.querySelector("#copy-transfer")
const toast = document.querySelector("#toast")
const mobileReader = matchMedia("(max-width: 700px)")
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "long", day: "numeric", weekday: "short", timeZone: "UTC"
})
const archiveDateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
})
const keyPrefix = `press-journal:${location.pathname.replace(/\/index\.html$/, "/")}`
const updates = new BroadcastChannel(keyPrefix)
const settingsKey = `${keyPrefix}:reader-settings`
const sidebarKey = `${keyPrefix}:sidebar-collapsed`

let journal = { articles: [], checkins: [] }
let today = localDay()
let calendarYear = Number(today.slice(0, 4))
let editingId = null
let deletingId = null
let toastTimeout
let ready = false
let pendingTransfer
let linkRequest
let linkDraft
let lastReadingScroll = 0
let readingScrollTravel = 0
let preferences = { "font-size": "medium", "paper-theme": "white" }

try {
  const stored = JSON.parse(localStorage.getItem(settingsKey))
  if (stored) preferences = { ...preferences, ...stored }
} catch {
  // Reading preferences still work for the current visit.
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed)
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed))
  const label = collapsed ? "展开左侧工具栏" : "收起左侧工具栏"
  sidebarToggle.setAttribute("aria-label", label)
  sidebarToggle.title = label
  sidebarToggle.querySelector("use").setAttribute("href", collapsed ? "#i-sidebar-expand" : "#i-sidebar")
}

try {
  setSidebarCollapsed(localStorage.getItem(sidebarKey) === "true")
} catch {
  // The toolbar starts expanded if storage is unavailable.
}

sidebarToggle.addEventListener("click", () => {
  const collapsed = sidebarToggle.getAttribute("aria-expanded") === "true"
  setSidebarCollapsed(collapsed)
  try {
    localStorage.setItem(sidebarKey, String(collapsed))
  } catch {
    // The toolbar can still be toggled for the current visit.
  }
})

function view(name) {
  return document.querySelector(`#${name}`).content.cloneNode(true)
}

document.querySelector("#link-import-sources").append(...publishers.map(publisher => {
  const item = document.createElement("li")
  item.textContent = publisher.name
  return item
}))

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
  svg.setAttribute("class", "icon")
  svg.setAttribute("aria-hidden", "true")
  use.setAttribute("href", `#i-${name}`)
  svg.append(use)
  return svg
}

function route() {
  const hash = location.hash.slice(1)
  if (hash.startsWith("read/")) return { page: "reader", id: hash.slice(5) }
  if (hash.startsWith("import/")) return { page: "import", code: hash.slice(7) }
  return { page: hash === "library" || hash === "calendar" ? hash : "desk" }
}

function findArticle(id) {
  return id === sample.id ? sample : journal.articles.find(article => article.id === id)
}

function dateText(day, formatter = dateFormat) {
  return formatter.formatToParts(new Date(`${day}T12:00:00Z`))
    .map(part => part.type === "weekday" ? ` ${part.value}` : part.value)
    .join("")
    .trim()
}

function readTime(article) {
  const count = cleanPublisherText(article.text, article.source).trim().split(/\s+/).length
  return `约 ${Math.max(1, Math.ceil(count / 220))} 分钟`
}

function message(container, heading, body, symbol = "book") {
  const row = document.createElement("div")
  row.className = "empty-state"
  const mark = document.createElement("span")
  mark.className = "article-mark"
  mark.append(icon(symbol))
  const copy = document.createElement("div")
  const title = document.createElement("h3")
  const description = document.createElement("p")
  title.textContent = heading
  description.textContent = body
  copy.append(title, description)
  row.append(mark, copy)
  container.append(row)
}

function articleRow(article) {
  const row = view("article-row")
  const link = row.querySelector("a")
  const title = row.querySelector("[data-row-title]")
  const remove = row.querySelector("[data-action=delete]")
  link.href = `#read/${article.id}`
  title.textContent = article.title
  if (article.id === sample.id) {
    title.lang = "en"
    link.parentElement.classList.add("sample-row")
    link.querySelector("use").setAttribute("href", "#i-book")
    remove.hidden = true
  } else {
    remove.dataset.articleId = article.id
    remove.setAttribute("aria-label", `删除文章：${article.title}`)
  }
  row.querySelector("[data-row-meta]").textContent = [article.source, readTime(article)].filter(Boolean).join("  ·  ")
  return row
}

function showArticles(container, articles, query = "") {
  container.replaceChildren()
  if (!articles.length) {
    const list = document.createElement("div")
    list.className = "paper article-list"
    if (query) {
      message(list, "没找到相关文章", "试试其他关键词。", "search")
    } else {
      message(list, "书架还是空的", "收藏一篇外刊，随时回来重读。")
      list.append(articleRow(sample))
    }
    container.append(list)
    return
  }

  const grouped = new Map()
  for (const article of articles) {
    if (!grouped.has(article.day)) grouped.set(article.day, [])
    grouped.get(article.day).push(article)
  }
  const streaks = readingStreaks(checkedDays())
  for (const [day, entries] of grouped) {
    const group = view("archive-day")
    group.querySelector(".archive-day").dataset.archiveDay = day
    const date = group.querySelector("time")
    date.dateTime = day
    date.textContent = dateText(day, archiveDateFormat)
    const run = streaks.get(day)
    if (run) {
      const label = group.querySelector("[data-day-streak]")
      label.textContent = `第 ${run} 天`
      label.hidden = false
    }
    group.querySelector(".article-list").append(...entries.map(articleRow))
    container.append(group)
  }
}

function checkedDays() {
  return new Set(journal.checkins.map(stamp => stamp.day))
}

function calendarCell(day, checked, selected) {
  const isFuture = day > today
  const cell = document.createElement(isFuture ? "span" : "button")
  cell.className = "calendar-day"
  if (isFuture) {
    cell.classList.add("future")
    cell.setAttribute("aria-hidden", "true")
    return cell
  }
  cell.type = "button"
  cell.dataset.day = day
  cell.tabIndex = selected ? 0 : -1
  cell.title = `${dateText(day)} · ${checked ? "已盖章" : "未盖章"}`
  cell.setAttribute("aria-label", cell.title)
  cell.setAttribute("aria-pressed", String(selected))
  if (day === today) cell.setAttribute("aria-current", "date")
  if (checked) {
    cell.classList.add("checked")
    cell.append(icon("check"))
  }
  return cell
}

function selectCalendarDay(container, cell, moveFocus = false) {
  const selected = container.querySelector('[aria-pressed="true"]')
  if (selected) {
    selected.setAttribute("aria-pressed", "false")
    selected.tabIndex = -1
  }
  cell.setAttribute("aria-pressed", "true")
  cell.tabIndex = 0
  container.querySelector(".calendar-caption").textContent = cell.title
  if (moveFocus) cell.focus()
}

function jumpToArchiveDay(calendar, day) {
  const archive = main.querySelector("[data-recent]")
  archive.querySelector(".is-targeted")?.classList.remove("is-targeted")
  const group = archive.querySelector(`[data-archive-day="${day}"]`)
  if (!group) {
    calendar.querySelector(".calendar-caption").textContent += " · 当天无收藏"
    return
  }
  group.classList.add("is-targeted")
  group.querySelector(".archive-date").focus({ preventScroll: true })
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  group.scrollIntoView({ behavior, block: "start" })
}

function buildCalendar(container, days, year) {
  const annual = year !== undefined
  const first = annual ? `${year}-01-01` : shiftDay(mondayOf(today), -77)
  const last = annual ? `${year}-12-31` : shiftDay(mondayOf(today), 6)
  const selected = today < last ? today : last
  const viewport = document.createElement("div")
  viewport.className = "calendar-viewport"
  const grid = document.createElement("div")
  grid.className = `calendar-grid${annual ? " annual-grid" : ""}`
  const start = mondayOf(first)
  const months = []
  let month = ""
  let col = 0
  for (let day = start, offset = 0; day <= last; day = shiftDay(day, 1), offset += 1) {
    col = Math.floor(offset / 7) + 2
    if (day < first) continue
    const currentMonth = day.slice(5, 7)
    if (currentMonth !== month) {
      if (months.length && col - months.at(-1).col < 2) months.pop()
      months.push({ col, label: `${Number(currentMonth)}月` })
      month = currentMonth
    }
    const cell = calendarCell(day, days.has(day), day === selected)
    cell.style.gridColumn = col
    cell.style.gridRow = offset % 7 + 2
    grid.append(cell)
  }
  grid.style.setProperty("--weeks", col - 1)
  for (const { col, label } of months) {
    const text = document.createElement("span")
    text.className = "month-label"
    text.textContent = label
    text.style.gridColumn = col
    text.style.gridRow = 1
    grid.append(text)
  }
  for (const [label, row] of [["一", 2], ["三", 4], ["五", 6], ["日", 8]]) {
    const text = document.createElement("span")
    text.className = "weekday-label"
    text.textContent = label
    text.style.gridRow = row
    text.setAttribute("aria-hidden", "true")
    grid.append(text)
  }
  viewport.append(grid)
  const footer = document.createElement("div")
  footer.className = "calendar-footer"
  const caption = document.createElement("span")
  caption.className = "calendar-caption"
  caption.setAttribute("aria-live", "polite")
  caption.textContent = annual
    ? `${[...days].filter(day => day.startsWith(String(year)) && day <= today).length} 天已盖章`
    : "最近 12 周"
  const legend = document.createElement("span")
  legend.className = "calendar-legend"
  legend.innerHTML = '<i></i>未盖章<i class="checked"></i>已盖章'
  footer.append(caption, legend)
  container.replaceChildren(viewport, footer)
  container.addEventListener("click", event => {
    const cell = event.target.closest("button[data-day]")
    if (!cell) return
    selectCalendarDay(container, cell)
    if (!annual) jumpToArchiveDay(container, cell.dataset.day)
  })
  container.addEventListener("keydown", event => {
    const cell = event.target.closest("button[data-day]")
    const offsets = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
    if (!cell || !(event.key in offsets)) return
    event.preventDefault()
    const next = container.querySelector(`[data-day="${shiftDay(cell.dataset.day, offsets[event.key])}"]`)
    if (next) selectCalendarDay(container, next, true)
  })
  if (annual && selected === today) {
    const todayCell = grid.querySelector('[aria-current="date"]')
    if (todayCell) viewport.scrollLeft = todayCell.offsetLeft - viewport.clientWidth + todayCell.offsetWidth + 12
  }
}

function showDesk() {
  main.append(view("desk-view"))
  showArticles(main.querySelector("[data-recent]"), journal.articles)
  const days = checkedDays()
  main.querySelector("[data-streak]").textContent = readingStats(days, today).current
  if (days.has(today)) {
    main.querySelector("[data-today-stamp]").classList.add("is-stamped")
    main.querySelector("[data-today-status]").textContent = "今日已盖章"
  }
  buildCalendar(main.querySelector("[data-calendar]"), days)
}

function showLibrary(search = "") {
  main.append(view("library-view"))
  main.querySelector("[data-library-count]").textContent = `已收藏 ${journal.articles.length} 篇文章`
  const input = main.querySelector("[data-search]")
  const container = main.querySelector("[data-library]")
  input.value = search
  const filter = () => {
    const query = input.value.trim().toLocaleLowerCase()
    const articles = query ? journal.articles.filter(article =>
      [article.title, article.source, article.text].some(value => value.toLocaleLowerCase().includes(query))
    ) : journal.articles
    showArticles(container, articles, query)
  }
  input.addEventListener("input", filter)
  filter()
}

function showCalendar() {
  main.append(view("calendar-view"))
  const days = checkedDays()
  const stats = readingStats(days, today)
  main.querySelector("[data-streak]").textContent = stats.current
  main.querySelector("[data-longest]").textContent = stats.longest
  main.querySelector("[data-total]").textContent = stats.total
  main.querySelector("[data-calendar-year]").textContent = `${calendarYear} 年`
  const thisYear = Number(today.slice(0, 4))
  const oldest = Math.min(thisYear - 1, ...[...days].map(day => Number(day.slice(0, 4))))
  main.querySelector('[data-action="prev-year"]').disabled = calendarYear <= oldest
  main.querySelector('[data-action="next-year"]').disabled = calendarYear >= thisYear
  buildCalendar(main.querySelector("[data-calendar]"), days, calendarYear)
}

function updateReadingProgress() {
  const progress = main.querySelector(".reading-progress")
  if (!progress) return
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight
  progress.value = maxScroll > 0 ? Math.min(100, Math.max(0, window.scrollY / maxScroll * 100)) : 100
}

function revealReadingBars() {
  document.body.classList.remove("reading-bars-hidden")
  readingScrollTravel = 0
  lastReadingScroll = Math.max(0, window.scrollY)
}

function handleReadingScroll() {
  updateReadingProgress()
  const position = Math.max(0, window.scrollY)
  const delta = position - lastReadingScroll
  lastReadingScroll = position
  if (!mobileReader.matches || !document.body.classList.contains("reading-mode")) return
  if (position < 24) {
    if (delta < 0) revealReadingBars()
    return
  }
  readingScrollTravel = delta > 0 ? readingScrollTravel + delta : 0
  const interacting = main.querySelector(".reading-preferences[open]") || window.getSelection()?.type === "Range"
  if (position >= 90 && readingScrollTravel >= 32 && !interacting) {
    document.body.classList.add("reading-bars-hidden")
  }
}

function applyReadingPreferences(reader) {
  reader.dataset.fontSize = preferences["font-size"]
  reader.dataset.theme = preferences["paper-theme"]
  updateReadingProgress()
}

function showReader(article) {
  if (!article) {
    message(main, "这篇文章还没收藏", "可以从文章收藏打开此浏览器里的文章。", "file")
    return
  }

  main.append(view("reader-view"))
  const reader = main.querySelector(".reader")
  const title = reader.querySelector("[data-article-title]")
  title.textContent = article.title
  const date = article.day ? dateText(article.day, archiveDateFormat) : ""
  const run = readingStreaks(checkedDays()).get(article.day)
  const metadata = [article.source, date, run ? `第 ${run} 天` : "", readTime(article)].filter(Boolean)
  reader.querySelector("[data-article-meta]").textContent = metadata.join("  ·  ")
  const url = safeSourceUrl(article.url)
  const source = reader.querySelector("[data-article-source]")
  if (url) {
    source.href = url
    source.hidden = false
  }
  const remove = reader.querySelector("[data-action=delete]")
  remove.dataset.articleId = article.id
  if (article.id === sample.id) {
    reader.querySelector('[data-action="edit"]').hidden = true
    reader.querySelector('[data-action="transfer"]').hidden = true
    remove.hidden = true
  }

  const content = reader.querySelector("[data-article-text]")
  const text = cleanPublisherText(article.text, article.source)
  const paragraphs = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  if (paragraphs.length > 1 && paragraphs[0] === article.title) paragraphs.shift()
  if (!/\p{Script=Han}/u.test(article.title)) title.lang = "en"
  if (!/\p{Script=Han}/u.test(text)) content.lang = "en"
  for (const paragraph of paragraphs) {
    const node = document.createElement("p")
    node.dir = "auto"
    node.textContent = paragraph
    content.append(node)
  }
  for (const input of reader.querySelectorAll(".reading-preferences input")) {
    input.checked = input.value === preferences[input.name]
    input.addEventListener("change", () => {
      preferences[input.name] = input.value
      try {
        localStorage.setItem(settingsKey, JSON.stringify(preferences))
      } catch {
        // Reading preferences still work for the current visit.
      }
      applyReadingPreferences(reader)
    })
  }
  applyReadingPreferences(reader)
}

function renderDate() {
  const label = document.querySelector("#today-label")
  label.dateTime = today
  label.textContent = dateText(today)
}

async function openTransferredArticle(id, replace = false) {
  const hash = `#read/${id}`
  if (replace) history.replaceState(null, "", hash)
  else history.pushState(null, "", hash)
  revealReadingBars()
  window.scrollTo(0, 0)
  await loadAndRender()
  main.focus({ preventScroll: true })
}

async function showArticleImport(code) {
  main.append(view("import-view"))
  const panel = main.querySelector(".incoming-article")
  const status = panel.querySelector("[data-import-status]")
  let backup
  try {
    backup = await readTransferLink(code)
  } catch {
    status.textContent = "无法打开这条导入链接。请重新发送链接，或用单篇文件导入。"
    return
  }
  if (!panel.isConnected) return
  const [article] = backup.articles
  const saved = Boolean(findArticle(article.id))
  const button = panel.querySelector("[data-import-confirm]")
  const date = dateText(article.day, archiveDateFormat)
  panel.querySelector("[data-import-title]").textContent = article.title
  panel.querySelector("[data-import-meta]").textContent = [article.source, date, readTime(article)].filter(Boolean).join("  ·  ")
  panel.querySelector("[data-import-preview]").hidden = false
  if (saved) button.textContent = "阅读已收藏的文章"
  status.textContent = saved ? "这篇文章已在你的收藏里。" : "标题、正文、收藏日期和原文链接会一起存入。"
  button.hidden = false
  button.addEventListener("click", async () => {
    button.disabled = true
    if (!saved) {
      try {
        await importJournal(backup)
      } catch {
        status.textContent = "暂时无法存入文章，请重试。"
        button.disabled = false
        return
      }
      updates.postMessage("journal-changed")
    }
    if (!panel.isConnected) return
    await openTransferredArticle(article.id, true)
    if (!saved) showToast("文章已导入")
  })
}

function render() {
  if (!ready) return
  const { page, id, code } = route()
  const article = page === "reader" ? findArticle(id) : undefined
  document.body.classList.toggle("reading-mode", Boolean(article))
  if (!article) revealReadingBars()
  document.title = `${article?.title ?? pages[page]} · 外刊日课`
  document.querySelector("#page-label").textContent = pages[page]
  renderDate()
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === (page === "reader" ? "library" : page)) link.setAttribute("aria-current", "page")
    else link.removeAttribute("aria-current")
  }
  const search = main.querySelector("[data-search]")?.value
  main.replaceChildren()
  if (page === "desk") showDesk()
  if (page === "library") showLibrary(search)
  if (page === "calendar") showCalendar()
  if (page === "reader") showReader(article)
  if (page === "import") showArticleImport(code)
  main.querySelector("[data-article-actions]")?.append(view("article-actions"))
}

function refreshDate(renderView = true) {
  const day = localDay()
  if (today === day) return
  if (calendarYear === Number(today.slice(0, 4))) calendarYear = Number(day.slice(0, 4))
  today = day
  if (!renderView) return
  if (route().page === "reader") renderDate()
  else render()
}

async function refreshJournal() {
  journal = await loadJournal()
  refreshDate(false)
}

function fitEditorToViewport() {
  const viewport = window.visualViewport
  const dialog = editor.open ? editor : linkImportDialog
  if (!dialog.open || !viewport) return
  dialog.style.setProperty("--editor-viewport-top", `${viewport.offsetTop}px`)
  dialog.style.setProperty("--editor-viewport-height", `${viewport.height}px`)
}

function openEditor(article) {
  editingId = article?.id ?? null
  editorForm.reset()
  editorError.hidden = true
  for (const field of ["title", "text", "source", "url"]) {
    editorForm.elements[field].value = article?.[field] ?? ""
  }
  document.querySelector("#source-fields").open = Boolean(article?.source || article?.url)
  document.querySelector("#editor-title").textContent = editingId ? "编辑文章" : "粘贴文章"
  document.querySelector("#editor-hint").hidden = Boolean(editingId)
  saveButton.textContent = editingId ? "保存修改" : "收藏文章"
  editor.showModal()
  fitEditorToViewport()
}

function showError(element, error) {
  element.textContent = error
  element.hidden = false
}

function openLinkImport() {
  linkImportForm.reset()
  linkDraft = undefined
  linkImportError.hidden = true
  linkImportOrigin.hidden = true
  linkImportButton.disabled = false
  linkImportButton.textContent = "读取并收藏"
  linkImportDialog.showModal()
  fitEditorToViewport()
}

function pasteFromLink() {
  let draft = { url: safeSourceUrl(linkImportUrl.value.trim()) }
  try {
    const link = identifyArticleLink(linkImportUrl.value)
    draft = linkDraft?.url === link.url ? linkDraft : link
  } catch {
    // An unsupported link can still be kept with pasted text.
  }
  linkImportDialog.close()
  openEditor(draft)
}

function openDeleteDialog(id) {
  const article = findArticle(id)
  if (!article || article.id === sample.id) return
  deletingId = id
  deleteDialog.querySelector("#delete-name").textContent = article.title
  deleteError.hidden = true
  deleteDialog.showModal()
}

function showToast(message, article) {
  toast.querySelector("span").textContent = message
  const link = toast.querySelector("a")
  link.hidden = !article
  if (article) {
    link.href = `#read/${article.id}`
    link.textContent = "阅读"
  }
  toast.hidden = false
  clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => { toast.hidden = true }, 5500)
}

function celebrate(article) {
  if (route().page !== "desk") history.pushState(null, "", "#desk")
  render()
  main.querySelector('.calendar-day[aria-current="date"]').scrollIntoView({ block: "nearest" })
  stampDialog.querySelector("[data-seal-date]").textContent = article.day.replaceAll("-", ".")
  stampDialog.querySelector("[data-celebration-streak]").textContent = readingStats(checkedDays(), today).current
  stampDialog.querySelector("[data-stamp-article]").href = `#read/${article.id}`
  stampDialog.showModal()
}

async function reportArticleSaved(saved) {
  updates.postMessage("journal-changed")
  try {
    await refreshJournal()
  } catch {
    showToast("文章已保存。刷新页面即可重新加载收藏。")
    return
  }
  if (saved?.stamped) {
    celebrate(saved.article)
  } else {
    render()
    showToast(saved ? "文章已收藏" : "修改已保存", saved?.article)
  }
}

linkImportDialog.addEventListener("close", () => {
  linkRequest?.abort()
  linkRequest = undefined
})

linkImportForm.addEventListener("submit", async event => {
  event.preventDefault()
  if (linkRequest) return
  linkImportError.hidden = true
  linkImportOrigin.hidden = true
  let link
  try {
    link = identifyArticleLink(linkImportUrl.value)
  } catch (error) {
    showError(linkImportError, error.message)
    return
  }

  const request = new AbortController()
  linkRequest = request
  linkImportButton.disabled = true
  linkImportButton.textContent = "正在读取…"
  const timeout = setTimeout(() => request.abort(), 30_000)
  try {
    const result = await fetchPublicArticle(link, request.signal)
    clearTimeout(timeout)
    if (linkRequest !== request || !linkImportDialog.open) return
    linkDraft = result.article
    if (result.error) throw new Error(result.error)
    linkImportButton.textContent = "正在收藏…"
    const saved = await saveArticle(result.article).catch(() => {
      throw new Error("已读到正文，但收藏失败。可在粘贴框里重试保存。")
    })
    linkImportDialog.close()
    await reportArticleSaved(saved)
  } catch (error) {
    if (linkRequest === request && linkImportDialog.open) {
      showError(linkImportError, request.signal.aborted ? "读取超时。可以重试或粘贴正文。" : error.message)
      linkImportOrigin.href = link.url
      linkImportOrigin.hidden = false
    }
  } finally {
    clearTimeout(timeout)
    if (linkRequest === request) {
      linkRequest = undefined
      linkImportButton.disabled = false
      linkImportButton.textContent = "读取并收藏"
    }
  }
})

editorForm.addEventListener("submit", async event => {
  event.preventDefault()
  if (saveButton.disabled) return
  editorError.hidden = true
  const fields = new FormData(editorForm)
  const text = fields.get("text").replace(/\r\n?/g, "\n").trim()
  if (!text) {
    showError(editorError, "请粘贴文章正文。")
    editorForm.elements.text.focus()
    return
  }
  const url = safeSourceUrl(fields.get("url").trim())
  if (fields.get("url").trim() && !url) {
    showError(editorError, "原文链接应以 https:// 或 http:// 开头。")
    editorForm.elements.url.focus()
    return
  }
  const firstLine = text.split("\n", 1)[0].trim()
  const title = fields.get("title").trim() || (firstLine.length > 86 ? `${firstLine.slice(0, 85)}…` : firstLine)
  const draft = { title, text, source: fields.get("source").trim(), url }
  saveButton.disabled = true
  let saved
  try {
    if (editingId) await updateArticle(editingId, draft)
    else saved = await saveArticle(draft)
  } catch {
    showError(editorError, "保存失败，正文仍在编辑框里。请检查浏览器的存储空间后重试。")
    return
  } finally {
    saveButton.disabled = false
  }
  editor.close()
  await reportArticleSaved(saved)
})

deleteForm.addEventListener("submit", async event => {
  event.preventDefault()
  if (deleteButton.disabled) return
  const id = deletingId
  deleteButton.disabled = true
  deleteError.hidden = true
  try {
    await deleteArticle(id)
  } catch {
    showError(deleteError, "暂时无法删除，请重试。")
    return
  } finally {
    deleteButton.disabled = false
  }
  deleteDialog.close()
  if (route().id === id) {
    history.replaceState(null, "", "#library")
    window.scrollTo(0, 0)
  }
  updates.postMessage("journal-changed")
  await loadAndRender()
  showToast("文章已删除")
})

function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function openTransferDialog() {
  const article = findArticle(route().id)
  if (!article || article.id === sample.id) return
  const backup = articleBackup(article, journal.checkins)
  pendingTransfer = backup
  transferDialog.querySelector("#transfer-name").textContent = article.title
  const field = transferDialog.querySelector("#transfer-link-field")
  field.hidden = true
  transferLink.value = ""
  copyTransfer.disabled = true
  transferStatus.textContent = "正在生成导入链接…"
  transferDialog.showModal()
  let url = ""
  try {
    url = await createTransferLink(backup)
  } catch {
    // The single-article file is available independently of the link.
  }
  if (pendingTransfer !== backup || !transferDialog.open) return
  if (!url) {
    transferStatus.textContent = "下载单篇文件发给自己，在手机的「备份与恢复」中导入。"
    return
  }
  transferLink.value = url
  field.hidden = false
  copyTransfer.disabled = false
  transferStatus.textContent = "把这条带有全文的链接发给自己，手机打开就能导入。"
}

async function copyArticleLink() {
  try {
    await navigator.clipboard.writeText(transferLink.value)
    transferStatus.textContent = "链接已复制。发给自己，在手机上打开即可。"
  } catch {
    transferLink.focus()
    transferLink.select()
    transferStatus.textContent = "已选中导入链接，可以手动复制。"
  }
}

async function downloadBackup() {
  try {
    const data = await exportJournal()
    downloadJson(data, `外刊日课-${localDay()}.json`)
    backupDialog.close()
    showToast("备份已下载")
  } catch {
    showError(backupError, "暂时无法读取收藏，请刷新页面后重试。")
  }
}

backupFile.addEventListener("change", async () => {
  const file = backupFile.files[0]
  backupFile.value = ""
  if (!file) return
  backupError.hidden = true
  let backup
  try {
    backup = JSON.parse(await file.text())
    await importJournal(backup)
  } catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof TypeError
    showError(backupError, invalid ? "请选择外刊日课导出的 JSON 备份。" : "导入失败，请检查浏览器的存储空间后重试。")
    return
  }
  backupDialog.close()
  updates.postMessage("journal-changed")
  if (backup.articleTransfer && backup.articles.length === 1) {
    await openTransferredArticle(backup.articles[0].id)
    showToast("文章已导入")
    return
  }
  await loadAndRender()
  showToast("备份已合并")
})

document.addEventListener("click", event => {
  const settings = main.querySelector(".reading-preferences[open]")
  if (mobileReader.matches && document.body.classList.contains("reading-mode") && !settings
    && event.target.closest(".app-body") && !event.target.closest(".topbar, .reader-tools, a, button, input, summary")
    && window.getSelection()?.type !== "Range") {
    if (document.body.classList.contains("reading-bars-hidden")) revealReadingBars()
    else document.body.classList.add("reading-bars-hidden")
  }
  if (settings && !settings.contains(event.target)) settings.open = false
  const control = event.target.closest("[data-action]")
  if (event.target.closest("[data-stamp-article]")) stampDialog.close()
  if (event.target.closest("#toast a")) toast.hidden = true
  if (event.target === stampDialog) stampDialog.close()
  if (!control) return
  const action = control.dataset.action
  if (action === "new") openEditor()
  if (action === "import-link") openLinkImport()
  if (action === "paste-from-link") pasteFromLink()
  if (action === "edit") openEditor(findArticle(route().id))
  if (action === "transfer") openTransferDialog()
  if (action === "copy-transfer") copyArticleLink()
  if (action === "export-article" && pendingTransfer) {
    downloadJson(pendingTransfer, `外刊日课-单篇-${pendingTransfer.articles[0].day}.json`)
    transferStatus.textContent = "在手机打开「备份与恢复」，选择这份单篇文件导入。"
  }
  if (action === "delete") openDeleteDialog(control.dataset.articleId)
  if (action === "close") control.closest("dialog").close()
  if (action === "backup") {
    backupError.hidden = true
    backupDialog.showModal()
  }
  if (action === "export") downloadBackup()
  if (action === "import") backupFile.click()
  if (action === "prev-year" || action === "next-year") {
    calendarYear += action === "prev-year" ? -1 : 1
    render()
    const nextControl = main.querySelector(`[data-action="${action}"]`)
    if (nextControl.disabled) main.querySelector(".year-nav button:enabled")?.focus()
    else nextControl.focus()
  }
})

document.addEventListener("keydown", event => {
  if (event.key === "Tab" && document.body.classList.contains("reading-bars-hidden")) revealReadingBars()
  if (event.key !== "Escape") return
  const settings = main.querySelector(".reading-preferences[open]")
  if (!settings || !settings.contains(document.activeElement)) return
  settings.open = false
  settings.querySelector("summary").focus()
})

async function loadAndRender() {
  try {
    await refreshJournal()
    ready = true
    render()
  } catch {
    main.replaceChildren()
    message(main, "无法打开本地收藏", "请检查浏览器是否允许此网站使用存储，然后刷新页面。")
  }
}

window.addEventListener("hashchange", () => {
  revealReadingBars()
  render()
  window.scrollTo(0, 0)
  updateReadingProgress()
  main.focus({ preventScroll: true })
})
window.addEventListener("scroll", handleReadingScroll, { passive: true })
window.addEventListener("resize", updateReadingProgress)
mobileReader.addEventListener("change", revealReadingBars)
window.visualViewport?.addEventListener("resize", fitEditorToViewport)
window.visualViewport?.addEventListener("scroll", fitEditorToViewport)
document.addEventListener("visibilitychange", () => refreshDate())
setInterval(refreshDate, 30_000)
updates.addEventListener("message", loadAndRender)
loadAndRender().then(restoreReadingAfterUpdate)
watchForSiteUpdates()
