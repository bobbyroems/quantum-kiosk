export function splitTextForReveal(element, { mode = 'words', startIndex = 0 } = {}) {
  if (!element || element.dataset.revealSplit) return startIndex
  const text = element.textContent.replace(/\s+/g, ' ').trim()
  element.textContent = ''
  element.dataset.revealSplit = mode
  let index = startIndex
  const fragment = document.createDocumentFragment()

  if (mode === 'chars') {
    for (const char of text) {
      if (char === ' ') {
        fragment.append(' ')
        continue
      }
      const span = document.createElement('span')
      span.className = 'reveal-char'
      span.textContent = char
      span.style.setProperty('--char-index', index)
      fragment.append(span)
      index += 1
    }
  } else {
    const words = text.split(' ').filter(Boolean)
    words.forEach((word, wordPosition) => {
      const mask = document.createElement('span')
      mask.className = 'reveal-word'
      const inner = document.createElement('span')
      inner.className = 'reveal-word__inner'
      inner.textContent = word
      inner.style.setProperty('--word-index', index)
      mask.append(inner)
      fragment.append(mask)
      if (wordPosition < words.length - 1) fragment.append(' ')
      index += 1
    })
  }

  element.append(fragment)
  return index
}
