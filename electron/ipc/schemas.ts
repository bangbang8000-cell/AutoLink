/**
 * V3.2.2-R11.1: IPC 载荷 zod 校验 schema
 *
 * 对安全敏感 / 载荷动态的 IPC 通道做形状与边界校验（白名单思维）：
 *  - 类型错误 / 越界 / 路径穿越形状 → 在校验层直接拒绝，不进入 handler 与后端
 *  - 仅作"门禁"：通过校验后，handler 仍可使用原始 payload（避免 schema 剥离扩展字段）
 */
import { z } from 'zod'

/** 项目/模板名：非空、≤120、不含路径分隔符与 `..` */
export const projectNameSchema = z
  .string()
  .min(1, '名称不能为空')
  .max(120, '名称过长')
  .regex(/^[^/\\]+$/, '名称不能包含路径分隔符')
  .refine((v) => v !== '.' && v !== '..' && !v.includes('..'), '名称不能包含 ..')

/** ai:call 的 action 形状校验（后端 action 注册表驱动，此处只做字符边界） */
export const actionSchema = z
  .string()
  .min(1, 'action 不能为空')
  .max(64, 'action 过长')
  .regex(/^[a-z0-9][a-z0-9:_-]*$/, '非法 action 字符')

/** ai:call / ai:chat 的 params 必须是普通对象 */
export const paramsObjectSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => !Array.isArray(v), 'params 必须是对象')

/** ai:chat 载荷 */
export const aiChatSchema = z.object({
  sessionId: z.string().min(1).max(64),
  message: z.string().max(20000, '消息过长'),
  mode: z.string().max(32).optional(),
  provider: z.string().max(64).optional(),
  autonomyMode: z.string().max(32).optional(),
  projectName: z.string().max(120).optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
})

/** 批量优化应用载荷（suggestions 结构与前端 BatchOptimizePanel 一致） */
export const optimizeApplySchema = z.object({
  projectName: projectNameSchema,
  suggestions: z
    .array(
      z.object({
        category: z.string().max(64).optional(),
        title: z.string().max(200).optional(),
        patch: z.record(z.string(), z.record(z.string(), z.unknown())),
      }),
    )
    .min(1, '缺少建议')
    .max(100, '建议数量过多'),
})

/** 智能修复应用载荷 */
export const repairApplySchema = z.object({
  projectName: projectNameSchema,
  fixes: z
    .array(
      z.object({
        rule_id: z.string().max(64).optional(),
        message: z.string().max(2000).optional(),
        patch: z.record(z.string(), z.record(z.string(), z.unknown())),
      }),
    )
    .min(1, '缺少修复项')
    .max(100, '修复项数量过多'),
})

/** 机房智能落位载荷 */
export const roomOptimizeSchema = z
  .object({
    matrix: z.unknown().optional(),
    project: z.string().max(120).optional(),
    counts: z.record(z.string(), z.number()).optional(),
    cabinets: z
      .array(
        z.object({
          id: z.number(),
          type: z.string().max(64),
          power_watts: z.number(),
        }),
      )
      .optional(),
    objectives: z.record(z.string(), z.number()).optional(),
    constraints: z.object({ powerLimitPerRack: z.number().optional() }).optional(),
    timeBudgetS: z.number().optional(),
    resetExisting: z.boolean().optional(),
  })
  .refine((p) => p.matrix !== undefined || p.project !== undefined, '缺少参数：matrix 或 project')
  .refine((p) => p.counts !== undefined || p.cabinets !== undefined, '缺少参数：counts 或 cabinets')

/** 配置导入 / 预设应用：必须为对象 */
export const configPayloadSchema = z.record(z.string(), z.unknown())

/** 机房矩阵创建 / 校验载荷（rows 行名数组、cols 列数数组） */
export const roomCreateSchema = z.object({
  rows: z.array(z.string().min(1).max(32)).min(1).max(1000),
  cols: z.array(z.number().int().min(1).max(1000)).min(1).max(1000),
  name: z.string().min(1).max(64).optional(),
})
export const roomValidateSchema = z.record(z.string(), z.unknown())

