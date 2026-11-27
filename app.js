import {
  deleteArticle, exportJournal, importJournal, isJournalBackup, loadJournal, localDay, mondayOf,
  readingStats, readingStreaks, safeSourceUrl, saveArticle, shiftDay, updateArticle
} from "./journal.js?v=6"
import { articleBackup, createTransferLink, readTransferLink } from "./transfer.js?v=6"
import { restoreReadingAfterUpdate, watchForSiteUpdates } from "./release.js?v=4"
import { cleanPublisherText, fetchPublicArticle, identifyArticleLink, publishers } from "./link-import.js?v=12"
import { readQuizEditor, setQuizEditor, showQuiz } from "./quiz.js?v=2"

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

const publisherStyles = [
  { key: "economist", monogram: "E", match: /economist|经济学人/i },
  { key: "guardian", monogram: "G", match: /guardian|卫报/i },
  { key: "sciam", monogram: "SA", match: /scientific american|科学美国人/i },
  { key: "nyt", monogram: "T", match: /new york times|nytimes|纽约时报/i },
  { key: "wapo", monogram: "WP", match: /washington post|华盛顿邮报/i },
  { key: "time", monogram: "Ti", match: /^time$|时代周刊/i },
  { key: "atlantic", monogram: "A", match: /atlantic|大西洋月刊/i },
  { key: "bloomberg", monogram: "BB", match: /bloomberg|businessweek|彭博/i }
]

const themeColors = {
  default: "#f5f6f0",
  white: "#f5f6f0",
  warm: "#efe7d7",
  sage: "#dfe9dc",
  night: "#141a17"
}

const pages = { desk: "阅读书桌", library: "文章收藏", calendar: "打卡日历", reader: "阅读文章", import: "导入文章" }
const main = document.querySelector("#main")
const editor = document.querySelector("#editor-dialog")
const editorForm = document.querySelector("#editor-form")
const editorError = document.querySelector("#editor-error")
const editorWordCount = document.querySelector("#editor-word-count")
const saveButton = document.querySelector("#save-button")
const linkImportDialog = document.querySelector("#link-import-dialog")
const linkImportForm = document.querySelector("#link-import-form")
const linkImportUrl = document.querySelector("#link-import-url")
const linkImportQuiz = linkImportForm.elements.addQuiz
const linkImportButton = document.querySelector("#link-import-button")
const linkImportError = document.querySelector("#link-import-error")
const linkImportOrigin = document.querySelector("#link-import-origin")
const deleteDialog = document.querySelector("#delete-dialog")
const deleteForm = document.querySelector("#delete-form")
const deleteError = document.querySelector("#delete-error")
const deleteButton = document.querySelector("#delete-button")
const sidebarToggle = document.querySelector("#sidebar-toggle")
const sidebarPulse = document.querySelector("#sidebar-pulse")
const sidebarPulseTitle = document.querySelector("#sidebar-pulse-title")
const sidebarPulseSub = document.querySelector("#sidebar-pulse-sub")
const topbarArticleTitle = document.querySelector("#topbar-article-title")
const topbarProgressPill = document.querySelector("#topbar-progress-pill")
const themeColorMeta = document.querySelector('meta[name="theme-color"]')
const stampDialog = document.querySelector("#stamp-dialog")
const backupDialog = document.querySelector("#backup-dialog")
const backupFile = document.querySelector("#backup-file")
const backupError = document.querySelector("#backup-error")
const backupImportButton = backupDialog.querySelector('[data-action="import"]')
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
let activeLibraryFilter = "all"
let preferences = {
  "font-size": "medium",
  "paper-theme": "white",
  "font-family": "serif",
  "line-height": "normal"
}

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

function setFocusMode(enabled) {
  document.body.classList.toggle("focus-mode", enabled)
  const button = main.querySelector('[data-action="toggle-focus"]')
  if (!button) return
  button.setAttribute("aria-pressed", String(enabled))
  button.title = enabled ? "退出专注模式" : "专注阅读模式"
  button.querySelector("use").setAttribute("href", enabled ? "#i-focus-exit" : "#i-focus")
  button.querySelector("span").textContent = enabled ? "退出专注" : "专注"
}

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

