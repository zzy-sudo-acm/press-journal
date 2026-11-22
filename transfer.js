import { isJournalBackup } from "./journal.js?v=4"

const maxLinkLength = 6000
const maxArticleBytes = 256 * 1024

export function articleBackup(article, checkins) {
  const { id, title, text, source, url, day, savedAt } = article
  const stamp = checkins.find(record => record.day === day)
  return {
    format: "press-journal",
    version: 1,
    articleTransfer: true,
    articles: [{ id, title, text, source, url, day, savedAt }],
    checkins: stamp ? [{ day, createdAt: stamp.createdAt }] : []
  }
}

export async function createTransferLink(backup) {
  if (typeof CompressionStream === "undefined") return ""
  const contents = new Blob([JSON.stringify(backup)])
  if (contents.size > maxArticleBytes) return ""
  const compressed = contents.stream().pipeThrough(new CompressionStream("gzip"))
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer())
  if (bytes.length > maxLinkLength * 3 / 4) return ""

  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
  const url = new URL(location.href)
  url.search = ""
  url.hash = `import/${encoded}`
  return url.href.length <= maxLinkLength ? url.href : ""
}

export async function readTransferLink(encoded) {
  if (!encoded || encoded.length > maxLinkLength || !/^[\w-]+$/.test(encoded)) {
    throw new TypeError("Invalid article link")
  }
  const decoded = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"))
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
  const compressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
  const unpacked = await new Response(compressed).arrayBuffer()
  if (unpacked.byteLength > maxArticleBytes) throw new TypeError("Article link is too large")

  const backup = JSON.parse(new TextDecoder().decode(unpacked))
  if (!isJournalBackup(backup) || !backup.articleTransfer || backup.articles.length !== 1
    || backup.checkins.some(stamp => stamp.day !== backup.articles[0].day)) {
    throw new TypeError("Invalid article backup")
  }
  return backup
}
