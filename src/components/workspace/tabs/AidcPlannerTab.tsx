/**
 * AIDC 规划独立 Tab（H3，D-7）。
 *
 * 从 WorkbenchTab Row5 提出为一级入口；不依赖先选项目。
 */
import { AidcPlannerPanel } from '@/components/aidc/AidcPlannerPanel'

export function AidcPlannerTab() {
  return (
    <div className="h-full overflow-auto p-4">
      <AidcPlannerPanel />
    </div>
  )
}
