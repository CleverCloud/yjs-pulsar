import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const connectContainer = document.getElementById('connect-container')!;
const editorContainer = document.getElementById('editor-container')!;
const connectForm = document.getElementById('connect-form') as HTMLFormElement;
const documentNameInput = document.getElementById('document-name') as HTMLInputElement;
const nicknameInput = document.getElementById('nickname') as HTMLInputElement;

// Set initial values
const urlParams = new URLSearchParams(window.location.search);
documentNameInput.value = urlParams.get('doc') || 'demo-document';
nicknameInput.value = `User-${Math.floor(Math.random() * 1000)}`;

let editor: Editor | null = null;
let provider: WebsocketProvider | null = null;

function createStatusElement(): HTMLElement {
  const statusEl = document.createElement('div');
  statusEl.id = 'connection-status';
  statusEl.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: bold;
    color: white;
    background-color: #ffc107;
    z-index: 1000;
  `;
  statusEl.textContent = 'Connecting...';
  document.body.appendChild(statusEl);
  return statusEl;
}

function updateStatus(status: string, color: string) {
  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.style.backgroundColor = color;
  }
}

function createDisconnectButton(): HTMLElement {
  const button = document.createElement('button');
  button.textContent = 'Disconnect';
  button.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    padding: 8px 12px;
    border: none;
    border-radius: 4px;
    background-color: #dc3545;
    color: white;
    cursor: pointer;
    font-size: 12px;
    z-index: 1000;
  `;
  button.onclick = disconnect;
  document.body.appendChild(button);
  return button;
}

function disconnect() {
  if (provider) {
    provider.destroy();
    provider = null;
  }
  if (editor) {
    editor.destroy();
    editor = null;
  }
  
  // Remove status elements
  document.getElementById('connection-status')?.remove();
  document.getElementById('disconnect-button')?.remove();
  
  // Show connect form again
  connectContainer.style.display = 'block';
  editorContainer.style.display = 'none';
  
  // Clear editor content
  const appEl = document.querySelector('#app');
  if (appEl) {
    appEl.innerHTML = '';
  }
}

connectForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const docName = documentNameInput.value.trim();
  const nickname = nicknameInput.value.trim();
  
  if (!docName || !nickname) {
    alert('Please enter both document name and nickname');
    return;
  }

  connectContainer.style.display = 'none';
  editorContainer.style.display = 'block';
  
  // Update header info
  const docNameEl = document.getElementById('doc-name');
  const userNameEl = document.getElementById('user-name');
  if (docNameEl) docNameEl.textContent = docName;
  if (userNameEl) userNameEl.textContent = nickname;

  // Update URL without reloading
  const newUrl = `${window.location.pathname}?doc=${encodeURIComponent(docName)}`;
  window.history.pushState({ path: newUrl }, '', newUrl);

  // Create status indicator
  const statusEl = createStatusElement();
  const disconnectBtn = createDisconnectButton();
  disconnectBtn.id = 'disconnect-button';

  const ydoc = new Y.Doc();
  
  // Create provider with proper WebSocket URL
  // The Vite proxy will forward WebSocket connections to your server
  provider = new WebsocketProvider(`ws://${location.host}`, docName, ydoc);

  // Set up provider event listeners
  provider.on('status', ({ status }: { status: string }) => {
    console.log('Provider status:', status);
    switch (status) {
      case 'connecting':
        updateStatus('Connecting...', '#ffc107');
        break;
      case 'connected':
        updateStatus('Connected', '#28a745');
        break;
      case 'disconnected':
        updateStatus('Disconnected', '#dc3545');
        break;
    }
  });

  provider.on('sync', (isSynced: boolean) => {
    console.log('Sync status:', isSynced);
    if (isSynced) {
      updateStatus('Synced', '#28a745');
    }
  });

  // Handle connection errors
  provider.on('connection-error', (error: any) => {
    console.error('Connection error:', error);
    updateStatus('Connection Error', '#dc3545');
  });

  // Create editor
  editor = new Editor({
    element: document.querySelector('#app')!,
    extensions: [
      StarterKit.configure({
        history: false, // Yjs handles history
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCursor.configure({
        provider: provider,
        user: {
          name: nickname,
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
        },
      }),
    ],
    content: '<p>Start typing to see real-time collaboration in action!</p>',
  });

  // Make available globally for debugging
  (window as any).editor = editor;
  (window as any).provider = provider;
  (window as any).ydoc = ydoc;
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const docFromUrl = urlParams.get('doc');
  if (docFromUrl) {
    documentNameInput.value = docFromUrl;
  }
});
