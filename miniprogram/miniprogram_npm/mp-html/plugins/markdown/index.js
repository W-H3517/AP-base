/**
 * @fileoverview markdown 插件
 * Include marked (https://github.com/markedjs/marked)
 * Include github-markdown-css (https://github.com/sindresorhus/github-markdown-css)
 */
const { marked } = require('./marked.min')
let index = 0
const FORMULA_TOKEN_PREFIX = 'MPHTMLFORMULATOKEN'

function protectFormulas (content) {
  const formulas = []
  let output = ''
  let i = 0

  while (i < content.length) {
    if (content[i] !== '$') {
      output += content[i]
      i += 1
      continue
    }

    const isBlock = content[i + 1] === '$'
    const delimiter = isBlock ? '$$' : '$'
    const start = i
    let cursor = i + delimiter.length
    let found = -1

    while (cursor < content.length) {
      if (content[cursor] === '\\') {
        cursor += 2
        continue
      }
      if (isBlock) {
        if (content[cursor] === '$' && content[cursor + 1] === '$') {
          found = cursor
          break
        }
      } else if (content[cursor] === '$') {
        found = cursor
        break
      }
      cursor += 1
    }

    if (found === -1) {
      output += content.slice(start)
      break
    }

    const formula = content.slice(start, found + delimiter.length)
    const token = `${FORMULA_TOKEN_PREFIX}${formulas.length}X`
    formulas.push(formula)
    output += token
    i = found + delimiter.length
  }

  return {
    content: output,
    formulas
  }
}

function restoreFormulas (content, formulas) {
  return content.replace(new RegExp(`${FORMULA_TOKEN_PREFIX}(\\d+)X`, 'g'), (_, formulaIndex) => {
    const index = Number(formulaIndex)
    return Number.isNaN(index) || typeof formulas[index] === 'undefined'
      ? _
      : formulas[index]
  })
}

function Markdown (vm) {
  this.vm = vm
  vm._ids = {}
}

Markdown.prototype.onUpdate = function (content) {
  if (this.vm.properties.markdown) {
    const protectedContent = protectFormulas(content)
    // 解决中文标点符号后粗体失效的问题，增加零宽空格
    content = protectedContent.content.replace(/\*\*([^*]+)\*\*([，。！？；：])/g, '**$1**&#8203;$2')
    return restoreFormulas(marked(content), protectedContent.formulas)
  }
}

Markdown.prototype.onParse = function (node, vm) {
  if (vm.options.markdown) {
    // 中文 id 需要转换，否则无法跳转
    if (vm.options.useAnchor && node.attrs && /[\u4e00-\u9fa5]/.test(node.attrs.id)) {
      const id = 't' + index++
      this.vm._ids[node.attrs.id] = id
      node.attrs.id = id
    }
    if (node.name === 'p' || node.name === 'table' || node.name === 'tr' || node.name === 'th' || node.name === 'td' || node.name === 'blockquote' || node.name === 'pre' || node.name === 'code') {
      node.attrs.class = `md-${node.name} ${node.attrs.class || ''}`
    }
  }
}

module.exports = Markdown
