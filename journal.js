const sitePath = location.pathname.replace(/\/index\.html$/, "/")
const databaseName = `press-journal:${sitePath}`
const backupFormat = "press-journal"
let database

export function localDay(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function mondayOf(day) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  return shiftDay(day, -((weekday + 6) % 7))
}

export function readingStreaks(days) {
  const streaks = new Map()
  let run = 0
  let previous = ""
  for (const day of [...new Set(days)].sort()) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1
    streaks.set(day, run)
    previous = day
  }
  return streaks
}

export function readingStats(days, today) {
  const streaks = readingStreaks([...days].filter(day => day <= today))
  return {
    current: streaks.get(today) ?? streaks.get(shiftDay(today, -1)) ?? 0,
    longest: [...streaks.values()].reduce((longest, run) => Math.max(longest, run), 0),
    total: streaks.size
  }
}

export function safeSourceUrl(value) {
  if (!value) return ""
  try {
    const url = new URL(value)
    return ["https:", "http:"].includes(url.protocol) ? url.href : ""
  } catch {
    return ""
  }
}

function openJournal() {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("articles", { keyPath: "id" })
      request.result.createObjectStore("checkins", { keyPath: "day" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction canceled"))
  })
}

export async function loadJournal() {
  const db = await openJournal()
  const transaction = db.transaction(["articles", "checkins"])
  const articles = transaction.objectStore("articles").getAll()
  const checkins = transaction.objectStore("checkins").getAll()
  await transactionFinished(transaction)
  return {
    articles: articles.result.sort((a, b) => b.day.localeCompare(a.day) || Date.parse(b.savedAt) - Date.parse(a.savedAt)),
    checkins: checkins.result
  }
}

export async function saveArticle(draft) {
  const db = await openJournal()
  const transaction = db.transaction(["articles", "checkins"], "readwrite")
  const now = new Date()
  const article = {
    ...draft,
    id: crypto.randomUUID(),
    day: localDay(now),
    savedAt: now.toISOString()
  }
  const checkins = transaction.objectStore("checkins")
  const existing = checkins.get(article.day)
  let stamped = false
  existing.onsuccess = () => {
    if (!existing.result) {
      checkins.add({ day: article.day, createdAt: article.savedAt })
      stamped = true
    }
    transaction.objectStore("articles").add(article)
  }
  await transactionFinished(transaction)
  return { article, stamped }
}

export async function updateArticle(id, draft) {
  const db = await openJournal()
  const transaction = db.transaction("articles", "readwrite")
  const articles = transaction.objectStore("articles")
  const existing = articles.get(id)
  existing.onsuccess = () => {
    if (existing.result) articles.put({ ...existing.result, ...draft })
    else transaction.abort()
  }
  await transactionFinished(transaction)
}

export async function deleteArticle(id) {
  const db = await openJournal()
  const transaction = db.transaction("articles", "readwrite")
  transaction.objectStore("articles").delete(id)
  await transactionFinished(transaction)
}

export async function exportJournal() {
  const journal = await loadJournal()
  return { format: backupFormat, version: 1, ...journal }
}

function validDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(`${day}T12:00:00Z`)
  return Number.isFinite(+date) && date.toISOString().startsWith(day)
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function validArticle(article) {
  return article && typeof article.id === "string" && /^[\w-]{1,80}$/.test(article.id)
    && article.id !== "sample"
    && typeof article.title === "string" && !!article.title.trim() && article.title.length <= 240
    && typeof article.text === "string" && !!article.text.trim()
    && typeof article.source === "string" && article.source.length <= 120
    && typeof article.url === "string" && (!article.url || !!safeSourceUrl(article.url))
    && validDay(article.day) && validTimestamp(article.savedAt)
}

function addMissing(store, entries, key) {
  const request = store.getAllKeys()
  request.onsuccess = () => {
    const keys = new Set(request.result)
    for (const entry of entries) {
      if (keys.has(entry[key])) continue
      store.add(entry)
      keys.add(entry[key])
    }
  }
}

export async function importJournal(backup) {
  if (backup?.format !== backupFormat || backup.version !== 1
    || !Array.isArray(backup.articles) || !backup.articles.every(validArticle)
    || !Array.isArray(backup.checkins)
    || !backup.checkins.every(stamp => stamp && validDay(stamp.day) && validTimestamp(stamp.createdAt))) {
    throw new TypeError("Invalid journal backup")
  }

  const db = await openJournal()
  const transaction = db.transaction(["articles", "checkins"], "readwrite")
  addMissing(transaction.objectStore("articles"), backup.articles, "id")
  addMissing(transaction.objectStore("checkins"), backup.checkins, "day")
  await transactionFinished(transaction)
}
