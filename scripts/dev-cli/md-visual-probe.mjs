// md-visual-probe.mjs · markdown 渲染视觉验证（legacy，已收编 ProbeDriver）
// 注入分节 assistant 消息 → 逐条 scroll-into-view 定位 → 截图
import { ProbeDriver } from './lib/probe.mjs'

const ENDPOINT = process.env.MP_WS || 'ws://localhost:9602'
const HARD = setTimeout(() => { console.log(JSON.stringify({ result: 'fail' })); process.exit(2) }, 120000)
HARD.unref()

const SECTIONS = [
  [
    '##Markdown 渲染验收',
    '',
    '这是一段带 **加粗**、*斜体*、~~删除线~~ 与 `file_list` 行内代码的正文，',
    '工具名 `file_read`、`__init__` 不应被吃掉。链接 [DeepSeek](https://deepseek.com) 与裸链 https://example.com/path 都要蓝。',
    '',
    '| 工具 | 用途 | 状态 |',
    '|:---|:---:|---:|',
    '| file_read | 读取 vfs | ✓ |',
    '| file_write | 写入 vfs | ✓ |',
    '| file_list | 列目录 | ✓ |',
    '| a\\|b | 转义管道 | ✓ |',
  ].join('\n'),
  [
    '胶合表抖动修复（单行 || 劈开）:',
    '| 名称 | 路径 ||---|---|| root | / || data | /data |',
    '',
    '缺分隔行表（首行升表头）:',
    '| 甲 | 乙 |',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    '全角管表:',
    '｜名称｜路径｜',
    '｜---｜---｜',
    '｜root｜/｜',
    '｜data｜/data｜',
  ].join('\n'),
  [
    '```typescript',
    'const tools = [\'file_read\', \'file_list\']',
    'export async function run() { return tools.length }',
    '```',
    '',
    '> 引用块：模型给出的说明文字',
    '> 第二行引用',
    '',
    '---',
    '',
    '- [x] 表格渲染',
    '- [x] 抖动纠错',
    '- [ ] 截图确认',
    '• 异体圆点',
    '1) 有序变体',
    '',
    '###SubTitleNoSpace',
    '未闭合强调 **这是流式半截',
  ].join('\n'),
]

const d = await ProbeDriver.open({ via: 'automator', automatorOpts: { wsEndpoint: ENDPOINT } })
const mp = d.mp

const inject = await mp.evaluate((sections) => {
  const pages = getCurrentPages()
  const ws = pages[pages.length - 1]
  const items = ws.data.displayItems || []
  const base = Date.now()
  const added = sections.map((text, i) => ({
    id: `md-probe-${i}-${base}`,
    seq: items.length + i + 1,
    ts: base + i,
    kind: 'assistant_message',
    text,
    html: '',
  }))
  ws.setData({ displayItems: items.concat(added) })
  return { ids: added.map(a => `msg-${a.id}`) }
}, SECTIONS)
console.log('INJECT', JSON.stringify(inject))

await new Promise(r => setTimeout(r, 1000))
for (let i = 0; i < inject.ids.length; i++) {
  await mp.evaluate((t) => {
    const ws = getCurrentPages()[getCurrentPages().length - 1]
    ws.setData({ scrollTarget: '' })
    ws.setData({ scrollTarget: t })
  }, inject.ids[i])
  await new Promise(r => setTimeout(r, 900))
  const p = `/tmp/md-sec-${i}.png`
  await mp.screenshot({ path: p })
  console.log('SHOT', p)
}
await d.close()
console.log('DONE')
