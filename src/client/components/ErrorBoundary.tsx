import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught React Error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-800/60 text-rose-200 space-y-4 my-4 animate-fadeIn">
          <div className="flex items-center space-x-3 text-rose-400 font-bold text-base">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <span>{this.props.fallbackTitle || 'Fehler beim Darstellen dieser Ansicht'}</span>
          </div>
          <p className="text-xs text-rose-300 font-mono bg-rose-950/60 p-3 rounded-xl border border-rose-900 overflow-x-auto">
            {this.state.error?.message || 'Unbekannter UI-Fehler aufgetreten'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-700 flex items-center space-x-2 transition-all shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Erneut versuchen</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
