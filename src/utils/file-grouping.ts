import type { FileTreeNode, GroupedNode, GroupKey } from '@/types/file-tree'

/** 输入配置文件名集合 */
const INPUT_FILES = new Set(['network_config.ini', 'project_config.json', 'project.json'])
/** 拓扑数据文件名集合 */
const TOPOLOGY_FILES = new Set(['topology.json', 'rack_layout.json'])
/** 输出目录名 */
const OUTPUT_DIR = 'output'

/** 分组顺序 */
const GROUP_ORDER: GroupKey[] = ['input', 'output', 'topology', 'other']

/** 分组 i18n key 映射 */
export const GROUP_LABEL_KEYS: Record<GroupKey, string> = {
  input: 'explorer.group.input',
  output: 'explorer.group.output',
  topology: 'explorer.group.topology',
  other: 'explorer.group.other',
}

/** 分组图标名(供组件层映射 LucideIcon) */
export const GROUP_ICONS: Record<GroupKey, string> = {
  input: 'FileInput',
  output: 'FileOutput',
  topology: 'Network',
  other: 'File',
}

/**
 * 将项目文件结构按用途智能分组
 * - input: network_config.ini / project_config.json / project.json
 * - output: output/ 目录下所有内容(保留批次子目录结构)
 * - topology: topology.json / rack_layout.json
 * - other: 未归类的根目录文件
 *
 * 空分组会被过滤,返回顺序固定为 input → output → topology → other
 */
export function groupProjectFiles(structure: FileTreeNode[]): GroupedNode[] {
  const groups: Record<GroupKey, FileTreeNode[]> = {
    input: [],
    output: [],
    topology: [],
    other: [],
  }

  for (const node of structure) {
    if (node.type === 'directory' && node.name === OUTPUT_DIR) {
      // output 目录整体归入 output 分组(保留其 children 结构,供批次渲染)
      groups.output.push(node)
    } else if (node.type === 'file' && INPUT_FILES.has(node.name)) {
      groups.input.push(node)
    } else if (node.type === 'file' && TOPOLOGY_FILES.has(node.name)) {
      groups.topology.push(node)
    } else if (node.type === 'file') {
      groups.other.push(node)
    } else {
      // 其他目录(非 output)归入 other
      groups.other.push(node)
    }
  }

  // 每个分组内按名称排序
  for (const key of GROUP_ORDER) {
    groups[key].sort((a, b) => a.name.localeCompare(b.name))
  }

  // 过滤空分组并按固定顺序返回
  return GROUP_ORDER
    .map((group) => ({
      group,
      labelKey: GROUP_LABEL_KEYS[group],
      nodes: groups[group],
    }))
    .filter((g) => g.nodes.length > 0)
}

/**
 * 将模板文件结构按用途智能分组
 * - input: project_config.json / project.json
 * - other: 其他文件和目录
 */
export function groupTemplateFiles(structure: FileTreeNode[]): GroupedNode[] {
  const groups: Record<GroupKey, FileTreeNode[]> = {
    input: [],
    output: [],
    topology: [],
    other: [],
  }

  for (const node of structure) {
    if (node.type === 'file' && INPUT_FILES.has(node.name)) {
      groups.input.push(node)
    } else {
      groups.other.push(node)
    }
  }

  for (const key of GROUP_ORDER) {
    groups[key].sort((a, b) => a.name.localeCompare(b.name))
  }

  return GROUP_ORDER
    .map((group) => ({
      group,
      labelKey: GROUP_LABEL_KEYS[group],
      nodes: groups[group],
    }))
    .filter((g) => g.nodes.length > 0)
}

/** 获取分组显示名(用于非 i18n 场景,如测试) */
export const GROUP_FALLBACK_LABELS: Record<GroupKey, string> = {
  input: 'Input Config',
  output: 'Output Files',
  topology: 'Topology Data',
  other: 'Other Files',
}
