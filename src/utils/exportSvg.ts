/**
 * AutoLink V2.4.7 — SVG 导出工具
 *
 * 提供 SVG 元素序列化、SVG 文件导出、SVG→PNG 转换能力。
 * 配合 window.electron.export.saveFile IPC 保存到项目 output 目录。
 */

/**
 * 将 SVG 元素序列化为字符串
 */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  // 确保有 xmlns
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }
  return new XMLSerializer().serializeToString(clone)
}

/**
 * 将字符串转为 base64（UTF-8 安全）
 */
export function stringToBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

/**
 * 将 SVG 元素导出为 SVG 文件（通过 IPC 保存到项目 output 目录）
 */
export async function exportSvgFile(
  svg: SVGSVGElement,
  projectName: string,
  filename: string,
): Promise<void> {
  const svgStr = serializeSvg(svg)
  const base64 = stringToBase64(svgStr)
  if (window.electron?.export?.saveFile) {
    await window.electron.export.saveFile(projectName, filename, base64)
  } else {
    // Fallback: 浏览器下载
    downloadBlob(svgStr, filename, 'image/svg+xml')
  }
}

/**
 * 将 SVG 元素转换为 PNG base64
 */
export function svgToPngBase64(
  svg: SVGSVGElement,
  scale: number = 2,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const svgStr = serializeSvg(svg)
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.onload = () => {
      const width = svg.clientWidth || svg.viewBox.baseVal.width || 800
      const height = svg.clientHeight || svg.viewBox.baseVal.height || 600

      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Canvas 2D context not available'))
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)

      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      resolve(base64)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(new Error(`SVG to PNG conversion failed: ${e}`))
    }
    img.src = url
  })
}

/**
 * 将 SVG 元素导出为 PNG 文件（通过 IPC 保存到项目 output 目录）
 */
export async function exportSvgAsPng(
  svg: SVGSVGElement,
  projectName: string,
  filename: string,
  scale: number = 2,
): Promise<void> {
  const base64 = await svgToPngBase64(svg, scale)
  if (window.electron?.export?.saveFile) {
    await window.electron.export.saveFile(projectName, filename, base64)
  } else {
    // Fallback: 浏览器下载
    const byteString = atob(base64)
    const bytes = new Uint8Array(byteString.length)
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i)
    }
    downloadBlob(bytes, filename, 'image/png')
  }
}

/** 浏览器端下载 blob（开发环境 fallback） */
function downloadBlob(data: string | Uint8Array, filename: string, mime: string) {
  const blob = data instanceof Uint8Array
    ? new Blob([data as BlobPart], { type: mime })
    : new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

/**
 * 生成带时间戳的文件名
 */
export function makeTimestampedFilename(prefix: string, ext: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${prefix}_${ts}.${ext}`
}
