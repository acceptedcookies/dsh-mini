/** Unified markdown renderer for `rich-text`; generated HTML is escaped first.
 *  管线: normalize(抖动纠错) → fence 切分 → block 解析(表格/标题/列表/引用/hr)
 *  → segment(html|code|table)。inline 用顺序 tokenizer——链式正则会互相
 *  误伤且无法表达侧翼规则(`_` 不得入侵 file_list 类词)。 */

export type MarkdownTheme = 'light' | 'dark'

const TOKEN = '\u0000'

interface Palette {
  text: string
  secondary: string
  tertiary: string
  border: string
  link: string
  codeBg: string
  codeBanner: string
  codeText: string
  inlineBg: string
  tableHeadBg: string
  tableRowAlt: string
}

function palette(theme: MarkdownTheme): Palette {
  return theme === 'dark'
    ? {
        text: '#f9fafb',
        secondary: '#cfd3d6',
        tertiary: '#81858c',
        border: 'rgba(255,255,255,0.12)',
        link: '#7aaaff',
        codeBg: '#1b1b1c',
        codeBanner: '#232324',
        codeText: '#e6e6e6',
        inlineBg: '#2c2c2e',
        tableHeadBg: '#232324',
        tableRowAlt: 'rgba(255,255,255,0.03)',
      }
    : {
        text: '#0f1115',
        secondary: '#61666b',
        tertiary: '#81858c',
        border: 'rgba(0,0,0,0.1)',
        link: '#4176e6',
        codeBg: '#f9fafb',
        codeBanner: '#f9fafb',
        codeText: '#0f1115',
        inlineBg: '#fafafa',
        tableHeadBg: '#f9fafb',
        tableRowAlt: 'rgba(0,0,0,0.02)',
      }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── LLM 抖动纠错（line-level normalize）─────────────────────────────────

/** 行内未转义管道数（去行内代码段后计数——`a | b` 语法说明不算表格）。 */
function pipeCount(line: string): number {
  const noCode = line.replace(/`[^`]*`/g, '')
  let n = 0
  for (let i = 0; i < noCode.length; i += 1) {
    if (noCode[i] === '|' && noCode[i - 1] !== '\\') n += 1
  }
  return n
}

function isPipeRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && pipeCount(t) >= 2
}

/** 胶合表格行 `| a | b ||---|---|---|` → 逐 `||` 切行。仅在切出
 *  分隔行或全部候选仍是管行时才认——`| a || b |`（空格元组）不误劈。
 *  手动扫描 `\|` 转义不切（`\||` 是转义管+真管）。 */
function unglueTableRows(line: string): string[] {
  if (!isPipeRow(line) || !line.includes('||')) return [line]
  const raw: string[] = []
  let start = 0
  for (let i = 0; i + 1 < line.length; i += 1) {
    if (line[i] === '|' && line[i + 1] === '|' && line[i - 1] !== '\\') {
      raw.push(line.slice(start, i))
      start = i + 1
      i += 1
    }
  }
  if (raw.length === 0) return [line]
  raw.push(line.slice(start))
  const parts = raw.map((part) => {
    let s = part
    if (!s.startsWith('|')) s = `|${s}`
    if (!s.endsWith('|')) s = `${s}|`
    return s
  })
  // 只认「切出分隔行」或「≥3 段全管行」——`| a || b |` 空单元格（2 段）不劈。
  const sep = parts.some((l) => isSeparatorCells(splitRowCells(l)))
  const allRows = parts.length >= 3 && parts.every((l) => isPipeRow(l))
  return sep || allRows ? parts : [line]
}

function splitRowCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  // \| 转义在切列层面兑现——cell 内再 restore
  const cells = t.replace(/\\\|/g, '\u0001PIPE').split('|')
  return cells.map((c) => c.replace(/\u0001PIPE/g, '|').trim())
}

function isSeparatorCells(cells: string[]): boolean {
  return cells.length >= 1 && cells.every((c) => /^:?-{1,}:?$|^:?=+:?$/.test(c.trim()))
}

/** 全行 normalize——只在 fence 外逐行跑。 */
function normalizeMarkdown(src: string): string {
  const out: string[] = []
  let inFence = false
  for (const raw of src.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      out.push(raw)
      continue
    }
    if (inFence) {
      out.push(raw)
      continue
    }
    let line = raw
    // 全角管道 ｜——管行密集时归一（普通文本不动）
    if (line.includes('｜') && (line.match(/｜/g) ?? []).length >= 2) line = line.replace(/｜/g, '|')
    // 异体列表符号归一 • · ◦ ‣ – — 行首 → '- '
    line = line.replace(/^(\s*)[•·◦‣–—]\s+/, '$1- ')
    // ATX 无空格 `##Title` → `## Title`（`#tag` 单 # 不修——标签语义高频）
    line = line.replace(/^(#{2,6})(?![#\s])([^\s#])/, '$1 $2')
    // 有序变体 `1)` → `1.`
    line = line.replace(/^(\s*)(\d+)\)\s+/, '$1$2. ')
    // 胶合表格行
    const parts = unglueTableRows(line)
    out.push(...parts)
  }
  let text = out.join('\n')
  // 未闭合强调尾——流式文本 `**bold` 奇数标记在末尾补关。只数 fence 外
  // 与行内代码外的标记（`a**b` 代码内容不触发误补）。
  const plain = out
    .filter((_l, i) => {
      let fence = false
      for (let k = 0; k <= i; k += 1) {
        if (/^\s*(```|~~~)/.test(out[k] ?? '')) fence = !fence
      }
      return !fence
    })
    .join('\n')
    .replace(/`[^`]*`/g, '')
  for (const mark of ['**', '~~']) {
    const count = plain.split(mark).length - 1
    if (count % 2 === 1) text = `${text}${mark}`
  }
  return text
}

// ── inline 渲染（顺序 tokenizer + 侧翼规则）────────────────────────────

function isAlnum(c: string): boolean {
  return /[A-Za-z0-9_一-鿿]/.test(c)
}

/** `*`/`~` 侧翼：开=右侧非空，闭=左侧非空。`_`/`__` 更严——两侧都不得贴
 *  字母数字（防 file_list / __init__ 被吃掉）。 */
function canOpen(text: string, pos: number, len: number, strict: boolean): boolean {
  const next = text[pos + len]
  if (next === undefined || /\s/.test(next)) return false
  if (strict && pos > 0 && isAlnum(text[pos - 1] ?? '')) return false
  return true
}

function canClose(text: string, pos: number, len: number, strict: boolean): boolean {
  const prev = text[pos - 1]
  if (prev === undefined || /\s/.test(prev)) return false
  if (strict && isAlnum(text[pos + len] ?? '')) return false
  return true
}

/** 从内向外解 `***x***`/`**x**`/`*x*`/`~~x~~`/`__x__`/`_x_`。
 *  找不到合法闭号时原样吐标记（不吞字）。 */
function renderEmphasis(text: string, p: Palette, stash: (html: string) => string): string {
  const marks: Array<{ mark: string; open: string; close: string; strict: boolean }> = [
    { mark: '***', open: '<strong><em>', close: '</em></strong>', strict: false },
    { mark: '**', open: `<strong style="font-weight:600;color:${p.text};">`, close: '</strong>', strict: false },
    { mark: '~~', open: '<del>', close: '</del>', strict: false },
    { mark: '__', open: `<strong style="font-weight:600;color:${p.text};">`, close: '</strong>', strict: true },
    { mark: '*', open: '<em>', close: '</em>', strict: false },
    { mark: '_', open: '<em>', close: '</em>', strict: true },
  ]
  const tokenChar = /[*_~]/
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (!tokenChar.test(ch)) {
      // 快进到下一个标记字符
      const next = text.slice(i).search(tokenChar)
      out += next === -1 ? text.slice(i) : text.slice(i, i + next)
      i = next === -1 ? text.length : i + next
      continue
    }
    const def = marks.find((m) => text.startsWith(m.mark, i))
    if (def === undefined || !canOpen(text, i, def.mark.length, def.strict)) {
      out += ch
      i += 1
      continue
    }
    // 找最近的合法闭号
    let j = i + def.mark.length
    let closed = -1
    while (j < text.length) {
      const at = text.indexOf(def.mark, j)
      if (at === -1) break
      if (canClose(text, at, def.mark.length, def.strict)) {
        closed = at
        break
      }
      j = at + def.mark.length
    }
    if (closed === -1 || closed === i + def.mark.length) {
      out += def.mark
      i += def.mark.length
      continue
    }
    const rawInner = text.slice(i + def.mark.length, closed)
    // `_`/`__` 且内文是标识符形态（__init__、_private）→ 字面量。
    // LLM 强调几乎只用 **/*，dunder 词远比 _em_ 高频。
    if (def.strict && /^[A-Za-z0-9_$]+$/.test(rawInner)) {
      out += `${def.mark}${rawInner}${def.mark}`
      i = closed + def.mark.length
      continue
    }
    const inner = renderEmphasis(rawInner, p, stash)
    out += `${def.open}${inner}${def.close}`
    i = closed + def.mark.length
  }
  return out
}

function renderInline(value: string, p: Palette): string {
  // 1) 转义序列 → 占位（`\|` `\*` 等不产标记字符）
  const stashed: string[] = []
  const stash = (html: string): string => {
    const t = `${TOKEN}${stashed.length}${TOKEN}`
    stashed.push(html)
    return t
  }
  let text = escapeHtml(value)
  text = text.replace(/\\([\\`*_\[\]|~!])/g, (_m, c: string) => stash(escapeHtml(c)))

  // 2) 代码段 `x` ``x`y`` → 占位
  text = text.replace(/(`+)([^`]+?)\1/g, (_m, _ticks: string, code: string) =>
    stash(`<code style="background:${p.inlineBg};color:${p.text};padding:1px 5px;border-radius:4px;font-family:Menlo,monospace;font-size:12px;">${code}</code>`))

  // 3) 图片/链接 → 占位
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_m, alt: string, src: string) =>
    stash(`<img alt="${alt}" src="${src}" style="max-width:100%;border-radius:8px;display:block;margin:8px 0;" />`))
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, href: string) =>
    stash(`<a style="color:${p.link};text-decoration:none;" href="${href}">${label}</a>`))
  text = text.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>"')\]]+)/g, (_m, pre: string, url: string) => {
    const clean = url.replace(/[.,;:!?]+$/, '')
    return `${pre}${stash(`<a style="color:${p.link};text-decoration:none;" href="${clean}">${clean}</a>`)}`
  })

  // 4) 强调（占位符内部无标记字符——tokenizer 看不到 stash 内的东西）
  text = renderEmphasis(text, p, stash)

  // 5) 占位恢复（stash 内容可能互相嵌套——按序多轮还原）
  for (let round = 0; round < 3; round += 1) {
    let changed = false
    text = text.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => {
      const v = stashed[Number(idx)]
      if (v === undefined) return _m
      changed = true
      return v
    })
    if (!changed) break
  }
  return text
}

