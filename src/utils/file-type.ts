/**
 * v2.8.0-T8: 文件类型分发工具
 * 统一扩展名判定与 MIME 映射,供 FileViewerTab / OutputTab 及文件点击分发使用
 */

/** 支持的图片类型 → MIME(扩展名转小写) */
export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** 取文件扩展名(小写,不含点) */
export function getFileExt(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

/** 是否为支持的图片文件 */
export function isImageFile(fileName: string): boolean {
  return getFileExt(fileName) in IMAGE_MIME
}

/** 获取图片 MIME,非图片返回 null */
export function getImageMime(fileName: string): string | null {
  return IMAGE_MIME[getFileExt(fileName)] || null
}

/**
 * 解析 `${projectName}/${relPath}` 形式的文件路径
 * 返回 null 表示格式不合法
 */
export function splitProjectFilePath(filePath: string): { projectName: string; relPath: string } | null {
  const firstSlash = filePath.indexOf('/')
  if (firstSlash <= 0) return null
  return { projectName: filePath.substring(0, firstSlash), relPath: filePath.substring(firstSlash + 1) }
}
