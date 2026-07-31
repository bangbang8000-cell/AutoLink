/**
 * 统一的文件树节点类型定义
 * 用于 project.getStructure 和 template.getStructure 的返回值
 */
export interface FileTreeNode {
  /** 文件/目录名(不含路径) */
  name: string
  /** 节点类型 */
  type: 'directory' | 'file'
  /** 相对根目录(项目根/模板根)的完整路径,如 'output/batch1/connection_table.xlsx' */
  path: string
  /** 文件大小(字节),仅 type='file' 时有值 */
  size?: number
  /** ISO 8601 修改时间字符串 */
  updatedAt?: string
  /** 子节点,仅 type='directory' 时有值 */
  children?: FileTreeNode[]
}

/**
 * 输出批次(来自 project.listOutputBatches)
 */
export interface OutputBatch {
  /** 批次名(通常为时间戳目录名,如 '2026-07-31_143000') */
  name: string
  /** 批次内文件列表 */
  files: OutputBatchFile[]
}

export interface OutputBatchFile {
  /** 文件名(不含路径) */
  name: string
  /** 完整路径(相对 workspace 根,如 'H100-100台/output/batch1/file.xlsx') */
  path: string
}

/** 智能分组的分组键 */
export type GroupKey = 'input' | 'output' | 'topology' | 'other'

/** 智能分组后的节点 */
export interface GroupedNode {
  group: GroupKey
  /** 分组显示名(已 i18n 化的 key,如 'explorer.group.input') */
  labelKey: string
  /** 分组内的文件节点 */
  nodes: FileTreeNode[]
}
