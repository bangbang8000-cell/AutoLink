import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { ProjectWizard } from './ProjectWizard'
import { useWizardStore } from '@/stores/wizard.store'
import { useProjectStore } from '@/stores/project.store'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import { useToastStore } from '@/stores/toast.store'

interface Props {
  templateName?: string | null
  onClose: () => void
}

export function CreateProjectWizardModal({ templateName, onClose }: Props) {
  const { t } = useTranslation()
  const { openWizard, closeWizard, config } = useWizardStore()
  const { createProjectWithConfig } = useProjectStore()
  const { loadLibrary } = useDeviceLibraryStore()
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    openWizard(templateName)
    loadLibrary()
  }, [])

  const handleComplete = async () => {
    try {
      await createProjectWithConfig(config)
      closeWizard()
      onClose()
      addToast('success', '项目创建成功')
    } catch (err: any) {
      addToast('error', `创建项目失败: ${err?.message || err}`)
      console.error('[Wizard] create project failed:', err)
    }
  }

  const handleCancel = () => {
    closeWizard()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[640px] max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {t('project:createProject')}
          </h2>
          <button
            onClick={handleCancel}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Wizard */}
        <div className="flex-1 min-h-0">
          <ProjectWizard
            onComplete={handleComplete}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </div>
  )
}