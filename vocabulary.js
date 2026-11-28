const sentenceSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("en", { granularity: "sentence" }) : undefined

function selectedWord(content, paragraphs) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  const node = range.startContainer
  const paragraphNode = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("p")
  if (paragraphNode?.parentElement !== content || !paragraphNode.contains(range.endContainer)) return

  const selected = range.toString()
  const word = selected.trim()
  if (!/\p{L}/u.test(word) || word.length > 120) return
  const prefix = document.createRange()
  prefix.selectNodeContents(paragraphNode)
  prefix.setEnd(node, range.startOffset)
  const paragraph = [...content.children].indexOf(paragraphNode)
  const start = prefix.toString().length + selected.length - selected.trimStart().length
  const text = paragraphs[paragraph]
  const sentences = sentenceSegmenter?.segment(text)
  const first = sentences?.containing(start)
  const last = sentences?.containing(start + word.length - 1)
  const sentenceStart = first?.index ?? 0
  const sentenceEnd = last ? last.index + last.segment.trimEnd().length : text.length
  return { word, paragraph, start, sentence: text.slice(sentenceStart, sentenceEnd), offset: start - sentenceStart }
}

function locateMark(mark, paragraphs) {
  const sentenceStart = mark.start - mark.offset
  if (paragraphs[mark.paragraph]?.startsWith(mark.sentence, sentenceStart)) {
    return { paragraph: mark.paragraph, start: mark.start }
  }

  // Reattach after an edit only if the original context has a single match.
  let position
  for (const [paragraph, text] of paragraphs.entries()) {
    const found = text.indexOf(mark.sentence)
    if (found === -1) continue
    if (position || text.indexOf(mark.sentence, found + 1) !== -1) return
    position = { paragraph, start: found + mark.offset }
  }
  return position
}

