// 从 build/logo.svg 生成多平台图标文件
// 产物：build/icon.png (1024×1024)、build/icon.ico (16/32/48/64/128/256)
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const svgPath = join(root, 'build', 'logo.svg')
const svg = readFileSync(svgPath)

/** 渲染 SVG 为指定尺寸的 PNG Buffer */
function renderPng(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  })
  return resvg.render().asPng()
}

// 1. 生成 1024×1024 PNG（electron-builder 主图标）
const png1024 = renderPng(1024)
writeFileSync(join(root, 'build', 'icon.png'), png1024)
console.log('[icons] build/icon.png (1024×1024) 已生成')

// 2. 生成多尺寸 ICO（Windows）
// ICO 必须为合法格式（文件头 00 00 01 00），png-to-ico 输出符合规范
const icoSizes = [16, 32, 48, 64, 128, 256]
const pngsForIco = icoSizes.map((s) => renderPng(s))
const icoBuffer = await pngToIco(pngsForIco)
writeFileSync(join(root, 'build', 'icon.ico'), icoBuffer)
console.log(`[icons] build/icon.ico (${icoSizes.join('/')} 多尺寸) 已生成`)

// 3. 生成 512×512 PNG（运行时引用 public/icons/icon.png）
mkdirSync(join(root, 'public', 'icons'), { recursive: true })
writeFileSync(join(root, 'public', 'icons', 'icon.png'), renderPng(512))
console.log('[icons] public/icons/icon.png (512×512) 已生成')

// 4. 验证 ICO 文件头
const icoHeader = readFileSync(join(root, 'build', 'icon.ico'), { start: 0, end: 4 })
const headerHex = Buffer.from(icoHeader).toString('hex')
if (headerHex.startsWith('00000100')) {
  console.log(`[icons] ICO 文件头校验通过: ${headerHex}`)
} else {
  console.error(`[icons] ICO 文件头异常: ${headerHex}（应为 00000100...）`)
  process.exit(1)
}

console.log('[icons] 全部图标生成完成')
