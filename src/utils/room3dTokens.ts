/**
 * 5.4.11-B-4：机房 3D 场景配色 token（单一事实源）
 *
 * 把 Room3DView 中散落的十六进制颜色收敛为语义化常量：
 * - 改配色只需动此文件（场景一致性）
 * - 测试锁定取值（视觉基线防漂移）
 */
export const ROOM_3D_TOKENS = {
  /** 未识别机柜类型的柜身底色（type 着色回退） */
  cabinetFallback: '#f1f5f9',
  /** 服务器设备块（Server） */
  serverBlock: '#0ea5e9',
  /** 交换机/非服务器设备块 */
  switchBlock: '#f59e0b',
  /** 空调占位体 */
  acBody: '#94a3b8',
  /** 立柱占位体 */
  pillarBody: '#64748b',
  /** 柜体正面朝向深色板 */
  frontPanel: '#1f2937',
  /** 选中柜高亮线框 */
  selectionWireframe: '#ec4899',
  /** 地面网格（细分格） */
  gridCell: '#d1d5db',
  /** 地面网格（分区块） */
  gridSection: '#9ca3af',
} as const

export type Room3DTokenKey = keyof typeof ROOM_3D_TOKENS
