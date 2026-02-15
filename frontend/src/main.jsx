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
