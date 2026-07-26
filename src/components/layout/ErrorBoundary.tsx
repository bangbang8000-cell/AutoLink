import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Panel crashed:', error.message, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 text-center">
          <p className="text-sm text-red-500 dark:text-red-400 mb-1">面板加载失败</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 max-w-xs break-all">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
