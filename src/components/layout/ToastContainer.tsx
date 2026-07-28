import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useToastStore, type Toast } from '@/stores/toast.store'

const iconMap = {
  success: <CheckCircle size={14} className="text-gray-400" />,
  error: <XCircle size={14} className="text-gray-400" />,
  warning: <AlertTriangle size={14} className="text-gray-400" />,
  info: <Info size={14} className="text-gray-400" />,
}

const bgMap = {
  success: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20',
  error: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20',
  warning: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20',
  info: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
}

function ToastItem({ toast }: { toast: Toast }) {
  const [entering, setEntering] = useState(true)
  const removeToast = useToastStore((s) => s.removeToast)

  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 20)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border shadow-lg text-xs
        transition-all duration-300 ${entering ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
        ${bgMap[toast.type]} text-gray-700 dark:text-gray-200 min-w-[260px] max-w-[360px]`}
    >
      {iconMap[toast.type]}
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => removeToast(toast.id)} className="p-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded">
        <X size={12} />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-10 right-4 z-[9999] flex flex-col gap-1.5 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}
