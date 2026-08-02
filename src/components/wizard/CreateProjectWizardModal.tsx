import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
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
  const { openWizard, closeWizard, config, loadTemplateConfig } = useWizardStore()
  const { createProjectWithConfig } = useProjectStore()
  const { loadLibrary } = useDeviceLibraryStore()
  const addToast = useToastStore((s) => s.addToast)

  // V2.9.5-T3: 基于模板创建时预填向导配置（networks/topology/device_refs/rack_config/scale_up）
  useEffect(() => {
    openWizard(templateName)
    loadLibrary()
    if (templateName) {
      window.electron?.template?.getConfig(templateName)
        .then((cfg) => {
          loadTemplateConfig(cfg)
          if (!cfg) {
            addToast('warning', t('common:toast.templateNoConfig', '模板缺少配置，向导将从头开始'), 6000)
          }
        })
        .catch(() => {
          addToast('warning', t('common:toast.templateLoadFailed', '模板配置加载失败，向导将从头开始'), 6000)
        })
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleComplete = async () => {
    try {
      await createProjectWithConfig(config)
      closeWizard()
      onClose()
      addToast('success', t('common:toast.projectCreated'))
    } catch (err) {
      addToast('error', t('common:toast.projectCreateFailed', { error: err instanceof Error ? err.message : String(err) }))
      console.error('[Wizard] create project failed:', err)
    }
  }

  const handleCancel = () => {
    closeWizard()
    onClose()
  }

  return (
    <Modal
      open
      onClose={handleCancel}
      title={t('project:createProject')}
      width={640}
      maxHeight="85vh"
      closeOnEsc
      showCloseButton={false}
      bodyClassName="p-0"
    >
      <div className="flex-1 min-h-0 flex flex-col">
        <ProjectWizard
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      </div>
    </Modal>
  )
}
