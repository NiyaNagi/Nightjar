import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './AppNew.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { WorkspaceProvider } from './contexts/WorkspaceContext'
import { FolderProvider } from './contexts/FolderContext'
import { PermissionProvider } from './contexts/PermissionContext'
import { IdentityProvider } from './contexts/IdentityContext'
import { PresenceProvider } from './contexts/PresenceContext'

/**
 * Application providers in dependency order:
 * 1. ErrorBoundary - Catch React render errors (no deps)
 * 2. IdentityProvider - User identity (no deps)
 * 3. WorkspaceProvider - Workspaces (needs identity)
 * 4. FolderProvider - Folders (needs workspace)
 * 5. PermissionProvider - Permissions (needs workspace, folder)
 * 6. PresenceProvider - Presence/collaboration (needs identity, workspace)
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <IdentityProvider>
        <WorkspaceProvider>
          <FolderProvider>
            <PermissionProvider>
              <PresenceProvider>
                <App />
              </PresenceProvider>
            </PermissionProvider>
          </FolderProvider>
        </WorkspaceProvider>
      </IdentityProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
