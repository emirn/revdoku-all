import React from 'react';
import { SUPPORT_EMAIL } from '@/lib/support';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#374151',
        }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem', textAlign: 'center', maxWidth: '24rem' }}>
            An unexpected error occurred. Please reload the page to try again.
          </p>
          {this.state.error && (
            <pre style={{
              fontSize: '0.75rem',
              color: '#9ca3af',
              background: '#f9fafb',
              padding: '0.75rem 1rem',
              borderRadius: '0.375rem',
              marginBottom: '1.5rem',
              maxWidth: '32rem',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
          {SUPPORT_EMAIL && (
            <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '1.5rem', textAlign: 'center' }}>
              If this keeps happening, please contact{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#2563eb', textDecoration: 'underline' }}>
                {SUPPORT_EMAIL}
              </a>
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
