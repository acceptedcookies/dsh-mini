/** Minimal markdown renderer for `rich-text`; generated HTML is escaped first. */

export type MarkdownTheme = 'light' | 'dark'

const CODE = '\u0000CODE'

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

function inline(value: string, p: Palette): string {
  let text = escapeHtml(value)
  const codes: string[] = []
  text = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `${CODE}${codes.length}\u0000`
    codes.push(`<code style="background:${p.inlineBg};color:${p.text};padding:1px 5px;border-radius:4px;font-family:Menlo,monospace;font-size:12px;">${code}</code>`)
    return token
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, `<strong style="font-weight:600;color:${p.text};">$1</strong>`)
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a style="color:${p.link};text-decoration:none;" href="$2">$1</a>`)
  for (let index = 0; index < codes.length; index += 1) {
    text = text.replace(`${CODE}${index}\u0000`, codes[index] ?? '')
  }
  return text
}

function renderCode(language: string, code: string, p: Palette): string {
  const label = language.length > 0
    ? `<div style="padding:6px 12px;color:${p.tertiary};font-size:11px;line-height:16px;background:${p.codeBanner};border-bottom:0.5px solid ${p.border};font-family:Menlo,monospace;">${escapeHtml(language)}</div>`
    : ''
  return `<div style="margin:0 0 16px;border:0.5px solid ${p.border};border-radius:8px;overflow:hidden;background:${p.codeBg};color:${p.codeText};">${label}<div style="margin:0;padding:12px;overflow-x:auto;white-space:pre-wrap;font-family:Menlo,monospace;font-size:12px;line-height:18px;"><code>${escapeHtml(code)}</code></div></div>`
}

function renderBlocks(lines: string[], p: Palette): string {
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) {
      index += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      const size = [21, 19, 18, 14, 14, 14][level - 1] ?? 14
      const weight = level <= 3 ? 700 : 600
      const leading = [30, 28, 26, 24, 24, 24][level - 1] ?? 24
      out.push(`<h${level} style="margin:0 0 12px;color:${p.text};font-size:${size}px;line-height:${leading}px;font-weight:${weight};">${inline(heading[2] ?? '', p)}</h${level}>`)
      index += 1
      continue
    }

    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('> ')) {
        quote.push((lines[index] ?? '').slice(2))
        index += 1
      }
      out.push(`<blockquote style="margin:0 0 16px;padding:0 0 0 12px;border-left:2px solid ${p.border};color:${p.secondary};">${inline(quote.join(' '), p)}</blockquote>`)
      continue
    }

    const unordered = /^[-*]\s+(.*)$/.exec(line)
    if (unordered !== null) {
      const items: string[] = []
      while (index < lines.length) {
        const match = /^[-*]\s+(.*)$/.exec(lines[index] ?? '')
        if (match === null) break
        items.push(`<li style="margin:2px 0;">${inline(match[1] ?? '', p)}</li>`)
        index += 1
      }
      out.push(`<ul style="margin:0 0 16px;padding-left:24px;color:${p.text};">${items.join('')}</ul>`)
      continue
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(line)
    if (ordered !== null) {
      const items: string[] = []
      while (index < lines.length) {
        const match = /^\d+\.\s+(.*)$/.exec(lines[index] ?? '')
        if (match === null) break
        items.push(`<li style="margin:2px 0;">${inline(match[1] ?? '', p)}</li>`)
        index += 1
      }
      out.push(`<ol style="margin:0 0 16px;padding-left:24px;color:${p.text};">${items.join('')}</ol>`)
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim().length === 0 || /^(#{1,6})\s+/.test(next) || /^[-*]\s+/.test(next) || /^\d+\.\s+/.test(next) || next.startsWith('> ')) break
      paragraph.push(next)
      index += 1
    }
    out.push(`<p style="margin:0 0 16px;color:${p.text};font-size:14px;line-height:24px;">${inline(paragraph.join(' '), p)}</p>`)
  }
  return out.join('')
}

/** Convert a complete assistant message to sanitized HTML for `rich-text`. */
export function markdownToHtml(markdown: string, theme: MarkdownTheme = 'light'): string {
  if (markdown.trim().length === 0) return ''
  const p = palette(theme)
  const blocks: string[] = []
  const withoutFences = markdown.replace(/```([A-Za-z0-9_+-]*)\n([\s\S]*?)```/g, (_match, language: string, code: string) => {
    const token = `${CODE}FENCE${blocks.length}\u0000`
    blocks.push(renderCode(language, code, p))
    return `\n${token}\n`
  })

  const lines = withoutFences.split(/\r?\n/)
  const html = renderBlocks(lines, p)
  let restored = html
  for (let index = 0; index < blocks.length; index += 1) {
    restored = restored.replace(`<p style="margin:0 0 16px;color:${p.text};font-size:14px;line-height:24px;">${CODE}FENCE${index}\u0000</p>`, blocks[index] ?? '')
    restored = restored.replace(`${CODE}FENCE${index}\u0000`, blocks[index] ?? '')
  }
  return restored
}

/** Strip markdown punctuation for session-list previews. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '[代码]')
    .replace(/[#>*_`\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
