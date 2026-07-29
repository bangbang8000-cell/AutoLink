import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import {
  Server, GitBranch, FileCheck, Database,
  Cpu, Keyboard,
} from 'lucide-react'

export function WorkspaceWelcome() {
  const selectedProjectName = useProjectStore((s) => s.selectedProjectName)
  const openTab = useWorkspaceStore((s) => s.openTab)

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      {/* Brand */}
      <div className="mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-500/20">
          <Cpu size={32} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
          AutoLink
        </h1>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          智算中心网络规划工具 V2.1
        </p>
      </div>

      {selectedProjectName ? (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
            当前项目：<span className="font-medium text-primary-600 dark:text-primary-400">{selectedProjectName}</span>
          </p>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3 mb-8 max-w-md">
            <QuickActionCard
              icon={<Server size={18} />}
              label="机柜规划"
              shortcut="Ctrl+Shift+R"
              onClick={() => openTab({ type: 'rack', title: '机柜规划', closable: true })}
            />
            <QuickActionCard
              icon={<GitBranch size={18} />}
              label="拓扑视图"
              shortcut="Ctrl+Shift+T"
              onClick={() => openTab({ type: 'topology', title: `拓扑视图 - ${selectedProjectName}`, closable: true })}
            />
            <QuickActionCard
              icon={<FileCheck size={18} />}
              label="输出结果"
              shortcut="Ctrl+Shift+O"
              onClick={() => openTab({ type: 'output', title: '输出结果', closable: true })}
            />
            <QuickActionCard
              icon={<Database size={18} />}
              label="设备库"
              shortcut="Ctrl+Shift+L"
              onClick={() => openTab({ type: 'deviceLibrary', title: '设备库', closable: false })}
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-8">
          在左侧项目浏览器中选择或创建一个项目开始
        </p>
      )}

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        <Keyboard size={12} />
        <span>Ctrl+Shift+E 资源管理器 · Ctrl+B 切换侧边栏 · Ctrl+W 关闭页签</span>
      </div>
    </div>
  )
}

function QuickActionCard({
  icon, label, shortcut, onClick,
}: {
  icon: React.ReactNode
  label: string
  shortcut: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-all group"
    >
      <span className="text-gray-400 dark:text-gray-500 group-hover:text-primary-500 transition-colors">
        {icon}
      </span>
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{shortcut}</span>
    </button>
  )
}
