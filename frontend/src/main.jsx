import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './AppNew.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { WorkspaceProvider } from './contexts/WorkspaceContext'
import { WorkspaceSyncProvider } from './contexts/WorkspaceSyncContext'
import { FolderProvider } from './contexts/FolderContext'
import { PermissionProvider } from './contexts/PermissionContext'
import { IdentityProvider } from './contexts/IdentityContext'
import { ToastProvider } from './contexts/ToastContext'
import PermissionWatcher from './components/PermissionWatcher'

// Register PWA service worker (web only — no-op inside Electron / Capacitor)
if ('serviceWorker' in navigator && !window.electronAPI) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onRegisteredSW(swUrl, r) {
        // Check for updates every hour
        if (r) setInterval(() => r.update(), 60 * 60 * 1000);
      },
      onOfflineReady() {
        console.log('[SW] Offline ready');
      },
    });
  }).catch(() => {
    // PWA registration unavailable (e.g. dev mode with devOptions.enabled=false)
  });
}

// Apply saved theme BEFORE first render to prevent flash of wrong theme
// (AppSettings module only loads after identity selection, so IdentitySelector
//  would otherwise always render with the default dark theme)
try {
  const saved = JSON.parse(localStorage.getItem('Nightjar-app-settings') || '{}');
  const theme = saved.theme || 'system';
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (!prefersDark) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch (e) {
  // Ignore - will fall through to default dark theme
}

/**
 * Application providers in dependency order:
 * 1. ErrorBoundary - Catch React render errors (no deps)
 * 2. IdentityProvider - User identity (no deps)
 * 3. WorkspaceProvider - Workspaces (needs identity)
 * 4. WorkspaceSyncProvider - Synced workspace data via Yjs (needs workspace, identity)
 * 5. FolderProvider - Folders (needs workspace, can consume sync data)
 * 6. PermissionProvider - Permissions (needs workspace, folder)
 * 7. ToastProvider - Toast notifications (no deps, but wraps app for access)
 * 
 * Note: PresenceProvider is now inside App where it can receive workspace awareness
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <IdentityProvider>
        <WorkspaceProvider>
          <WorkspaceSyncProvider>
            <FolderProvider>
              <PermissionProvider>
                <ToastProvider>
                  <PermissionWatcher />
                  <App />
                </ToastProvider>
              </PermissionProvider>
            </FolderProvider>
          </WorkspaceSyncProvider>
        </WorkspaceProvider>
      </IdentityProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
