const letters = "ABCD"
const editor = document.querySelector("#quiz-editor")
const editorList = editor.querySelector("[data-quiz-editor-list]")
const addButton = editor.querySelector("[data-quiz-add]")

function numberQuestions() {
  Array.from(editorList.children).forEach((question, index) => {
    question.querySelector("strong").textContent = `第 ${index + 1} 题`
    question.querySelector("[data-quiz-remove]").setAttribute("aria-label", `移除第 ${index + 1} 题`)
  })
}

function appendQuestion({ prompt, options, answer } = { prompt: "", options: [], answer: -1 }) {
  const question = document.querySelector("#quiz-editor-question").content.firstElementChild.cloneNode(true)
  const optionTemplate = document.querySelector("#quiz-editor-option")
  const fields = question.querySelector("fieldset")
  const group = `answer-${crypto.randomUUID()}`
  question.querySelector("[data-quiz-prompt]").value = prompt
  Array.from(letters).forEach((letter, index) => {
    const row = optionTemplate.content.cloneNode(true)
    const radio = row.querySelector('[type="radio"]')
    const input = row.querySelector('[type="text"]')
    radio.name = group
    radio.checked = index === answer
    radio.setAttribute("aria-label", `将 ${letter} 设为正确答案`)
    input.setAttribute("aria-label", `选项 ${letter}`)
    row.querySelector(".quiz-option-letter").textContent = letter
    if (index > 1) input.placeholder = "可选"
    input.value = options[index] ?? ""
    fields.append(row)
  })
  editorList.append(question)
  return question
}

addButton.addEventListener("click", () => {
  const question = appendQuestion()
  numberQuestions()
  question.querySelector("[data-quiz-prompt]").focus()
})

editorList.addEventListener("click", event => {
  const remove = event.target.closest("[data-quiz-remove]")
  if (!remove) return
  const question = remove.closest(".quiz-editor-question")
  const next = question.nextElementSibling
  question.remove()
  numberQuestions()
  const focusTarget = next?.querySelector("[data-quiz-prompt]") ?? addButton
  focusTarget.focus()
})

export function setQuizEditor(quiz = [], open = false) {
  editorList.replaceChildren()
  for (const question of quiz) appendQuestion(question)
  numberQuestions()
  editor.open = open || quiz.length > 0
  return quiz.length ? editor.querySelector("summary") : addButton
}

function questionError(input, message) {
  editor.open = true
  input.focus()
  throw new Error(message)
}

export function readQuizEditor() {
  return Array.from(editorList.children).map((question, index) => {
    const promptInput = question.querySelector("[data-quiz-prompt]")
    const optionInputs = Array.from(question.querySelectorAll('fieldset input[type="text"]'))
    const radios = Array.from(question.querySelectorAll('input[type="radio"]'))
    const prompt = promptInput.value.trim()
    const options = optionInputs.map(input => input.value.trim())
    const answer = radios.findIndex(radio => radio.checked)
    const prefix = `第 ${index + 1} 题`
    if (!prompt) questionError(promptInput, `请填写${prefix}的题目。`)
    const missing = options.findIndex((option, i) => !option && (i < 2 || options.slice(i + 1).some(Boolean)))
    if (missing >= 0) questionError(optionInputs[missing], `请填写${prefix}的选项 ${letters[missing]}。`)
    if (answer < 0) questionError(radios[0], `请标记${prefix}的正确答案。`)
    if (!options[answer]) questionError(optionInputs[answer], `请填写${prefix}标为正确答案的选项。`)
    return { prompt, options: options.filter(Boolean), answer }
  })
}

function renderQuestion({ prompt, options }, index) {
  const question = document.createElement("fieldset")
  const legend = document.createElement("legend")
  legend.dir = "auto"
  legend.textContent = `${index + 1}. ${prompt}`
  question.append(legend)
  options.forEach((option, optionIndex) => {
    const row = document.createElement("label")
    const radio = document.createElement("input")
    const letter = document.createElement("span")
    const text = document.createElement("span")
    const feedback = document.createElement("small")
    row.className = "quiz-option"
    radio.type = "radio"
    radio.name = `question-${index}`
    radio.value = optionIndex
    letter.className = "quiz-option-letter"
    letter.textContent = letters[optionIndex]
    text.dir = "auto"
    text.textContent = option
    row.append(radio, letter, text, feedback)
    question.append(row)
  })
  return question
}

export function showQuiz(panel, quiz = []) {
  const form = panel.querySelector(".quiz-form")
  const result = form.querySelector("[data-quiz-result]")
  const submit = form.querySelector('[type="submit"]')
  const reset = form.querySelector('[type="reset"]')
  const questions = quiz.map(renderQuestion)
  panel.querySelector("[data-quiz-count]").textContent = quiz.length ? `${quiz.length} 题` : "暂无题目"
  panel.querySelector("[data-action=edit-quiz]").textContent = quiz.length ? "编辑题目" : "添加题目"
  form.hidden = !quiz.length
  form.querySelector("[data-quiz-questions]").append(...questions)
  panel.hidden = false

  form.addEventListener("submit", event => {
    event.preventDefault()
    if (submit.hidden) return
    const choices = questions.map(question => question.querySelector(":checked"))
    const missing = choices.indexOf(null)
    if (missing >= 0) {
      result.textContent = `请先完成第 ${missing + 1} 题。`
      result.dataset.state = "error"
      questions[missing].querySelector("input").focus()
      return
    }

    let score = 0
    questions.forEach((question, index) => {
      const answer = quiz[index].answer
      const correct = Number(choices[index].value) === answer
      if (correct) score += 1
      const rows = question.querySelectorAll(".quiz-option")
      rows[answer].dataset.result = "correct"
      rows[answer].querySelector("small").textContent = correct ? "✓ 回答正确" : "✓ 正确答案"
      if (!correct) {
        const selected = choices[index].closest("label")
        selected.dataset.result = "incorrect"
        selected.querySelector("small").textContent = "× 回答错误"
      }
      question.disabled = true
    })
    const perfection = score === quiz.length ? " · 全部正确！" : ""
    result.textContent = `答对 ${score} / ${quiz.length} 题${perfection}`
    result.dataset.state = "graded"
    submit.hidden = true
    reset.hidden = false
    reset.focus({ preventScroll: true })
  })

  form.addEventListener("change", () => {
    result.textContent = ""
    delete result.dataset.state
  })

  form.addEventListener("reset", () => {
    for (const question of questions) question.disabled = false
    for (const row of form.querySelectorAll("[data-result]")) {
      delete row.dataset.result
      row.querySelector("small").textContent = ""
    }
    result.textContent = ""
    delete result.dataset.state
    submit.hidden = false
    reset.hidden = true
    form.querySelector("input")?.focus()
  })
}
