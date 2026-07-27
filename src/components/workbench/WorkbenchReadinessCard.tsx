import React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { useDesignStore } from '@/stores/design.store'
import { useRackStore } from '@/stores/rack.store'

export function WorkbenchReadinessCard() {
  const { t } = useTranslation()
  const summary = useDesignStore((s) => s.summary)
  const valid = useDesignStore((s) => s.valid)
  const cabinets = useRackStore((s) => s.cabinets)
  const unplacedDevices = useRackStore((s) => s.unplacedDevices)

  const totalDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0) + unplacedDevices.length
  const placedDevices = cabinets.reduce((sum, c) => sum + c.devices.length, 0)
  const rackReady = totalDevices > 0 && placedDevices === totalDevices

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <CheckCircle size={12} />
        {t('workbench:readiness')}
      </div>
      <div className="p-3 space-y-2">
        {/* Topology design status */}
        <div className="flex items-center gap-2 text-xs">
          {valid === true ? (
            <CheckCircle size={12} className="text-green-500 shrink-0" />
          ) : valid === false ? (
            <XCircle size={12} className="text-red-500 shrink-0" />
          ) : (
            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
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
            <CheckCircle size={12} className="text-green-500 shrink-0" />
          ) : totalDevices > 0 ? (
            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
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