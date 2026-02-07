import React from 'react';

/**
 * Global Error Boundary component to catch and display React rendering errors.
 * Prevents the entire application from crashing when a component throws an error.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console with component stack
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    
    this.setState({ errorInfo });
    
    // Could also log to external error tracking service here
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  handleCopyLogs = async () => {
    const { error, errorInfo } = this.state;
    
    // Gather diagnostic info
    const diagnosticInfo = [
      '=== Nightjar Error Report ===',
      `Timestamp: ${new Date().toISOString()}`,
      `User Agent: ${navigator.userAgent}`,
      `Platform: ${navigator.platform}`,
      `URL: ${window.location.href}`,
      '',
      '=== Error ===',
      error?.toString() || 'Unknown error',
      '',
      '=== Stack Trace ===',
      error?.stack || 'No stack trace available',
      '',
      '=== Component Stack ===',
      errorInfo?.componentStack || 'No component stack available',
    ].join('\n');
    
    try {
      await navigator.clipboard.writeText(diagnosticInfo);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (e) {
      console.error('Failed to copy to clipboard:', e);
      // Fallback: select text in a textarea
      const textarea = document.createElement('textarea');
      textarea.value = diagnosticInfo;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  render() {
    if (this.state.hasError) {
      // Render fallback UI
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '20px',
          backgroundColor: '#1a1a2e',
          color: '#eee',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            maxWidth: '600px',
            textAlign: 'center',
          }}>
            <h1 style={{ color: '#ff6b6b', marginBottom: '16px' }}>
              Something went wrong
            </h1>
            <p style={{ color: '#aaa', marginBottom: '24px' }}>
              The application encountered an unexpected error. 
              Your data has been saved and you can safely reload.
            </p>
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#4a90d9',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  cursor: 'pointer',
                }}
                aria-label="Reload the application"
              >
                Reload Application
              </button>
              <button
                onClick={this.handleReset}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#333',
                  color: 'white',
                  border: '1px solid #555',
                  borderRadius: '8px',
                  fontSize: '16px',
                  cursor: 'pointer',
                }}
                aria-label="Try to continue without reloading"
              >
                Try to Continue
              </button>
              <button
                onClick={this.handleCopyLogs}
                style={{
                  padding: '12px 24px',
                  backgroundColor: this.state.copied ? '#22c55e' : '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                aria-label="Copy diagnostic information to clipboard"
              >
                {this.state.copied ? '✓ Copied!' : '📋 Copy Diagnostic Info'}
              </button>
            </div>

            {this.state.error && (
              <details style={{
                marginTop: '32px',
                textAlign: 'left',
                backgroundColor: '#2a2a3e',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid #444',
              }}>
                <summary style={{ cursor: 'pointer', color: '#ff6b6b', marginBottom: '8px' }}>
                  Error Details
                </summary>
                <pre style={{
                  fontSize: '12px',
                  color: '#ff9999',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                  maxHeight: '300px',
                  overflow: 'auto',
                }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
