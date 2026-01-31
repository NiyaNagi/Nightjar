import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './AppNew.jsx'
import { WorkspaceProvider } from './contexts/WorkspaceContext'
import { FolderProvider } from './contexts/FolderContext'
import { PermissionProvider } from './contexts/PermissionContext'
import { IdentityProvider } from './contexts/IdentityContext'
import { PresenceProvider } from './contexts/PresenceContext'

/**
 * Application providers in dependency order:
 * 1. IdentityProvider - User identity (no deps)
 * 2. WorkspaceProvider - Workspaces (needs identity)
 * 3. FolderProvider - Folders (needs workspace)
 * 4. PermissionProvider - Permissions (needs workspace, folder)
 * 5. PresenceProvider - Presence/collaboration (needs identity, workspace)
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>,
)
