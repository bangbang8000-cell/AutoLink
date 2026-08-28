/**
 * AL-N2（PRD v3.2）：中栏工作台子视图动态状态推导（替代静态 ①-⑤ 徽标）
 *
 * 纯函数：`deriveSubviewStatus(subviewId, deps) → { label, tone }`
 * 数据来源（调用方从各 store 读取后传入，函数自身不依赖 store）：
 *   - designValid          → design.store.valid（组网设计是否生成并通过校验）
 *   - rackReady            → rack.store 就绪度（设备全部上架，cabinets+unplacedDevices 计算）
 *   - rackHasCabinets      → rack.store.cabinets.length > 0（已有柜）
 *   - roomMatrixFinalized  → room.store.matrix.finalized === true（机房矩阵已定稿；定稿蕴含矩阵存在）
 *   - hasOutputBatches     → listOutputBatches 返回批次非空
 *   - hasSelectedOutputTypes → render.store.selectedOutputTypes 非空（已勾选输出类型）
 *   - activeSubview        → ui.store.workbenchSubview（当前正在查看的子视图）
 *   - reading              → 可选读取中标记（如 design generating / render rendering）
 *
 * 三态映射规则：
 *   1. 优先级最高：reading 或 当前 active 子视图 → 「进行中」（active，蓝）
 *   2. 各子视图就绪判断（否则「待操作」，灰）：
 *      - roomdesign     ：矩阵存在且已定稿        → 已完成
 *      - rackdesign     ：矩阵已定稿且有柜         → 已完成
 *      - design         ：designValid === true     → 已完成
 *      - main           ：designValid && 有输出类型 → 已完成
 *      - visualization  ：designValid === true     → 已完成
 *      - results / export：存在输出批次             → 已完成
 *      - aidc           ：无规划就绪信号，恒定待操作（不显示进度假象）
 */
import type { WorkbenchSubview } from '@/stores/ui.store'

export type SubviewStatusTone = 'done' | 'pending' | 'active'

export interface SubviewStatus {
  label: '已完成' | '待操作' | '进行中'
  tone: SubviewStatusTone
}

export interface SubviewStatusDeps {
  /** design.store.valid：组网设计是否生成并通过校验（null=未生成） */
  designValid: boolean | null
  /** 机柜就绪度：设备已全部上架（cabinets + unplacedDevices 计算） */
  rackReady: boolean
  /** 是否已有柜（rack.store.cabinets.length > 0） */
  rackHasCabinets: boolean
  /** 机房矩阵是否已定稿（room.store.matrix.finalized === true；定稿蕴含矩阵存在） */
  roomMatrixFinalized: boolean
  /** 是否存在输出批次（listOutputBatches 非空） */
  hasOutputBatches: boolean
  /** 是否已勾选输出类型（render.store.selectedOutputTypes 非空） */
  hasSelectedOutputTypes: boolean
  /** 当前 active 子视图（ui.store.workbenchSubview）；不参与判断时传 null */
  activeSubview: WorkbenchSubview | null
  /** 可选读取中标记（如 design generating / render rendering） */
  reading?: boolean
}

export function deriveSubviewStatus(subviewId: WorkbenchSubview, deps: SubviewStatusDeps): SubviewStatus {
  // 读取中或当前正在查看 → 进行中（优先级最高，替代旧「数字圆圈」的位置感）
  if (deps.reading || subviewId === deps.activeSubview) {
    return { label: '进行中', tone: 'active' }
  }

  let done = false
  switch (subviewId) {
    case 'roomdesign':
      // 机房设计：矩阵存在且已定稿才算完成
      done = deps.roomMatrixFinalized
      break
    case 'rackdesign':
      // 机柜设计：矩阵已定稿（进入柜内规划的前置）且有柜
      done = deps.roomMatrixFinalized && deps.rackHasCabinets
      break
    case 'design':
      done = deps.designValid === true
      break
    case 'main':
      // 组网渲染：组网设计通过且至少勾选一种输出类型
      done = deps.designValid === true && deps.hasSelectedOutputTypes
      break
    case 'visualization':
      done = deps.designValid === true
      break
    case 'results':
    case 'export':
      done = deps.hasOutputBatches
      break
    case 'aidc':
      // AIDC 规划当前无就绪度信号，恒定待操作（不显示进度假象）
      done = false
      break
  }

  return done ? { label: '已完成', tone: 'done' } : { label: '待操作', tone: 'pending' }
}
