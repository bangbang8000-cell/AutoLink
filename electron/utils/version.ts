/**
 * AutoLink 版本比较工具 (electron 主进程共用)
 *
 * 用于更新检查: 只有线上版本严格高于当前版本时才触发更新;
 * 线上版本 = 当前版本 或 当前版本无效时均不触发。
 */

/**
 * 版本号是否有效 (纯数字点分格式, 如 2.7.6, 支持 v 前缀)
 *
 * 覆盖边界: "unknown" / "" / "2.7.6-beta" 等非纯数字版本一律视为无效。
 */
export function isValidVersion(version: string | undefined | null): boolean {
  if (!version) return false
  return /^\d+(\.\d+)*$/.test(version.replace(/^v/, ''))
}

/**
 * 简单的 semver 比较: 返回 -1/0/1 (仅支持纯数字点分版本)
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

/**
 * 判断线上版本是否严格高于当前版本 (更新检查核心逻辑)。
 *
 * - 线上版本 = 当前版本   → 返回 false (不触发更新)
 * - 线上版本 < 当前版本   → 返回 false
 * - 当前版本无效 (如 "unknown"/空串/预发布标签) → 返回 false (保守策略, 避免误报)
 * - 线上版本 > 当前版本   → 返回 true
 */
export function isVersionNewer(
  latest: string | undefined | null,
  current: string | undefined | null,
): boolean {
  if (!isValidVersion(latest) || !isValidVersion(current)) {
    return false
  }
  // isValidVersion 已保证非空字符串, 此处断言以满足 TS 类型
  return compareVersions(latest as string, current as string) > 0
}
