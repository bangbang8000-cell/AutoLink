import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Upload, Download, AlertTriangle, CheckCircle } from 'lucide-react'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import type { LibraryDevice, InterfaceModel, NetworkType } from '@/types/device-profile'
import * as XLSX from 'xlsx'

interface ParsedRow {
  type: 'server' | 'switch'
  raw: Record<string, string>
  valid: boolean
  errors: string[]
  device?: LibraryDevice
}

const SERVER_HEADERS = [
  '设备类型', '厂商', '型号', '功率(W)', 'U高', '深度(mm)', '散热', '名称前缀',
  '参数网卡数', '参数网卡速率', '参数网卡类型', '参数网卡线缆',
  '存储网卡数', '存储网卡速率', '存储网卡类型', '存储网卡线缆',
  '业务网卡数', '业务网卡速率', '业务网卡类型', '业务网卡线缆',
  'OOB网卡数', 'OOB网卡速率', 'OOB网卡类型', 'OOB网卡线缆',
]

const SWITCH_HEADERS = [
  '设备类型', '厂商', '型号', '功率(W)', 'U高', '深度(mm)', '散热', '名称前缀',
  '端口数', '端口速率', '端口类型', '下行前缀', '上行前缀', '适用网络',
]

function parseServerRow(row: Record<string, string>): { valid: boolean; errors: string[]; device?: LibraryDevice } {
  const errors: string[] = []
  const vendor = row['厂商']?.trim()
  const model = row['型号']?.trim()
  const power = parseInt(row['功率(W)']) || 0
  const uHeight = parseInt(row['U高']) || 0
  const depth = parseInt(row['深度(mm)']) || 800
  const cooling = (row['散热']?.trim() === '液冷' ? 'liquid' : 'air') as 'air' | 'liquid'
  const namePrefix = row['名称前缀']?.trim()

  if (!vendor) errors.push('厂商不能为空')
  if (!model) errors.push('型号不能为空')
  if (power <= 0) errors.push('功率无效')
  if (uHeight <= 0) errors.push('U高无效')

  const interfaceModels: InterfaceModel[] = []
  const networks: { key: string; type: NetworkType }[] = [
    { key: '参数', type: 'param' },
    { key: '存储', type: 'storage' },
    { key: '业务', type: 'biz' },
    { key: 'OOB', type: 'oob' },
  ]

  for (const net of networks) {
    const count = parseInt(row[`${net.key}网卡数`]) || 0
    if (count > 0) {
      interfaceModels.push({
        network_type: net.type,
        port_count: count,
        port_speed: row[`${net.key}网卡速率`]?.trim() || '',
        port_type: row[`${net.key}网卡类型`]?.trim() || '',
        cable_type: row[`${net.key}网卡线缆`]?.trim() || '',
        downlink_prefix: 'NIC',
        uplink_prefix: 'NIC',
        port_numbering: 'sequential',
      })
    }
  }

  if (interfaceModels.length === 0) {
    errors.push('至少需要一个接口模型')
  }

  const device: LibraryDevice = {
    id: `${vendor}_${model}`.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    vendor,
    model,
    category: 'custom',
    description: row['设备类型']?.trim() || '',
    power_watts: power,
    weight_kg: 0,
    u_height: uHeight,
    depth_mm: depth,
    cooling,
    name_prefix: namePrefix || '',
    interface_models: interfaceModels,
    tags: [],
    applicable_networks: interfaceModels.map((m) => m.network_type),
    source: 'custom',
    verified: false,
    added_at: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString().slice(0, 10),
  }

  return { valid: errors.length === 0, errors, device }
}

function parseSwitchRow(row: Record<string, string>): { valid: boolean; errors: string[]; device?: LibraryDevice } {
  const errors: string[] = []
  const vendor = row['厂商']?.trim()
  const model = row['型号']?.trim()
  const power = parseInt(row['功率(W)']) || 0
  const uHeight = parseInt(row['U高']) || 0
  const depth = parseInt(row['深度(mm)']) || 460
  const cooling = (row['散热']?.trim() === '液冷' ? 'liquid' : 'air') as 'air' | 'liquid'
  const namePrefix = row['名称前缀']?.trim()
  const portCount = parseInt(row['端口数']) || 0
  const portSpeed = row['端口速率']?.trim()
  const portType = row['端口类型']?.trim()
  const downlinkPrefix = row['下行前缀']?.trim() || 'Eth1/0/'
  const uplinkPrefix = row['上行前缀']?.trim() || 'Eth1/0/'

  if (!vendor) errors.push('厂商不能为空')
  if (!model) errors.push('型号不能为空')
  if (power <= 0) errors.push('功率无效')
  if (uHeight <= 0) errors.push('U高无效')
  if (!portSpeed) errors.push('端口速率不能为空')
  if (!portType) errors.push('端口类型不能为空')

  const applicableNetworks: NetworkType[] = []
  const networkStr = row['适用网络']?.trim()?.toLowerCase()
  if (networkStr) {
    if (networkStr.includes('param')) applicableNetworks.push('param')
    if (networkStr.includes('storage')) applicableNetworks.push('storage')
    if (networkStr.includes('biz')) applicableNetworks.push('biz')
    if (networkStr.includes('oob')) applicableNetworks.push('oob')
  }

  const device: LibraryDevice = {
    id: `${vendor}_${model}`.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    vendor,
    model,
    category: 'custom',
    description: row['设备类型']?.trim() || '',
    power_watts: power,
    weight_kg: 0,
    u_height: uHeight,
    depth_mm: depth,
    cooling,
    name_prefix: namePrefix || '',
    port_count: portCount,
    port_speed: portSpeed || '',
    port_type: portType || '',
    downlink_prefix: downlinkPrefix,
    uplink_prefix: uplinkPrefix,
    tags: [],
    applicable_networks: applicableNetworks,
    source: 'custom',
    verified: false,
    added_at: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString().slice(0, 10),
  }

  return { valid: errors.length === 0, errors, device }
}

