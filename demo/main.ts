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
documentNameInput.value = urlParams.get('doc') || 'default-document';
nicknameInput.value = `User-${Math.floor(Math.random() * 1000)}`;

connectForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const docName = documentNameInput.value;
  const nickname = nicknameInput.value;

  connectContainer.style.display = 'none';
  editorContainer.style.display = 'block';

  // Update URL without reloading
  const newUrl = `${window.location.pathname}?doc=${docName}`;
  window.history.pushState({ path: newUrl }, '', newUrl);

  const ydoc = new Y.Doc();
      const provider = new WebsocketProvider(`ws://${location.host}`, docName, ydoc);

  const editor = new Editor({
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
  });

  (window as any).editor = editor;
  (window as any).provider = provider;
});