// ── block 解析 ──────────────────────────────────────────────────────────

type Align = 'left' | 'center' | 'right'

interface TableBlock {
  header: string[] | undefined
  aligns: Align[]
  rows: string[][]
}

function alignsFromSeparator(cells: string[], cols: number): Align[] {
  const out: Align[] = []
  for (let i = 0; i < cols; i += 1) {
    const c = (cells[i] ?? '').trim()
    out.push(c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left')
  }
  return out
}

/** 连续管行组块：有分隔行→header+body；无分隔但 ≥2 行等宽 ≥2 列→全 body 宽松表。 */
function takeTable(lines: string[], start: number): { block: TableBlock; next: number } | undefined {
  let end = start
  while (end < lines.length && isPipeRow(lines[end] ?? '')) end += 1
  if (end - start < 2) return undefined
  const rows = lines.slice(start, end).map(splitRowCells)
  const sepIdx = rows.findIndex(isSeparatorCells)
  if (sepIdx === -1) {
    // 缺分隔行（LLM 高频抖动）：≥3 行等宽 ≥2 列 → 首行升格表头
    const cols = rows[0]?.length ?? 0
    const uniform = cols >= 2 && rows.length >= 3 && rows.every((r) => r.length === cols)
    if (!uniform) return undefined
    const header = rows[0]!
    return {
      block: { header, aligns: header.map(() => 'left' as Align), rows: rows.slice(1) },
      next: end,
    }
  }
  if (sepIdx === 0 || sepIdx > 1) return undefined
  const header = rows[0]!
  const cols = header.length
  const body = rows.slice(2).filter((r) => r.length > 0)
  return {
    block: { header, aligns: alignsFromSeparator(rows[1]!, cols), rows: body.map((r) => r.slice(0, cols)) },
    next: end,
  }
}

function renderCode(language: string, code: string, p: Palette): string {
  const label = language.length > 0
    ? `<div style="padding:6px 12px;color:${p.tertiary};font-size:11px;line-height:16px;background:${p.codeBanner};border-bottom:0.5px solid ${p.border};font-family:Menlo,monospace;">${escapeHtml(language)}</div>`
    : ''
  return `<div style="margin:0 0 16px;border:0.5px solid ${p.border};border-radius:8px;overflow:hidden;background:${p.codeBg};color:${p.codeText};">${label}<div style="margin:0;padding:12px;overflow-x:auto;white-space:pre-wrap;font-family:Menlo,monospace;font-size:12px;line-height:18px;"><code>${escapeHtml(code)}</code></div></div>`
}

function tableToHtml(block: TableBlock, p: Palette): string {
  const cellStyle = `padding:8px 12px;border-bottom:0.5px solid ${p.border};font-size:13px;line-height:20px;`
  const th = block.header === undefined
    ? ''
    : `<tr>${block.header.map((c, i) => `<th style="${cellStyle}font-weight:600;text-align:${block.aligns[i] ?? 'left'};background:${p.tableHeadBg};white-space:nowrap;">${renderInline(c, p)}</th>`).join('')}</tr>`
  const body = block.rows.map((r, ri) =>
    `<tr style="${ri % 2 === 1 ? `background:${p.tableRowAlt};` : ''}">${r.map((c, i) => `<td style="${cellStyle}text-align:${block.aligns[i] ?? 'left'};">${renderInline(c, p)}</td>`).join('')}</tr>`).join('')
  return `<table style="margin:0 0 16px;border-collapse:collapse;color:${p.text};width:auto;max-width:100%;">${th}${body}</table>`
}

interface ParsedBlock {
  kind: 'html' | 'table'
  html?: string
  table?: TableBlock
}

function parseBlocks(lines: string[], p: Palette): ParsedBlock[] {
  const out: ParsedBlock[] = []
  let htmlBuf: string[] = []
  const flushHtml = () => {
    if (htmlBuf.length > 0) out.push({ kind: 'html', html: htmlBuf.join('') })
    htmlBuf = []
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      index += 1
      continue
    }

    // 表格（含宽松表）——先于段落
    if (isPipeRow(line)) {
      const taken = takeTable(lines, index)
      if (taken !== undefined) {
        flushHtml()
        out.push({ kind: 'table', table: taken.block })
        index = taken.next
        continue
      }
      // 管行不构成表（孤立管行/碎表残段）——原文照排不吞字
    }

    // hr：--- *** ___ ＊＊＊ ———（≥3）
    if (/^\s*([-*_＊—]\s*){3,}$/.test(line) || /^\s*(?:-{3,}|—{3,})\s*$/.test(line)) {
      htmlBuf.push(`<hr style="margin:0 0 16px;border:none;border-top:1px solid ${p.border};" />`)
      index += 1
      continue
    }

    // 标题（normalize 已修无空格变体；#text 单字 tag 不算）
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      const size = [21, 19, 18, 15, 14, 14][level - 1] ?? 14
      const weight = level <= 3 ? 700 : 600
      const leading = [30, 28, 26, 24, 24, 24][level - 1] ?? 24
      htmlBuf.push(`<h${level} style="margin:0 0 12px;color:${p.text};font-size:${size}px;line-height:${leading}px;font-weight:${weight};">${renderInline(heading[2] ?? '', p)}</h${level}>`)
      index += 1
      continue
    }

    // 引用（支持 `>>` 嵌套——按最深级渲染单边框，多级同构）
    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      htmlBuf.push(`<blockquote style="margin:0 0 16px;padding:0 0 0 12px;border-left:2px solid ${p.border};color:${p.secondary};">${renderInline(quote.join(' '), p)}</blockquote>`)
      continue
    }

    // 任务/无序/有序列表（单层嵌套：缩进 ≥2 归并到前项的子 ul/ol）
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (listMatch !== null) {
      type Item = { ordered: boolean; text: string; task?: boolean; done?: boolean; kids: Item[] }
      const items: Item[] = []
      let current: Item | undefined
      while (index < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index] ?? '')
        if (m === null) break
        const indent = (m[1] ?? '').length
        const bullet = m[2] ?? '-'
        let body = m[3] ?? ''
        let task: boolean | undefined
        let done: boolean | undefined
        const cb = /^\[([ xX])\]\s+/.exec(body)
        if (cb !== null) {
          task = true
          done = cb[1] !== ' '
          body = body.slice(cb[0].length)
        }
        const item: Item = { ordered: /\d/.test(bullet), text: body, task, done, kids: [] }
        // 混合列表（- 后接 1.）断开另起——不把有序项并进 ul 丢序号
        if (indent < 2 && items.length > 0 && item.ordered !== items[0]!.ordered) break
        if (indent >= 2 && current !== undefined) current.kids.push(item)
        else {
          items.push(item)
          current = item
        }
        index += 1
      }
      const renderItems = (list: Item[], ordered: boolean): string => {
        const tag = ordered ? 'ol' : 'ul'
        const lis = list.map((it) => {
          const glyph = it.task === true ? (it.done ? '☑ ' : '☐ ') : ''
          const kids = it.kids.length > 0 ? renderItems(it.kids, it.kids[0]!.ordered) : ''
          return `<li style="margin:2px 0;">${glyph}${renderInline(it.text, p)}${kids}</li>`
        }).join('')
        return `<${tag} style="margin:0 0 ${ordered ? 16 : 16}px;padding-left:24px;color:${p.text};">${lis}</${tag}>`
      }
      htmlBuf.push(renderItems(items, items[0]!.ordered))
      continue
    }

    // 段落——遇新块起始符即断
    const para: string[] = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      const nt = next.trim()
      if (nt.length === 0
        || /^(#{1,6})\s+/.test(next)
        || /^[-*+]\s+/.test(next)
        || /^\d+[.)]\s+/.test(next)
        || /^\s*>/.test(next)
        || isPipeRow(next)
        || /^\s*([-*_＊—]\s*){3,}$/.test(next)) break
      para.push(next)
      index += 1
    }
    htmlBuf.push(`<p style="margin:0 0 16px;color:${p.text};font-size:14px;line-height:24px;">${para.map((l) => renderInline(l, p)).join('<br/>')}</p>`)
  }
  flushHtml()
  return out
}

