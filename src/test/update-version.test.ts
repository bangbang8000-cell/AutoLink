/**
 * V2.7.7: 更新检查版本比较逻辑测试
 *
 * 覆盖 electron/utils/version.ts 的 isVersionNewer / compareVersions / isValidVersion。
 * 核心断言: 线上版本 = 当前版本 时绝不触发更新 (updateAvailable = false)。
 */
import { describe, it, expect } from 'vitest'
import { compareVersions, isValidVersion, isVersionNewer } from '../../electron/utils/version'

describe('compareVersions', () => {
  it('相等返回 0', () => {
    expect(compareVersions('2.7.6', '2.7.6')).toBe(0)
    expect(compareVersions('2.7.6', '2.7.6.0')).toBe(0)
    expect(compareVersions('2.7.6', 'v2.7.6')).toBe(0)
  })

  it('线上大于当前返回 1', () => {
    expect(compareVersions('2.7.7', '2.7.6')).toBe(1)
    expect(compareVersions('2.8.0', '2.7.9')).toBe(1)
  })

  it('线上小于当前返回 -1', () => {
    expect(compareVersions('2.7.5', '2.7.6')).toBe(-1)
    expect(compareVersions('2.7.6', '2.7.6.1')).toBe(-1)
  })
})

describe('isValidVersion', () => {
  it('有效版本返回 true', () => {
    expect(isValidVersion('2.7.6')).toBe(true)
    expect(isValidVersion('v2.7.6')).toBe(true)
    expect(isValidVersion('2.7.6.1')).toBe(true)
  })

  it('无效版本返回 false', () => {
    expect(isValidVersion('')).toBe(false)
    expect(isValidVersion('unknown')).toBe(false)
    expect(isValidVersion('2.7.6-beta')).toBe(false)
    expect(isValidVersion('latest')).toBe(false)
    expect(isValidVersion(undefined)).toBe(false)
    expect(isValidVersion(null)).toBe(false)
  })
})

describe('isVersionNewer (更新检查核心逻辑)', () => {
  it('线上版本 = 当前版本 → 不触发更新', () => {
    expect(isVersionNewer('2.7.6', '2.7.6')).toBe(false)
    expect(isVersionNewer('2.7.6', 'v2.7.6')).toBe(false)
  })

  it('线上版本 > 当前版本 → 触发更新', () => {
    expect(isVersionNewer('2.7.7', '2.7.6')).toBe(true)
    expect(isVersionNewer('2.8.0', '2.7.9')).toBe(true)
  })

  it('线上版本 < 当前版本 → 不触发更新', () => {
    expect(isVersionNewer('2.7.5', '2.7.6')).toBe(false)
  })

  it('当前版本无效 → 不触发更新 (修复误报: 原 compareVersions 对无效版本返回 1)', () => {
    // 修复前: compareVersions('2.7.6', 'unknown') = 1 → 误报有新版本
    expect(isVersionNewer('2.7.6', 'unknown')).toBe(false)
    expect(isVersionNewer('2.7.6', '')).toBe(false)
    expect(isVersionNewer('2.7.6', undefined)).toBe(false)
    expect(isVersionNewer('2.7.6', null)).toBe(false)
    expect(isVersionNewer('2.7.6', '2.7.6-beta')).toBe(false)
  })

  it('线上版本无效 → 不触发更新', () => {
    expect(isVersionNewer('unknown', '2.7.6')).toBe(false)
    expect(isVersionNewer('', '2.7.6')).toBe(false)
  })
})
