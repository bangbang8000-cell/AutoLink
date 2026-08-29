/**
 * M2（AL-SNAP1/2/3）：设计快照 store——命名/时间/列表/删除，会话内持久化（localStorage）
 * - saveSnapshot：序列化当前设计（矩阵+机柜+配置）；单快照序列化 > 2MB 跳过并提示
 * - restoreSnapshot：校验 → applyDesignState 整状态恢复（撤销可回退）
 * - deleteSnapshot / list：快照管理
 * - importFromJson：导入快照 JSON（结构/版本校验 → 导入前备份当前状态 → 应用），失败友好提示
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useRoomStore } from './room.store'
import { useRackStore } from './rack.store'
import { useToastStore } from './toast.store'
import {
  serializeDesignState,
  validateSnapshot,
  applyDesignState,
  SNAPSHOT_MAX_BYTES,
  type DesignSnapshot,
  type ValidateResult,
} from '@/utils/designSnapshot'

export interface DesignSnapshotItem {
  id: string
  name: string
  createdAt: string
  state: DesignSnapshot
}

interface SnapshotState {
  snapshots: DesignSnapshotItem[]
  list: () => DesignSnapshotItem[]
  /** 保存快照；maxBytes 可注入（测试用小阈值触发容量拒绝），默认 SNAPSHOT_MAX_BYTES */
  saveSnapshot: (name?: string, maxBytes?: number) => ValidateResult & { id?: string }
  restoreSnapshot: (id: string) => ValidateResult
  deleteSnapshot: (id: string) => void
  /** 导入快照 JSON 文本：校验 → 导入前备份当前状态 → 应用；成功返回导入快照名 */
  importFromJson: (jsonText: string, opts?: { backupName?: string }) => ValidateResult & { name?: string }
}

/** 序列化后 UTF-8 字节数（TextEncoder 优先，兜底按字符数近似） */
function utf8Bytes(str: string): number {
  try {
    return new TextEncoder().encode(str).length
  } catch {
    return str.length
  }
}

let snapSeq = 0
function nextId(): string {
  return `snap-${Date.now()}-${++snapSeq}`
}

/** 默认快照名：快照 YYYYMMDD-HHmmss（date 可注入便于测试） */
export function defaultSnapshotName(date?: Date): string {
  const d = date ?? new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `快照 ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export const useSnapshotStore = create<SnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: [],

      list: () => get().snapshots,

      saveSnapshot: (name, maxBytes = SNAPSHOT_MAX_BYTES) => {
        const room = useRoomStore.getState()
        const rack = useRackStore.getState()
        if (!room.matrix && rack.cabinets.length === 0) {
          useToastStore.getState().addToast('warning', '当前没有可保存的设计数据（请先定义机柜矩阵）', 4000)
          return { ok: false, reason: 'no_data' }
        }
        const finalName = name || defaultSnapshotName()
        const state = serializeDesignState(room, rack, { name: finalName })
        const bytes = utf8Bytes(JSON.stringify(state))
        if (bytes > maxBytes) {
          useToastStore.getState().addToast('warning', '设计快照过大（超过 2MB），已跳过保存', 5000)
          return { ok: false, reason: 'too_large' }
        }
        const item: DesignSnapshotItem = {
          id: nextId(),
          name: finalName,
          createdAt: state.meta.savedAt,
          state,
        }
        set((s) => ({ snapshots: [...s.snapshots, item] }))
        return { ok: true, id: item.id }
      },

      restoreSnapshot: (id) => {
        const item = get().snapshots.find((it) => it.id === id)
        if (!item) return { ok: false, reason: 'not_found' }
        const check = validateSnapshot(item.state)
        if (!check.ok) {
          useToastStore.getState().addToast('error', `快照校验失败：${check.reason}`, 5000)
          return check
        }
        const r = applyDesignState(useRoomStore.getState(), useRackStore.getState(), item.state)
        if (!r.ok) return r
        useToastStore.getState().addToast('success', `已恢复快照：${item.name}（可用撤销回退）`, 4000)
        return r
      },

      deleteSnapshot: (id) => {
        set((s) => ({ snapshots: s.snapshots.filter((it) => it.id !== id) }))
      },

      importFromJson: (jsonText, opts) => {
        let data: unknown
        try {
          data = JSON.parse(jsonText)
        } catch {
          return { ok: false, reason: 'invalid_json' }
        }
        const check = validateSnapshot(data)
        if (!check.ok) return check
        const snapshot = data as DesignSnapshot
        // 导入前备份当前设计（无数据则 saveSnapshot 内部跳过，不新增）
        const backupName = opts?.backupName ?? `导入前备份 ${defaultSnapshotName()}`
        get().saveSnapshot(backupName)
        const r = applyDesignState(useRoomStore.getState(), useRackStore.getState(), snapshot)
        if (!r.ok) return r
        return { ...r, name: snapshot.meta?.name }
      },
    }),
    {
      name: 'autolink-design-snapshots',
      partialize: (s) => ({ snapshots: s.snapshots }),
    },
  ),
)
