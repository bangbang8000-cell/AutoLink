import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from 'react'
import { useProjectStore, type ProjectInfo } from './project.store'

interface ProjectContextType {
  currentProject: string | null
  setCurrentProject: (name: string) => void
  projectPath: string
}

const ProjectContext = createContext<ProjectContextType>({
  currentProject: null,
  setCurrentProject: () => {},
  projectPath: '',
})

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [currentProject, setCurrentProjectState] = useState<string | null>(null)
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const [workspacePath, setWorkspacePath] = useState('')

  useEffect(() => {
    // Get workspace path from electron
    window.electron?.app?.getPath('workspace').then(setWorkspacePath).catch(() => {})
  }, [])

  // Sync from project store when selectedProjectName changes externally
  useEffect(() => {
    if (selectedProjectName && selectedProjectName !== currentProject) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部项目选择变化时同步当前项目
      setCurrentProjectState(selectedProjectName)
    }
  }, [selectedProjectName, currentProject])

  const setCurrentProject = useCallback((name: string) => {
    setCurrentProjectState(name)
    // Also update project.store
    const store = useProjectStore.getState()
    if (store.selectedProjectName !== name) {
      const project = store.projects.find((p: ProjectInfo) => p.name === name) ?? { id: 0, name, index: 0 }
      store.selectProject(project)
    }
  }, [])

  const projectPath = currentProject && workspacePath
    ? `${workspacePath}\\${currentProject}`
    : ''

  return (
    <ProjectContext.Provider value={{ currentProject, setCurrentProject, projectPath }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjectContext() {
  return useContext(ProjectContext)
}
