import { Component, type ErrorInfo, type ReactNode } from 'react'
import { LogoMark } from '@/components/LogoMark'

/** Branded loading state, visually identical to the static shell in index.html so the hand-over does not flicker. */
export function LoadingShell({ label = 'Loading 3D…' }: { label?: string }) {
  return (
    <div className="qs-shell" role="status" aria-live="polite">
      <LogoMark size={56} />
      <div className="qs-shell-name">QuadSpectat</div>
      <div className="qs-shell-label">{label}</div>
      <div className="qs-shell-bar" aria-hidden="true"><i /></div>
    </div>
  )
}

interface State { error: Error | null }

/** Never leave a blank screen: a failed route chunk, engine download or render error shows a message and a retry. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[QuadSpectat] render failed', error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="qs-shell" role="alert">
        <LogoMark size={56} />
        <div className="qs-shell-name">QuadSpectat</div>
        <div className="qs-shell-label" style={{ maxWidth: '22rem', textAlign: 'center' }}>
          {this.state.error.message || 'Something went wrong while loading the viewer.'}
        </div>
        <button type="button" className="qs-shell-btn" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
