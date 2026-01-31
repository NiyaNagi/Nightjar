# Nahma

**Secure P2P Collaboration**

Nahma is a secure, peer-to-peer collaboration platform packaged as a multi-platform desktop application using Electron.

## Architecture

This is a unified Electron application that bundles a Node.js backend and a React frontend.

*   **Backend (Electron Main Process):** A Node.js environment that runs in the background. It manages the connection to the Tor network, establishes a Libp2p peer-to-peer node, and handles the encrypted persistence of the document in a local database.
*   **Frontend (Electron Renderer Process):** A React application providing the rich text editor UI, which is displayed in the main application window. It communicates securely with the backend via Electron's IPC bridge (not WebSockets).

## Prerequisites

1.  **Node.js and npm:** Required for installing and running the application in development mode. [Download here](https://nodejs.org/).
2.  **Tor:** The application requires a running Tor instance to provide anonymity. The easiest way to get this is to install the [Tor Browser](https://www.torproject.org/download/).

---

## How to Run (Development Mode)

This mode is for developers who want to work on the code.

### 1. Start Tor

The application needs to communicate with the Tor daemon on its control port. You must launch the Tor Browser from a terminal with the port enabled.

*   **On macOS:**
    ```bash
    /Applications/Tor\ Browser.app/Contents/MacOS/tor-browser --Tor-ControlPort 9051
    ```
*   **On Linux:**
    ```bash
    ./start-tor-browser.desktop --Tor-ControlPort 9051
    ```
*   **On Windows:** Find the path to `tor.exe` in your Tor Browser installation and run:
    ```powershell
    & "C:\path\to\Tor Browser\Browser\TorBrowser\Tor\tor.exe" -f "C:\path\to\Tor Browser\Browser\TorBrowser\Data\Tor\torrc-defaults" --ControlPort 9051
    ```
**Leave this terminal running.**

### 2. Install Dependencies

Open a terminal in the project's root directory (`Nahma/`) and run:
```bash
npm install
```
This will install all dependencies for both the Electron app and the React frontend.

### 3. Run the App

In the same terminal, run the `dev` command:
```bash
npm run dev
```
This command will concurrently start the React development server and launch the Electron application. The app window will open automatically.

---

## How to Build and Run (Packaged Application)

This is how an end-user would run the application.

### 1. Build the Application

From the project's root directory, run:
```bash
npm run package
```
This command uses `electron-builder` to create a distributable application file for your current operating system (e.g., a `.dmg` for macOS, `.exe` for Windows, `.AppImage` for Linux). The output will be in a new `dist` directory.

### 2. Run the Application

1.  **Start Tor first!** Just like in development mode, you must have the Tor Browser running with its control port enabled.
2.  Navigate to the `dist` directory.
3.  Double-click the application file (e.g., `Nahma Editor.exe`) to launch it.

---

## How to Use the Editor

1.  When you launch the application, it will automatically connect to the Tor network and generate a unique, secret **Invite Link**.
2.  To start a session with others, copy this link and send it to them via a secure channel.
3.  The other user must have the Nahma Editor application running on their computer.
4.  When they paste the link into their browser and are prompted to open the application, or if they have a mechanism to open it, the key in the link will load the encrypted document and connect them to the P2P session. (Note: A more robust invitation system is a future goal).
5.  You can change your handle in the text box provided. Your cursor and future edits will be attributed to this handle.