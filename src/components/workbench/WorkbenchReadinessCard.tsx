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

  const handleValidate = useCallback(async () => {
    if (!selectedProjectName) return
    setValidatingTopo(true)
    try {
      await validate(selectedProjectName)
      addToast('success', '拓扑校验完成')
    } catch (err) {
      addToast('error', `校验失败: ${(err as Error).message}`)
    } finally {
      setValidatingTopo(false)
    }
  }, [selectedProjectName, validate, addToast])

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={12} />
          {t('workbench:readiness')}
        </div>
        <button
          onClick={handleValidate}
          disabled={validatingTopo || generating || !selectedProjectName}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
            {t('workbench:topologyStatus')}:
          </span>
          <span className={
            valid === true
              ? 'text-green-600 dark:text-green-400 font-medium'
              : valid === false
                ? 'text-red-600 dark:text-red-400 font-medium'
                : 'text-amber-600 dark:text-amber-400'
          }>
            {valid === true
              ? t('workbench:topologyComplete')
              : valid === false
                ? t('workbench:topologyFailed')
                : t('workbench:topologyPending')}
          </span>
          {summary && (
            <span className="text-gray-400 text-[10px]">
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
            {t('workbench:rackStatus')}:
          </span>
          <span className={
            rackReady
              ? 'text-green-600 dark:text-green-400 font-medium'
              : totalDevices > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-gray-400'
          }>
            {totalDevices === 0
              ? t('workbench:rackPending')
              : rackReady
                ? t('workbench:rackComplete')
                : `${placedDevices}/${totalDevices} ${t('workbench:rackPartially')}`}
          </span>
        </div>
      </div>
    </div>
  )
}