/** ATOP 拓扑推荐载荷（numGpus 必填有界，traffic 计数有界） */
export const atopRecommendSchema = z
  .object({
    numGpus: z.number().int().min(1).max(100000),
    model: z.string().max(200).optional(),
    modelType: z.string().max(64).optional(),
    numExperts: z.number().int().min(1).max(10000).optional(),
    precision: z.string().max(32).optional(),
    tp: z.number().int().min(1).max(1024).optional(),
    dp: z.number().int().min(1).max(1024).optional(),
    pp: z.number().int().min(1).max(1024).optional(),
    communicationPattern: z.string().max(64).optional(),
    commRatio: z.number().min(0).max(1).optional(),
    traffic: z.record(z.string().max(32), z.number().min(0).max(1)).optional(),
    switchPorts: z.number().int().min(1).max(10000).optional(),
  })
  .refine((p) => p.numGpus !== undefined, '缺少参数：numGpus')

/** 导出保存文件：fileName 必须是单层文件名（防路径穿越） */
export const exportSaveFileSchema = z.object({
  projectName: projectNameSchema,
  fileName: z
    .string()
    .min(1, '文件名不能为空')
    .max(120, '文件名过长')
    .regex(/^[^/\\]+$/, '文件名不能包含路径分隔符'),
  base64Data: z.string().min(1).max(50_000_000, '数据过大'),
})

/** 打磨轮（v1.5 / AL-O1b）：输出相对路径（output/<batch>/<file> 或 output/<file>），防穿越 */
const outputRelPathSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(/^output\/[^/\\][^/\\]*(\/[^/\\]+)*$/, '非法输出路径')

/** 渲染产物写入批次：base64 → output/<batch>/<file>（前端生成物并入版本批次） */
export const outputSaveFileSchema = z.object({
  projectName: projectNameSchema,
  relPath: outputRelPathSchema,
  base64Data: z.string().min(1).max(50_000_000, '数据过大'),
})

/** 读取输出文件（预览）：base64 + 扩展名 + 大小 */
export const outputReadFileSchema = z.object({
  projectName: projectNameSchema,
  relPath: outputRelPathSchema,
})

/** 柜内智能落位（rack:optimize）：柜 + 待上架设备池 */
export const rackOptimizeSchema = z.object({
  cabinets: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  unplaced_devices: z.array(z.record(z.string(), z.unknown())).max(5000).default([]),
  gpu_per_cabinet: z.number().int().min(1).max(64).optional(),
})

/** shell:openExternal 仅允许 https */
export const httpsUrlSchema = z.string().startsWith('https://', '仅允许 https 链接')

/** 设备库保存 / 导入载荷 */
export const deviceSaveSchema = z
  .object({
    id: z.string().min(1).max(200),
    category: z.string().min(1).max(100),
    directory: z.string().max(200).optional(),
  })
  .passthrough()

/** 项目创建（带配置）载荷 */
export const createWithConfigSchema = z.object({
  meta: z.object({
    name: projectNameSchema,
    description: z.string().optional(),
    version: z.number().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  }),
  networks: z.record(z.string(), z.boolean()),
  topology: z.record(z.string(), z.unknown()),
  device_refs: z.record(z.string(), z.unknown()),
  rack_config: z.record(z.string(), z.unknown()),
})

/** 容量规划推荐载荷 */
export const capacityRecommendSchema = z.object({
  model: z.string().min(1).max(200),
  numGpus: z.number().int().min(1).max(100000),
  budget: z.string().max(64).optional(),
  precision: z.string().max(32).optional(),
  contextLength: z.number().int().min(1).max(10000000).optional(),
})

/** 校验门禁：解析失败抛带 label 的错误，成功返回解析结果 */
export function assertParsed<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new Error(`IPC 参数校验失败 [${label}]: ${first?.message ?? '参数不合法'}`)
  }
  return result.data
}
