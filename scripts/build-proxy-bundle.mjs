// proxy 云托管部署包生成：cloud/deploy/proxy/ 自包含 zip 源
// 背景：server.mjs 用 ../lib/* 引用 canonical 共享库（cloud/lib），
// 直接传 cloud/proxy/ 会因构建上下文缺 lib 崩；本脚本组装平铺包：
//   Dockerfile(修正 COPY lib/ /lib/) + server.mjs + package.json + lib/*.cjs
// 用法：node scripts/build-proxy-bundle.mjs
import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'cloud/deploy/proxy')
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'lib'), { recursive: true })

copyFileSync(join(root, 'cloud/proxy/server.mjs'), join(out, 'server.mjs'))
copyFileSync(join(root, 'cloud/proxy/package.json'), join(out, 'package.json'))
for (const f of readdirSync(join(root, 'cloud/lib')).filter((n) => n.endsWith('.cjs'))) {
  copyFileSync(join(root, 'cloud/lib', f), join(out, 'lib', f))
}

// Dockerfile：lib 落到 /lib——容器内 ../lib 与仓库 cloud/proxy→cloud/lib 拓扑同构
const dockerfile = `# CloudBase Run 镜像：byok 数据面代理（由 scripts/build-proxy-bundle.mjs 生成）
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
# canonical 共享库落到 /lib：server.mjs 的 ../lib 与仓库 cloud/proxy→cloud/lib 同构
COPY lib/ /lib/
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
`
writeFileSync(join(out, 'Dockerfile'), dockerfile)

const files = readdirSync(out, { recursive: true })
console.log('[build-proxy-bundle] cloud/deploy/proxy :', files.join(', '))