function countWords(text, source = "") {
  const cleaned = cleanPublisherText(text, source).trim()
  if (!cleaned) return 0
  return cleaned.split(/\s+/).length
}

function readMinutes(article) {
  return Math.max(1, Math.ceil(countWords(article.text, article.source) / 220))
}

function readTime(article) {
  return `约 ${readMinutes(article)} 分钟`
}

function articleExcerpt(article) {
  const cleaned = cleanPublisherText(article.text, article.source)
  const paragraphs = cleaned.split(/\n+/).map(line => line.trim()).filter(Boolean)
  if (paragraphs.length > 1 && paragraphs[0] === article.title) paragraphs.shift()
  const first = paragraphs[0] ?? ""
  return first.length > 180 ? `${first.slice(0, 178).trimEnd()}…` : first
}

function publisherBadgeInfo(article) {
  if (article.id === sample.id) return { key: "sample", monogram: null, icon: "book" }
  const source = (article.source || "").trim()
  if (source) {
    const matched = publisherStyles.find(item => item.match.test(source))
    if (matched) return { key: matched.key, monogram: matched.monogram }
    const initials = source.replace(/^The\s+/i, "").trim().slice(0, 2).toUpperCase()
    if (initials) return { key: "custom", monogram: initials }
  }
  return { key: "custom", monogram: null, icon: "file" }
}

function greetingCopy() {
  const hour = new Date().getHours()
  if (hour < 11) return { eyebrow: "晨光书桌 · MORNING EDITION", heading: "晨读一篇好外刊" }
  if (hour < 18) return { eyebrow: "午后书桌 · AFTERNOON EDITION", heading: "今天读了什么？" }
  return { eyebrow: "灯下夜读 · EVENING EDITION", heading: "今晚读点什么？" }
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
  const excerpt = row.querySelector("[data-row-excerpt]")
  const mark = row.querySelector("[data-article-mark]")
  const meta = row.querySelector("[data-row-meta]")
  const remove = row.querySelector("[data-action=delete]")
  link.href = `#read/${article.id}`
  title.textContent = article.title

  const badge = publisherBadgeInfo(article)
  mark.dataset.pub = badge.key
  if (badge.monogram) {
    mark.textContent = badge.monogram
  } else {
    mark.replaceChildren(icon(badge.icon || "file"))
  }

  const preview = articleExcerpt(article)
  if (preview) {
    excerpt.textContent = preview
    if (!/\p{Script=Han}/u.test(preview)) excerpt.lang = "en"
    excerpt.hidden = false
  }

  if (article.id === sample.id) {
    title.lang = "en"
    link.parentElement.classList.add("sample-row")
    remove.hidden = true
  } else {
    if (!/\p{Script=Han}/u.test(article.title)) title.lang = "en"
    remove.dataset.articleId = article.id
    remove.setAttribute("aria-label", `删除文章：${article.title}`)
  }

  const words = countWords(article.text, article.source)
  const parts = []
  if (article.source) {
    const src = document.createElement("span")
    src.className = "meta-source"
    src.textContent = article.source
    parts.push(src)
  }
  const timeSpan = document.createElement("span")
  timeSpan.textContent = words ? `${words} 词 · ${readTime(article)}` : readTime(article)
  parts.push(timeSpan)
  parts.forEach((node, index) => {
    if (index > 0) {
      const dot = document.createElement("span")
      dot.className = "meta-dot"
      dot.textContent = "·"
      dot.setAttribute("aria-hidden", "true")
      meta.append(dot)
    }
    meta.append(node)
  })
  if (article.quiz?.length) {
    const pill = document.createElement("span")
    pill.className = "meta-quiz-pill"
    pill.append(icon("quiz"), `${article.quiz.length} 题阅读理解`)
    meta.append(pill)
  }
  return row
}

