# Release v1.0.43 - Security Hardening & Build Optimizations

## 🔒 Security Enhancements
- **Recovery Phrase Required**: Identity files now require recovery phrase validation before unlocking
- **Hard Cutover Security**: Never auto-loads identity.json on startup - always requires authentication
- **Data Protection**: Type 'DELETE' confirmation required when creating new identity with existing data
- **Workspace Isolation**: Prevents unauthorized access to workspace data on shared devices

## ✨ Onboarding Improvements  
- **Simplified Flow**: Two clear paths - 'Create New Identity' or 'I Have a Recovery Phrase'
- **Smart Validation**: Validates recovery phrase against existing identity before unlock
- **Clear Messaging**: 
  - 🔓 Shows 'Unlocking workspace data...' when restoring with local data
  - 🔑 Shows 'Identity recreated' with recovery instructions when no local data found
- **Success Screens**: Explains workspace recovery options and invite link process

## ⚡ Performance Optimizations
- **GitHub Actions Caching**: 30-50% faster CI/CD builds with Electron build cache
- **Source Maps Disabled**: 5-10% faster production builds, smaller bundle sizes  
- **Optimized Dependencies**: npm ci --prefer-offline for faster installs
- **Dev Build Fix**: Resolved Electron window exit issue in development mode

## 🎨 Visual Updates
- Updated Nightjar logo with improved design
- Enhanced warning dialogs with better visual hierarchy
- Added loading animations for success screens

## 🐛 Bug Fixes
- Fixed Electron dev build premature exit (window creation order)
- Fixed YAML syntax errors in GitHub Actions workflow
- Fixed duplicate onRenameDocument prop warning
- Improved window lifecycle management with better logging

## 📝 Technical Details
- Added validateRecoveryPhrase() function in identity management
- IPC handler for secure phrase validation
- IdentityContext now tracks hasExistingIdentity state
- Enhanced error handling and user feedback throughout onboarding