export function DeviceImportModal() {
  const { t } = useTranslation('device')
  const { showImportModal, closeImportModal, importDevices } = useDeviceLibraryStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'server' | 'switch'>('server')
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setFileName(file.name)
      try {
        const data = await file.arrayBuffer()
        const wb = XLSX.read(data, { type: 'array' })
        const sheetName = wb.SheetNames[0]
        const sheet = wb.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet)

        const parsed: ParsedRow[] = rows.map((row) => {
          const type = activeTab
          if (type === 'server') {
            const result = parseServerRow(row)
            return { type: 'server', raw: row, valid: result.valid, errors: result.errors, device: result.device }
          } else {
            const result = parseSwitchRow(row)
            return { type: 'switch', raw: row, valid: result.valid, errors: result.errors, device: result.device }
          }
        })

        setParsedRows(parsed)
      } catch (err) {
        console.error('Parse file error:', err)
      }
    },
    [activeTab],
  )

  const handleImport = async () => {
    const validDevices = parsedRows.filter((r) => r.valid && r.device).map((r) => r.device!)
    if (validDevices.length === 0) return
    setImporting(true)
    await importDevices(validDevices)
    setImporting(false)
  }

  const downloadTemplate = () => {
    const headers = activeTab === 'server' ? SERVER_HEADERS : SWITCH_HEADERS
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers])
    ws['!cols'] = headers.map(() => ({ wch: 15 }))
    XLSX.utils.book_append_sheet(wb, ws, '模板')
    XLSX.writeFile(wb, `${activeTab === 'server' ? '服务器' : '交换机'}_导入模板.xlsx`)
  }

  const validCount = parsedRows.filter((r) => r.valid).length
  const invalidCount = parsedRows.filter((r) => !r.valid).length

  if (!showImportModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeImportModal}>
      <div
        className="bg-white dark:bg-app-surface rounded-lg shadow-xl w-[680px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-edge-subtle">
          <h3 className="text-sm font-semibold">{t('import.title')}</h3>
          <button onClick={closeImportModal} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-app-hover">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => { setActiveTab('server'); setParsedRows([]); setFileName('') }}
              className={clsx(
                'px-3 py-1.5 text-xs rounded',
                activeTab === 'server'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'bg-gray-100 dark:bg-app text-gray-600 dark:text-gray-400',
              )}
            >
              {t('import.serverTab')}
            </button>
            <button
              onClick={() => { setActiveTab('switch'); setParsedRows([]); setFileName('') }}
              className={clsx(
                'px-3 py-1.5 text-xs rounded',
                activeTab === 'switch'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'bg-gray-100 dark:bg-app text-gray-600 dark:text-gray-400',
              )}
            >
              {t('import.switchTab')}
            </button>
          </div>

          {/* Upload area */}
          <div
            className="border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-primary-400 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            <div className="text-xs text-gray-500">{t('import.uploadHint')}</div>
            <div className="text-2xs text-gray-400 mt-1">{fileName || '未选择文件'}</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFile}
              className="hidden"
            />
          </div>

          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
          >
            <Download size={12} /> {t('import.downloadTemplate')}
          </button>

          {/* Preview */}
          {parsedRows.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-2 text-xs">
                <span>{t('import.total', { count: parsedRows.length })}</span>
                <span className="text-gray-500 flex items-center gap-0.5">
                  <CheckCircle size={12} /> {t('import.valid', { count: validCount })}
                </span>
                {invalidCount > 0 && (
                  <span className="text-gray-500 flex items-center gap-0.5">
                    <AlertTriangle size={12} /> {t('import.invalid', { count: invalidCount })}
                  </span>
                )}
              </div>

              <div className="max-h-[200px] overflow-y-auto border border-gray-200 dark:border-gray-600 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-app sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">厂商</th>
                      <th className="px-2 py-1 text-left">型号</th>
                      <th className="px-2 py-1 text-left">状态</th>
                      <th className="px-2 py-1 text-left">错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, idx) => (
                      <tr key={idx} className="border-t border-gray-100 dark:border-edge-subtle">
                        <td className="px-2 py-1">{row.raw['厂商'] || '-'}</td>
                        <td className="px-2 py-1">{row.raw['型号'] || '-'}</td>
                        <td className="px-2 py-1">
                          {row.valid ? (
                            <span className="text-gray-500">✓</span>
                          ) : (
                            <span className="text-gray-400">✗</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-gray-500">{row.errors.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-edge-subtle">
          <button
            onClick={closeImportModal}
            className="px-3 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-app-hover"
          >
            {t('import.cancel')}
          </button>
          <button
            onClick={handleImport}
            disabled={validCount === 0 || importing}
            className={clsx(
              'px-3 py-1.5 text-xs rounded text-white',
              validCount > 0 && !importing
                ? 'bg-primary-600 hover:bg-primary-700'
                : 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed',
            )}
          >
            {importing ? '导入中...' : t('import.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

function clsx(...args: (string | false | undefined | null)[]): string {
  return args.filter(Boolean).join(' ')
}