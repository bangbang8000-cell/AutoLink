import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, AlertTriangle, XCircle, RefreshCw, Loader2 } from 'lucide-react'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'

export function WorkbenchReadinessCard() {
  const { t } = useTranslation()
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const summary = useDesignStore((s) => s.summary)
  const valid = useDesignStore((s) => s.valid)
  const generating = useDesignStore((s) => s.generating)
  const validate = useDesignStore((s) => s.validate)
  const cabinets = useRackStore((s) => s.cabinets)
  const unplacedDevices = useRackStore((s) => s.unplacedDevices)
  const addToast = useToastStore((s) => s.addToast)

  const [validatingTopo, setValidatingTopo] = useState(false)

  const totalDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0) + unplacedDevices.length
  const placedDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0)
  const rackReady = totalDevices > 0 && placedDevices === totalDevices
  // 打磨轮（v1.6 / AL-N1d）：渲染门禁 = 组网设计有拓扑产出（软门禁，机柜设计为建议项）
  const renderReady = valid === true || (summary?.totalServers ?? 0) > 0

  const handleValidate = useCallback(async () => {
    if (!selectedProjectName) return
    setValidatingTopo(true)
    try {
      await validate(selectedProjectName)
      addToast('success', t('common:toast.topologyValidationComplete'))
    } catch (err) {
      addToast('error', t('common:toast.validationFailed', { error: (err as Error).message }))
    } finally {
      setValidatingTopo(false)
    }
  }, [selectedProjectName, validate, addToast])

  return (
    <div className="border border-gray-200 dark:border-edge-subtle rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-app/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={12} />
          {t('workbench:readiness')}
        </div>
        <button
          onClick={handleValidate}
          disabled={validatingTopo || generating || !selectedProjectName}
          className="flex items-center gap-1 px-2 py-0.5 text-2xs rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-app-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {validatingTopo ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <RefreshCw size={10} />
          )}
          校验拓扑
        </button>
      </div>
      <div className="p-3 space-y-2">
        {/* Topology design status */}
        <div className="flex items-center gap-2 text-xs">
          {valid === true ? (
            <CheckCircle size={12} className="text-gray-400 shrink-0" />
          ) : valid === false ? (
            <XCircle size={12} className="text-gray-400 shrink-0" />
          ) : (
            <AlertTriangle size={12} className="text-gray-400 shrink-0" />
          )}
          <span className="text-gray-500 dark:text-gray-400">
            {t('workbench:networkDesign', '组网设计')}:
          </span>
          <span className={
            valid === true
              ? 'text-success-600 dark:text-success-400 font-medium'
              : valid === false
                ? 'text-error-600 dark:text-error-400 font-medium'
                : 'text-warning-600 dark:text-warning-400'
          }>
            {valid === true
              ? t('workbench:topologyComplete')
              : valid === false
                ? t('workbench:topologyFailed')
                : t('workbench:topologyPending')}
          </span>
          {summary && (
            <span className="text-gray-400 text-2xs">
              ({summary.totalServers} {t('workbench:servers')})
            </span>
          )}
        </div>

        {/* Rack layout status */}
        <div className="flex items-center gap-2 text-xs">
          {rackReady ? (
            <CheckCircle size={12} className="text-gray-400 shrink-0" />
          ) : totalDevices > 0 ? (
            <AlertTriangle size={12} className="text-gray-400 shrink-0" />
          ) : (
            <AlertTriangle size={12} className="text-gray-400 shrink-0" />
          )}
          <span className="text-gray-500 dark:text-gray-400">
            {t('workbench:rackDesign', '机柜设计')}:
          </span>
          <span className={
            rackReady
              ? 'text-success-600 dark:text-success-400 font-medium'
              : totalDevices > 0
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-gray-400'
          }>
            {totalDevices === 0
              ? t('workbench:rackPending')
              : rackReady
                ? t('workbench:rackComplete')
                : `${placedDevices}/${totalDevices} ${t('workbench:rackPartially')}`}
          </span>
        </div>

        {/* 打磨轮（v1.6 / AL-N1d）：可渲染总览（依赖门禁） */}
        <div className="flex items-center gap-2 text-xs pt-1 border-t border-gray-100 dark:border-edge-subtle">
          {renderReady ? (
            <CheckCircle size={12} className="text-success-500 shrink-0" />
          ) : (
            <AlertTriangle size={12} className="text-warning-500 shrink-0" />
          )}
          <span className="text-gray-600 dark:text-gray-300 font-medium">
            {t('workbench:renderReady', '可渲染（组网设计就绪）')}:
          </span>
          <span className={renderReady ? 'text-success-600 dark:text-success-400 font-medium' : 'text-warning-600 dark:text-warning-400'}>
            {renderReady ? t('workbench:topologyComplete', '就绪') : '未就绪'}
          </span>
        </div>
      </div>
    </div>
  )
}