export function showVocabulary(reader, paragraphs, initialMarks, persist, notify, updateProgress) {
  const controller = new AbortController()
  const content = reader.querySelector("[data-article-text]")
  const panel = reader.querySelector(".article-vocabulary")
  const list = panel.querySelector("[data-vocabulary-list]")
  const selectButton = reader.querySelector("[data-vocabulary-select]")
  const dialog = reader.querySelector(".vocabulary-dialog")
  const meaning = dialog.querySelector("[name=meaning]")
  const error = dialog.querySelector("[role=alert]")
  const removeButton = dialog.querySelector("[data-vocabulary-remove]")
  const anchors = new Map()
  const editButtons = new Map()
  let marks = initialMarks
  let selection
  let editing
  let saving = false

  function editMark(mark, fromList = false) {
    editing = { id: mark.id, fromList }
    meaning.value = mark.meaning
    error.hidden = true
    dialog.querySelector("[data-vocabulary-word]").textContent = mark.word
    dialog.showModal()
  }

  function renderMarks() {
    anchors.clear()
    editButtons.clear()
    const byParagraph = paragraphs.map(() => [])
    for (const mark of marks) {
      const position = locateMark(mark, paragraphs)
      if (position) byParagraph[position.paragraph].push({ mark, start: position.start })
    }
    for (const [index, paragraph] of [...content.children].entries()) {
      const entries = byParagraph[index].sort((a, b) => a.start - b.start)
      if (!entries.length && !paragraph.childElementCount) continue
      const text = paragraphs[index]
      const fragment = document.createDocumentFragment()
      let cursor = 0
      for (const { mark, start } of entries) {
        if (start < cursor) continue
        const span = document.createElement("span")
        span.className = "vocabulary-mark"
        span.setAttribute("role", "button")
        span.tabIndex = 0
        span.dataset.markId = mark.id
        span.setAttribute("aria-label", `${mark.word}，编辑生词标记`)
        span.textContent = mark.word
        fragment.append(text.slice(cursor, start), span)
        anchors.set(mark.id, span)
        cursor = start + mark.word.length
      }
      fragment.append(text.slice(cursor))
      paragraph.replaceChildren(fragment)
    }

    panel.querySelector("[data-vocabulary-count]").textContent = marks.length ? `${marks.length} 条` : ""
    panel.querySelector("[data-vocabulary-empty]").hidden = marks.length > 0
    list.hidden = !marks.length
    const orderedMarks = [...anchors.keys(), ...marks.filter(mark => !anchors.has(mark.id)).map(mark => mark.id)]
    const byId = new Map(marks.map(mark => [mark.id, mark]))
    list.replaceChildren(...orderedMarks.map(id => {
      const mark = byId.get(id)
      const anchor = anchors.get(id)
      const row = document.createElement("li")
      const header = document.createElement("div")
      header.className = "vocabulary-row-heading"
      const term = document.createElement(anchor ? "button" : "strong")
      term.className = "vocabulary-term"
      term.dir = "auto"
      term.textContent = mark.word
      if (anchor) {
        term.type = "button"
        term.title = "跳回正文"
        term.addEventListener("click", () => {
          anchor.focus({ preventScroll: true })
          const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
          anchor.scrollIntoView({ behavior, block: "center" })
        })
      }
      const edit = document.createElement("button")
      edit.type = "button"
      edit.className = "vocabulary-edit"
      edit.textContent = "编辑"
      edit.setAttribute("aria-label", `编辑 ${mark.word}`)
      edit.addEventListener("click", () => editMark(mark, true))
      editButtons.set(id, edit)
      header.append(term, edit)
      row.append(header)
      if (mark.meaning) {
        const note = document.createElement("p")
        note.dir = "auto"
        note.textContent = mark.meaning
        row.append(note)
      }
      const sentence = document.createElement("p")
      sentence.className = "vocabulary-sentence"
      sentence.dir = "auto"
      const word = document.createElement("strong")
      word.textContent = mark.word
      sentence.append(mark.sentence.slice(0, mark.offset), word, mark.sentence.slice(mark.offset + mark.word.length))
      row.append(sentence)
      if (!anchor) {
        const status = document.createElement("small")
        status.textContent = "正文中找不到原句"
        row.append(status)
      }
      return row
    }))
    updateProgress()
  }

  async function save(change, id, fromList = false) {
    if (saving) return false
    saving = true
    const paragraph = anchors.get(id)?.parentElement
    selectButton.disabled = true
    for (const button of dialog.querySelectorAll("button")) button.disabled = true
    try {
      marks = await persist(change)
      if (controller.signal.aborted) return false
      if (dialog.open) dialog.close()
      renderMarks()
      if (fromList) (editButtons.get(id) ?? panel.querySelector("summary")).focus({ preventScroll: true })
      else if (anchors.has(id)) anchors.get(id).focus({ preventScroll: true })
      else if (paragraph) {
        paragraph.tabIndex = -1
        paragraph.focus({ preventScroll: true })
      }
      return true
    } catch {
      if (controller.signal.aborted) return false
      const message = "生词保存失败，请重试。"
      if (dialog.open) {
        error.textContent = message
        error.hidden = false
      } else notify(message)
      return false
    } finally {
      saving = false
      selectButton.disabled = false
      for (const button of dialog.querySelectorAll("button")) button.disabled = false
    }
  }

  document.addEventListener("selectionchange", () => {
    if (saving || dialog.open) return
    const next = selectedWord(content, paragraphs)
    if (!next && document.activeElement === selectButton) return
    selection = next
    selectButton.hidden = !selection
  }, { signal: controller.signal })
  selectButton.addEventListener("blur", () => {
    if (!selectedWord(content, paragraphs)) selectButton.hidden = true
  })
  selectButton.addEventListener("pointerdown", event => event.preventDefault())
  selectButton.addEventListener("click", async () => {
    if (!selection || saving) return
    const mark = { ...selection, id: crypto.randomUUID(), meaning: "" }
    selection = undefined
    selectButton.hidden = true
    window.getSelection()?.removeAllRanges()
    const saved = await save(current => {
      const overlaps = current.some(previous => {
        const position = locateMark(previous, paragraphs)
        return position && position.paragraph === mark.paragraph
          && position.start < mark.start + mark.word.length
          && mark.start < position.start + previous.word.length
      })
      return overlaps ? current : [...current, mark]
    }, mark.id)
    if (saved) notify(anchors.has(mark.id) ? "已标记生词" : "所选文字已有生词标记")
  })
  content.addEventListener("click", event => {
    const span = event.target.closest("[data-mark-id]")
    if (span && window.getSelection()?.isCollapsed) editMark(marks.find(mark => mark.id === span.dataset.markId))
  })
  content.addEventListener("keydown", event => {
    if (!event.target.matches("[data-mark-id]") || !["Enter", " "].includes(event.key)) return
    event.preventDefault()
    editMark(marks.find(mark => mark.id === event.target.dataset.markId))
  })
  dialog.addEventListener("cancel", event => {
    if (saving) event.preventDefault()
  })
  dialog.querySelector("form").addEventListener("submit", event => {
    event.preventDefault()
    const { id, fromList } = editing
    const note = meaning.value.trim()
    save(current => current.map(mark => mark.id === id ? { ...mark, meaning: note } : mark), id, fromList)
  })
  removeButton.addEventListener("click", async () => {
    const { id, fromList } = editing
    if (await save(current => current.filter(mark => mark.id !== id), id, fromList)) notify("已取消标记")
  })
  panel.hidden = false
  panel.addEventListener("toggle", updateProgress)
  renderMarks()
  return () => {
    controller.abort()
    if (dialog.open) dialog.close()
  }
}
