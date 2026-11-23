export const publishers = [
  { name: "The Economist", domains: ["economist.com"] },
  { name: "The Guardian", domains: ["theguardian.com", "guardian.co.uk"] },
  { name: "Scientific American", domains: ["scientificamerican.com"] },
  { name: "The New York Times", domains: ["nytimes.com"] },
  { name: "The Washington Post", domains: ["washingtonpost.com"] },
  { name: "TIME", domains: ["time.com"] },
  { name: "The Atlantic", domains: ["theatlantic.com"] },
  { name: "Bloomberg Businessweek", domains: ["bloomberg.com", "businessweek.com"] }
]

const unavailable = "原站没有提供可读取的全文。可以打开原文，在你能阅读的页面复制正文。"
const restrictedTier = /^(?:metered|premium|paid|locked|registration|subscriber[- ]?only)$/i
const accessTitle = /^(?:access denied|forbidden|just a moment|attention required|page not found|verify (?:that )?you are human|robot check)\b/i
const accessNotice = /^(?:already a subscriber\b|(?:sign|log) in to (?:read|continue)\b|(?:register|subscribe) to (?:read|continue|unlock)\b|unlock this article\b|this article is (?:only )?for subscribers\b|you(?:['’]ve| have) reached (?:your|the) (?:free )?article limit\b)/i
const footerHeading = /^(?:explore more on these topics|more on this story|topics|related (?:articles|stories|content)|sign up for (?:our|the) newsletter)[.:]?$/i
const guardianFooter = /^[ \t*#_>+-]*(?:do you have an opinion on the issues raised in this article\?|year[-‑– ]end fundraiser[ \t*_:.!]*$)/im
const guardianCardLine = /^.+[ \t]+Read more[ \t]*(?:\r?\n+|$)/gm
const guardianBodyBlocks = "#maincontent > .article-body-viewer-selector > :is(p, h2, h3, h4, h5, h6, ul, ol, dl, blockquote, pre, table)"

function publisherFor(host) {
  return publishers.find(publisher => publisher.domains.some(domain => host === domain || host.endsWith(`.${domain}`)))
}

export function identifyArticleLink(input) {
  const value = input.trim()
  let url
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (url.username || url.password || url.port) throw new Error("Invalid URL")
  } catch {
    throw new Error("请输入有效的文章链接。")
  }
  const publisher = publisherFor(url.hostname)
  if (!publisher) throw new Error("请粘贴下方八家外刊之一的文章链接。")
  if (url.pathname === "/") throw new Error("请打开具体文章，再复制它的链接。")
  url.protocol = "https:"
  return { url: url.href, publicUrl: url.origin + url.pathname, source: publisher.name }
}

function plainLine(line) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>)\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim()
}

export function cleanPublisherText(text, source) {
  if (!/^(?:the )?guardian$|^卫报$/i.test(source.trim())) return text
  const boundary = text.search(guardianFooter)
  const body = boundary >= 0 ? text.slice(0, boundary) : text
  return body.replace(guardianCardLine, "").trimEnd()
}

function extractArticle(data, link) {
  const rawTitle = typeof data.title === "string" ? data.title.replace(/\s+/g, " ").trim() : ""
  const title = accessTitle.test(rawTitle) ? "" : rawTitle.slice(0, 240)
  const article = { title, source: link.source, url: link.url, text: "" }
  const metadata = data.metadata ?? {}
  const tier = metadata["article:content_tier"] ?? metadata.article_content_tier
  const resolvedUrl = data.finalUrl || data.url || link.publicUrl
  let resolvedSource
  try {
    resolvedSource = identifyArticleLink(resolvedUrl).source
  } catch {
    return { article, error: unavailable }
  }
  if (resolvedSource !== link.source || !title || Number(data.httpStatus) >= 400
    || restrictedTier.test(tier) || String(metadata.isaccessibleforfree ?? metadata.isAccessibleForFree) === "false") {
    return { article, error: unavailable }
  }
  if (metadata["og:type"] === "website" && !data.publishedTime) {
    return { article, error: "这个地址看起来是栏目页，请粘贴具体文章的链接。" }
  }

  const content = typeof data.content === "string" ? data.content : ""
  const lines = content.split(/\r?\n/).map(plainLine).filter(Boolean)
  if (lines.some(line => accessNotice.test(line))) return { article, error: unavailable }

  const paragraphs = []
  for (const line of cleanPublisherText(lines.join("\n"), link.source).split("\n")) {
    if (paragraphs.length && footerHeading.test(line)) break
    if (line !== rawTitle && !/^[-*_]{3,}$/.test(line)) paragraphs.push(line)
  }
  const text = paragraphs.join("\n\n")
  if (text.split(/\s+/).length < 70) return { article, error: unavailable }
  return { article: { ...article, text } }
}

export async function fetchPublicArticle(link, signal) {
  const headers = { Accept: "application/json", "X-Respond-With": "readability" }
  if (link.source === "The Guardian" && /^\/[^/]+\/\d{4}\//.test(new URL(link.publicUrl).pathname)) {
    headers["X-Respond-With"] = "markdown"
    headers["X-Target-Selector"] = guardianBodyBlocks
  }
  let response
  try {
    response = await fetch(`https://r.jina.ai/${link.publicUrl}`, {
      headers,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal
    })
  } catch {
    throw new Error("暂时无法连接文章读取服务。可以重试或粘贴正文。")
  }
  if (response.status === 429) throw new Error("文章读取服务暂时繁忙。可以稍后重试或粘贴正文。")
  const payload = await response.json().catch(() => null)
  if (response.status === 403 && payload?.name === "AbuseAlleviationError") {
    throw new Error("读取服务暂时限制了该网站的匿名读取。可以稍后重试，或打开原文后粘贴正文。")
  }
  if ([401, 403, 404, 451].includes(response.status)) throw new Error(unavailable)
  if (!response.ok) throw new Error("文章读取服务暂时不可用。可以重试或粘贴正文。")
  if (!payload?.data) throw new Error("这个链接没有返回可读取的文章。请核对地址或粘贴正文。")
  return extractArticle(payload.data, link)
}
