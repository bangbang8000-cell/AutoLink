import React from 'react'
import i18n from '@/i18n'

interface Props {
  children: React.ReactNode
  /** Custom fallback title (already translated by caller) */
  title?: string
  /** Key to force remount on retry */
  retryKey?: number
  onRetry?: () => void
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
    console.error(`[ErrorBoundary] ${this.props.title || 'Component'} crashed:`, error.message, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    this.props.onRetry?.()
  }

  render() {
    if (this.state.hasError) {
      const displayTitle = this.props.title || i18n.t('common:errorBoundary.pageTitle')
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 text-center">
          <p className="text-sm text-error-500 dark:text-error-400 mb-1">
            {i18n.t('common:errorBoundary.loadFailed', { title: displayTitle })}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 max-w-xs break-all">
            {this.state.error?.message || i18n.t('common:errorBoundary.unknownError')}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-3 py-1 text-xs rounded bg-primary-500 hover:bg-primary-600 text-white"
          >
            {i18n.t('common:errorBoundary.retry')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