function showArticles(container, articles, query = "", hasFilter = false) {
  container.replaceChildren()
  if (!articles.length) {
    const list = document.createElement("div")
    list.className = "paper article-list"
    if (query || hasFilter) {
      message(list, "没找到相关文章", "试试更换筛选条件或其他关键词。", "search")
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
      label.textContent = `连续第 ${run} 天`
      label.hidden = false
    }
    group.querySelector(".article-list").append(...entries.map(articleRow))
    container.append(group)
  }
}

function checkedDays() {
  return new Set(journal.checkins.map(stamp => stamp.day))
}

function updateSidebarPulse() {
  const days = checkedDays()
  const stats = readingStats(days, today)
  const stamped = days.has(today)
  sidebarPulse.classList.toggle("is-stamped", stamped)
  sidebarPulseTitle.textContent = stamped ? "今日已盖章" : "今日待盖章"
  sidebarPulseSub.textContent = stats.current > 0 ? `连续打卡 ${stats.current} 天` : "保存一篇文章开始打卡"
}

function buildWeekStrip(container, days) {
  const start = mondayOf(today)
  const labels = ["一", "二", "三", "四", "五", "六", "日"]
  container.replaceChildren()
  labels.forEach((label, offset) => {
    const day = shiftDay(start, offset)
    const item = document.createElement("div")
    item.className = "week-dot"
    if (days.has(day)) item.classList.add("is-checked")
    if (day === today) item.classList.add("is-today")
    if (day > today) item.classList.add("is-future")
    item.title = `${dateText(day)} · ${days.has(day) ? "已盖章" : day > today ? "未到" : "未盖章"}`
    const dot = document.createElement("i")
    if (days.has(day)) dot.append(icon("check"))
    const text = document.createElement("span")
    text.textContent = label
    item.append(dot, text)
    container.append(item)
  })
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
  const count = journal.articles.filter(a => a.day === day).length
  const extra = count > 0 ? ` · ${count} 篇` : ""
  cell.title = `${dateText(day)} · ${checked ? "已盖章" : "未盖章"}${extra}`
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

function renderCalendarDayDrawer(day) {
  const drawer = main.querySelector("[data-calendar-day-drawer]")
  if (!drawer) return
  const days = checkedDays()
  const entries = journal.articles.filter(article => article.day === day)
  const stamped = days.has(day)
  drawer.replaceChildren()

  const header = document.createElement("div")
  header.className = "drawer-header"
  const heading = document.createElement("h3")
  heading.textContent = dateText(day, archiveDateFormat)
  const badge = document.createElement("span")
  badge.className = `drawer-badge${stamped ? " is-stamped" : ""}`
  badge.textContent = stamped ? "已盖章" : "未盖章"
  header.append(heading, badge)
  drawer.append(header)

  if (!entries.length) {
    const empty = document.createElement("p")
    empty.className = "drawer-empty"
    empty.textContent = stamped ? "当天已打卡盖章，文章已从书架移除。" : "这一天没有收藏文章。"
    drawer.append(empty)
  } else {
    const list = document.createElement("div")
    list.className = "drawer-articles"
    for (const article of entries) {
      const link = document.createElement("a")
      link.className = "drawer-article-link"
      link.href = `#read/${article.id}`
      const title = document.createElement("strong")
      title.dir = "auto"
      title.textContent = article.title
      const meta = document.createElement("span")
      meta.textContent = [article.source, readTime(article)].filter(Boolean).join(" · ")
      link.append(title, meta)
      list.append(link)
    }
    drawer.append(list)
  }
  drawer.hidden = false
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
    ? `${[...days].filter(day => day.startsWith(String(year)) && day <= today).length} 天已盖章 · 点击任意日期查看当日收藏`
    : "最近 12 周 · 点击日期定位文章"
  const legend = document.createElement("span")
  legend.className = "calendar-legend"
  legend.innerHTML = '<i></i>未盖章<i class="checked"></i>已盖章'
  footer.append(caption, legend)
  container.replaceChildren(viewport, footer)
  container.addEventListener("click", event => {
    const cell = event.target.closest("button[data-day]")
    if (!cell) return
    selectCalendarDay(container, cell)
    if (annual) renderCalendarDayDrawer(cell.dataset.day)
    else jumpToArchiveDay(container, cell.dataset.day)
  })
  container.addEventListener("keydown", event => {
    const cell = event.target.closest("button[data-day]")
    const offsets = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
    if (!cell || !(event.key in offsets)) return
    event.preventDefault()
    const next = container.querySelector(`[data-day="${shiftDay(cell.dataset.day, offsets[event.key])}"]`)
    if (next) {
      selectCalendarDay(container, next, true)
      if (annual) renderCalendarDayDrawer(next.dataset.day)
    }
  })
  if (annual && selected === today) {
    const todayCell = grid.querySelector('[aria-current="date"]')
    if (todayCell) viewport.scrollLeft = todayCell.offsetLeft - viewport.clientWidth + todayCell.offsetWidth + 12
  }
}

function showDesk() {
  main.append(view("desk-view"))
  const days = checkedDays()
  const stats = readingStats(days, today)
  const stamped = days.has(today)
  const greeting = greetingCopy()

  const eyebrow = main.querySelector("[data-desk-eyebrow]")
  const heading = main.querySelector("[data-desk-heading]")
  const subtitle = main.querySelector("[data-desk-subtitle]")
  eyebrow.textContent = stamped ? `今日已盖章 · 连续第 ${stats.current} 天` : greeting.eyebrow
  eyebrow.classList.toggle("is-stamped", stamped)
  heading.textContent = stamped ? "今日外刊已归档" : greeting.heading
  subtitle.textContent = stamped
    ? "今日外刊日课已完成，保持这份从容的阅读节奏。"
    : "收藏一篇英语外刊，在阅读日历上为今天盖一枚章。"

  const monthPrefix = today.slice(0, 7)
  const monthDays = [...days].filter(day => day.startsWith(monthPrefix) && day <= today).length
  const totalMinutes = journal.articles.reduce((sum, article) => sum + readMinutes(article), 0)
  main.querySelector("[data-metric-articles]").textContent = journal.articles.length
  main.querySelector("[data-metric-month]").textContent = monthDays
  main.querySelector("[data-metric-minutes]").textContent = totalMinutes

  showArticles(main.querySelector("[data-recent]"), journal.articles)
  main.querySelector("[data-streak]").textContent = stats.current
  if (stamped) {
    main.querySelector("[data-today-stamp]").classList.add("is-stamped")
    main.querySelector("[data-today-status]").textContent = "今日已盖章"
  }
  buildWeekStrip(main.querySelector("[data-week-strip]"), days)
  buildCalendar(main.querySelector("[data-calendar]"), days)
}

function showLibrary(search = "") {
  main.append(view("library-view"))
  const totalWords = journal.articles.reduce((sum, article) => sum + countWords(article.text, article.source), 0)
  const wordNote = totalWords ? ` · 累计约 ${totalWords.toLocaleString("zh-CN")} 词` : ""
  main.querySelector("[data-library-count]").textContent = `已收藏 ${journal.articles.length} 篇文章${wordNote}`

  const input = main.querySelector("[data-search]")
  const clearBtn = main.querySelector("[data-search-clear]")
  const chipsContainer = main.querySelector("[data-filter-chips]")
  const container = main.querySelector("[data-library]")
  input.value = search

  const sourceCounts = new Map()
  let quizCount = 0
  for (const article of journal.articles) {
    if (article.source) sourceCounts.set(article.source, (sourceCounts.get(article.source) ?? 0) + 1)
    if (article.quiz?.length) quizCount += 1
  }

  const filterDefs = [{ id: "all", label: "全部", count: journal.articles.length }]
  for (const [source, count] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) {
    filterDefs.push({ id: `source:${source}`, label: source, count })
  }
  if (quizCount > 0) filterDefs.push({ id: "has-quiz", label: "含阅读理解", count: quizCount })

  if (!filterDefs.some(item => item.id === activeLibraryFilter)) activeLibraryFilter = "all"

  const renderChips = () => {
    if (filterDefs.length <= 2) {
      chipsContainer.hidden = true
      return
    }
    chipsContainer.hidden = false
    chipsContainer.replaceChildren(...filterDefs.map(def => {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "filter-chip"
      btn.dataset.filterId = def.id
      btn.setAttribute("aria-pressed", String(activeLibraryFilter === def.id))
      const label = document.createElement("span")
      label.textContent = def.label
      const count = document.createElement("span")
      count.className = "chip-count"
      count.textContent = def.count
      btn.append(label, count)
      return btn
    }))
  }

  const filter = () => {
    const query = input.value.trim().toLocaleLowerCase()
    clearBtn.hidden = !input.value
    let articles = journal.articles
    if (activeLibraryFilter === "has-quiz") {
      articles = articles.filter(article => article.quiz?.length > 0)
    } else if (activeLibraryFilter.startsWith("source:")) {
      const targetSource = activeLibraryFilter.slice(7)
      articles = articles.filter(article => article.source === targetSource)
    }
    if (query) {
      articles = articles.filter(article =>
        [article.title, article.source, article.text].some(value => value.toLocaleLowerCase().includes(query))
      )
    }
    showArticles(container, articles, query, activeLibraryFilter !== "all")
  }

  chipsContainer.addEventListener("click", event => {
    const chip = event.target.closest("[data-filter-id]")
    if (!chip) return
    activeLibraryFilter = chip.dataset.filterId
    renderChips()
    filter()
  })
  clearBtn.addEventListener("click", () => {
    input.value = ""
    input.focus()
    filter()
  })
  input.addEventListener("input", filter)
  renderChips()
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
  const yearStamped = [...days].filter(day => day.startsWith(String(calendarYear)) && day <= today).length
  const yearArticles = journal.articles.filter(article => article.day.startsWith(String(calendarYear))).length
  main.querySelector("[data-calendar-year-sub]").textContent = `当年已盖章 ${yearStamped} 天 · 收藏 ${yearArticles} 篇外刊`
  const thisYear = Number(today.slice(0, 4))
  const oldest = Math.min(thisYear - 1, ...[...days].map(day => Number(day.slice(0, 4))))
  main.querySelector('[data-action="prev-year"]').disabled = calendarYear <= oldest
  main.querySelector('[data-action="next-year"]').disabled = calendarYear >= thisYear
  buildCalendar(main.querySelector("[data-calendar]"), days, calendarYear)
  if (calendarYear === thisYear && (days.has(today) || journal.articles.some(a => a.day === today))) {
    renderCalendarDayDrawer(today)
  }
}

function updateReadingProgress() {
  const progress = main.querySelector(".reading-progress")
  if (!progress) return
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight
  const pct = maxScroll > 0 ? Math.min(100, Math.max(0, window.scrollY / maxScroll * 100)) : 100
  progress.value = pct
  topbarProgressPill.textContent = `${Math.round(pct)}%`
  topbarProgressPill.hidden = false

  const header = main.querySelector(".article-header")
  if (header) {
    const pastHeader = header.getBoundingClientRect().bottom < 72
    topbarArticleTitle.classList.toggle("is-visible", pastHeader)
  }

  const floatBox = main.querySelector("[data-reader-float]")
  const topButton = main.querySelector('[data-action="scroll-top"]')
  const quizButton = main.querySelector('[data-action="jump-quiz"]')
  if (floatBox && topButton) {
    const showTop = window.scrollY > 320
    topButton.hidden = !showTop
    floatBox.hidden = !showTop && (!quizButton || quizButton.hidden)
  }
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

function syncThemeColor(theme) {
  if (!themeColorMeta) return
  themeColorMeta.content = themeColors[theme] ?? themeColors.default
}

function applyReadingPreferences(reader) {
  reader.dataset.fontSize = preferences["font-size"]
  reader.dataset.theme = preferences["paper-theme"]
  reader.dataset.fontFamily = preferences["font-family"] || "serif"
  reader.dataset.lineHeight = preferences["line-height"] || "normal"
  document.body.dataset.readerTheme = preferences["paper-theme"]
  syncThemeColor(preferences["paper-theme"])
  updateReadingProgress()
}

function showReader(article) {
  if (!article) {
    delete document.body.dataset.readerTheme
    syncThemeColor("default")
    message(main, "这篇文章还没收藏", "可以从文章收藏打开此浏览器里的文章。", "file")
    return
  }

  main.append(view("reader-view"))
  const reader = main.querySelector(".reader")
  const title = reader.querySelector("[data-article-title]")
  title.textContent = article.title
  topbarArticleTitle.textContent = article.title

  const date = article.day ? dateText(article.day, archiveDateFormat) : ""
  const run = readingStreaks(checkedDays()).get(article.day)
  const words = countWords(article.text, article.source)

  const kicker = reader.querySelector("[data-article-kicker]")
  const pubEl = reader.querySelector("[data-article-publisher]")
  const streakEl = reader.querySelector("[data-article-streak]")
  if (article.source || run) {
    kicker.hidden = false
    if (article.source) {
      pubEl.textContent = article.source
      pubEl.dataset.pub = publisherBadgeInfo(article).key
    } else {
      pubEl.hidden = true
    }
    if (run) {
      streakEl.textContent = `连续第 ${run} 天`
      streakEl.hidden = false
    }
  }

  const metadata = [date, words ? `${words} 词` : "", readTime(article)].filter(Boolean)
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
  if (article.id !== sample.id) {
    const quiz = reader.querySelector(".article-quiz")
    showQuiz(quiz, article.quiz)
    quiz.addEventListener("toggle", updateReadingProgress)
    if (article.quiz?.length) {
      const jumpQuiz = reader.querySelector('[data-action="jump-quiz"]')
      jumpQuiz.hidden = false
      reader.querySelector("[data-reader-float]").hidden = false
    }
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
  setFocusMode(document.body.classList.contains("focus-mode"))
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
  status.textContent = saved ? "这篇文章已在你的收藏里。" : "文章及附带的阅读理解题目会一起存入。"
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
  const isReading = Boolean(article)
  document.body.classList.toggle("reading-mode", isReading)
  if (!isReading) {
    revealReadingBars()
    document.body.classList.remove("focus-mode")
    delete document.body.dataset.readerTheme
    syncThemeColor("default")
    topbarArticleTitle.textContent = ""
    topbarArticleTitle.classList.remove("is-visible")
    topbarProgressPill.hidden = true
  }
  document.title = `${article?.title ?? pages[page]} · 外刊日课`
  document.querySelector("#page-label").textContent = pages[page]
  renderDate()
  updateSidebarPulse()
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

function updateEditorWordCount() {
  const words = countWords(editorForm.elements.text.value)
  editorWordCount.textContent = words ? `${words} 词 · 约 ${Math.max(1, Math.ceil(words / 220))} 分钟` : ""
}

editorForm.elements.text.addEventListener("input", updateEditorWordCount)

function openEditor(article, focusQuiz = false) {
  editingId = article?.id ?? null
  editorForm.reset()
  editorError.hidden = true
  for (const field of ["title", "text", "source", "url"]) {
    editorForm.elements[field].value = article?.[field] ?? ""
  }
  updateEditorWordCount()
  document.querySelector("#source-fields").open = Boolean(article?.source || article?.url)
  const quizControl = setQuizEditor(article?.quiz, focusQuiz)
  document.querySelector("#editor-title").textContent = editingId ? "编辑文章" : "粘贴文章"
  document.querySelector("#editor-hint").hidden = Boolean(editingId)
  saveButton.textContent = editingId ? "保存修改" : "收藏文章"
  editor.showModal()
  fitEditorToViewport()
  if (focusQuiz) {
    quizControl.closest(".quiz-editor").scrollIntoView({ block: "start" })
    quizControl.focus({ preventScroll: true })
  }
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
  linkImportQuiz.disabled = false
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
    link.textContent = "立即阅读"
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

linkImportQuiz.addEventListener("change", () => {
  linkImportButton.textContent = linkImportQuiz.checked ? "读取并编辑" : "读取并收藏"
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
  const addQuiz = linkImportQuiz.checked
  linkRequest = request
  linkImportButton.disabled = true
  linkImportQuiz.disabled = true
  linkImportButton.textContent = "正在读取…"
  const timeout = setTimeout(() => request.abort(), 30_000)
  try {
    const result = await fetchPublicArticle(link, request.signal)
    clearTimeout(timeout)
    if (linkRequest !== request || !linkImportDialog.open) return
    linkDraft = result.article
    if (result.error) throw new Error(result.error)
    if (addQuiz) {
      linkImportDialog.close()
      openEditor(result.article, true)
      return
    }
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
      linkImportQuiz.disabled = false
      linkImportButton.textContent = addQuiz ? "读取并编辑" : "读取并收藏"
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
  let quiz
  try {
    quiz = readQuizEditor()
  } catch (error) {
    showError(editorError, error.message)
    return
  }
  const draft = { title, text, source: fields.get("source").trim(), url, quiz }
  const articleId = editingId
  const quizWasOpen = Boolean(main.querySelector(".article-quiz[open]"))
  saveButton.disabled = true
  let saved
  try {
    if (articleId) await updateArticle(articleId, draft)
    else saved = await saveArticle(draft)
  } catch {
    showError(editorError, "保存失败，正文仍在编辑框里。请检查浏览器的存储空间后重试。")
    return
  } finally {
    saveButton.disabled = false
  }
  editor.close()
  await reportArticleSaved(saved)
  const quizPanel = main.querySelector(".article-quiz")
  if (quizWasOpen && route().id === articleId && quizPanel) quizPanel.open = true
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
  backupImportButton.disabled = true
  let backup
  let singleArticle
  try {
    backup = JSON.parse(await file.text())
    if (!backupDialog.open) return
    if (!isJournalBackup(backup) || (backup.articleTransfer && backup.articles.length !== 1)) {
      throw new TypeError("Invalid journal backup")
    }
    singleArticle = Boolean(backup.articleTransfer)
    if (!singleArticle && !window.confirm(
      `用备份里的 ${backup.articles.length} 篇文章和 ${backup.checkins.length} 条打卡记录覆盖本机？本机独有的记录会被移除。`
    )) return
    await importJournal(backup, { replace: !singleArticle })
  } catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof TypeError
    showError(backupError, invalid ? "请选择外刊日课导出的 JSON 备份。" : "导入失败，请检查浏览器的存储空间后重试。")
    return
  } finally {
    backupImportButton.disabled = false
  }
  backupDialog.close()
  updates.postMessage("journal-changed")
  if (singleArticle) {
    await openTransferredArticle(backup.articles[0].id)
    showToast("文章已导入")
    return
  }
  await loadAndRender()
  showToast("已用备份覆盖本机记录")
})

document.addEventListener("click", event => {
  const settings = main.querySelector(".reading-preferences[open]")
  if (mobileReader.matches && document.body.classList.contains("reading-mode") && !settings
    && event.target.closest(".app-body") && !event.target.closest(".topbar, .reader-tools, .article-quiz, .reader-float, a, button, input, summary")
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
  if (action === "edit-quiz") openEditor(findArticle(route().id), true)
  if (action === "transfer") openTransferDialog()
  if (action === "copy-transfer") copyArticleLink()
  if (action === "toggle-focus") setFocusMode(!document.body.classList.contains("focus-mode"))
  if (action === "scroll-top") {
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    window.scrollTo({ top: 0, behavior })
  }
  if (action === "jump-quiz") {
    const quiz = main.querySelector(".article-quiz")
    if (quiz) {
      quiz.open = true
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      quiz.scrollIntoView({ behavior, block: "start" })
    }
  }
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
  if (event.key === "Escape") {
    const settings = main.querySelector(".reading-preferences[open]")
    if (settings && settings.contains(document.activeElement)) {
      settings.open = false
      settings.querySelector("summary").focus()
      return
    }
    if (document.body.classList.contains("focus-mode") && !document.querySelector("dialog[open]")) {
      setFocusMode(false)
    }
  }
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
