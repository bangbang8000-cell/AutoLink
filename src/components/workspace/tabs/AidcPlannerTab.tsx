/**
 * AIDC 规划独立 Tab（H3，D-7）。
 *
 * 从 WorkbenchTab Row5 提出为一级入口；不依赖先选项目。
 * V5.0.11: 透传当前项目 → GPU 规模等参数随项目选择动态回填。
 */
import { AidcPlannerPanel } from '@/components/aidc/AidcPlannerPanel'

export function AidcPlannerTab({ projectName }: { projectName?: string | null }) {
  return (
    <div className="h-full overflow-auto p-4">
      <AidcPlannerPanel boundProjectName={projectName} />
    </div>
  )
}
