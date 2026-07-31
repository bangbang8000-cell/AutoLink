import React from 'react'
import { WorkspaceView } from './WorkspaceView'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import i18n from '@/i18n'

/**
 * Error boundary for the workspace editor area.
 * Uses shared ErrorBoundary with workspace-specific title.
 */
export class WorkspaceErrorBoundary extends React.Component<
  { children?: React.ReactNode },
  { retryKey: number }
> {
  state = { retryKey: 0 }

  render() {
    return (
      <ErrorBoundary
        title={i18n.t('common:errorBoundary.workspace')}
        retryKey={this.state.retryKey}
        onRetry={() => this.setState((s) => ({ retryKey: s.retryKey + 1 }))}
        key={this.state.retryKey}
      >
        {this.props.children || <WorkspaceView />}
      </ErrorBoundary>
    )
  }
}
