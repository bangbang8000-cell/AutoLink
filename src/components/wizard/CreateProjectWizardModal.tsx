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