// ── 对外面 ──────────────────────────────────────────────────────────────

/** One renderable slice of an assistant message: sanitized `rich-text` HTML,
 *  a fenced code block drawn with the dsh toolbar, or a table with native
 *  scroll/styling. Cells carry pre-rendered inline HTML. */
export interface MarkdownSegment {
  kind: 'html' | 'code' | 'table'
  html?: string
  lang?: string
  code?: string
  wrap?: boolean
  /** 表格段：表头行（cellHtml），缺失=宽松表全 body。 */
  header?: string[]
  aligns?: Align[]
  rows?: string[][]
  /** 原生表格段的 rich-text 兜底（同结构 html）。 */
  tableHtml?: string
}

/** Split markdown at fenced code blocks and tables so each can carry native chrome. */
export function markdownSegments(markdown: string, theme: MarkdownTheme = 'light'): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  const normalized = normalizeMarkdown(markdown)
  const p = palette(theme)
  // fence 切分：``` 与 ~~~；未闭合栅栏→到文末皆为 code（流式抖动容错）
  // 行首锚定——段内裸 ``` 不判为 fence；闭栏同样须行首
  const fence = /(^|\n)[ \t]{0,3}(```|~~~)([A-Za-z0-9_+.-]*)[^\S\r\n]*\r?\n?([\s\S]*?)(?:\n[ \t]{0,3}\2[^\S\r\n]*(?=\n|$)|$)/g
  let cursor = 0
  let match: RegExpExecArray | null
  const emitText = (chunk: string) => {
    if (chunk.trim().length === 0) return
    for (const b of parseBlocks(chunk.split(/\r?\n/), p)) {
      if (b.kind === 'html') segments.push({ kind: 'html', html: b.html })
      else segments.push({
        kind: 'table',
        header: b.table!.header?.map((c) => renderInline(c, p)),
        aligns: b.table!.aligns,
        rows: b.table!.rows.map((r) => r.map((c) => renderInline(c, p))),
        tableHtml: tableToHtml(b.table!, p),
      })
    }
  }
  while ((match = fence.exec(normalized)) !== null) {
    emitText(normalized.slice(cursor, match.index))
    segments.push({
      kind: 'code',
      lang: ((match[3] ?? '').trim().split(/\s+/)[0]) ?? '',
      code: (match[4] ?? '').replace(/\n$/, ''),
    })
    cursor = match.index + match[0].length
  }
  emitText(normalized.slice(cursor))
  return segments
}

/** Convert a complete assistant message to sanitized HTML for `rich-text`. */
export function markdownToHtml(markdown: string, theme: MarkdownTheme = 'light'): string {
  if (markdown.trim().length === 0) return ''
  const parts: string[] = []
  for (const seg of markdownSegments(markdown, theme)) {
    if (seg.kind === 'html') parts.push(seg.html ?? '')
    else if (seg.kind === 'code') parts.push(renderCode(seg.lang ?? '', seg.code ?? '', palette(theme)))
    else parts.push(seg.tableHtml ?? '')
  }
  return parts.join('')
}

/** Strip markdown punctuation for session-list previews. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '[代码]')
    .replace(/~~~[\s\S]*?~~~/g, '[代码]')
    .replace(/[#>*_`\[\]()|~=-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
