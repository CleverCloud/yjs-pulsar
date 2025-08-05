# Yjs Pulsar Demo

A real-time collaborative text editor demonstrating Yjs integration with Apache Pulsar.

## Features

- 🚀 Real-time collaborative editing
- 👥 Multiple user cursors with names and colors
- 🔄 Automatic synchronization via Apache Pulsar
- 💾 Document persistence
- 🎨 Clean, modern interface with TipTap editor

## How to Run

### 1. Start the Yjs Pulsar Server

First, make sure your `.env` file is configured with Pulsar credentials, then start the server:

```bash
# From the project root
npm run dev
```

The server will start on `http://localhost:8080`

### 2. Start the Demo Frontend

In a separate terminal:

```bash
# From the project root  
npm run demo
```

This will start Vite dev server on `http://localhost:5173`

### 3. Test Collaboration

1. Open `http://localhost:5173` in your browser
2. Enter a document name (e.g., "my-document") and your nickname
3. Click "Connect & Start Editing"
4. Open the same URL in another tab/window
5. Use the same document name but a different nickname
6. Start typing in both editors to see real-time synchronization!

## Architecture

```
Browser Tab 1 ←→ Vite Dev Server ←→ Yjs Pulsar Server ←→ Apache Pulsar ←→ Yjs Pulsar Server ←→ Vite Dev Server ←→ Browser Tab 2
```

- **Frontend**: TipTap editor with Yjs collaboration extensions
- **WebSocket Proxy**: Vite proxies WebSocket connections to the Yjs server
- **Backend**: Yjs Pulsar server handles document synchronization
- **Message Broker**: Apache Pulsar distributes updates between clients

## Debugging

- Open browser DevTools Console to see connection status and sync events
- The demo exposes `window.editor`, `window.provider`, and `window.ydoc` for debugging
- Connection status indicator shows current state (Connecting/Connected/Synced/Error)
- Use the Disconnect button to reset and try again

## Troubleshooting

- **Connection issues**: Make sure the Yjs Pulsar server is running on port 8080
- **Sync problems**: Check the browser console for WebSocket errors
- **Environment**: Verify your `.env` file has valid Pulsar credentials