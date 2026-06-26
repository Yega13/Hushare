'use client'

import { Component, type ReactNode, type ErrorInfo } from 'react'

type Props = {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
}

type State = {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary]', error, info.componentStack)
    }
    this.props.onError?.(error, info)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      if (this.props.fallback != null) return this.props.fallback
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-10 text-center"
          style={{ background: 'rgba(253,250,245,0.9)', border: '1px solid #DDD5C5', color: '#254F22' }}
        >
          <p className="text-sm font-semibold">Something went wrong.</p>
          <button
            type="button"
            onClick={this.reset}
            className="rounded-full px-4 py-1.5 text-xs font-semibold transition hover:opacity-80"
            style={{ background: '#254F22', color: '#FDFAF5' }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
