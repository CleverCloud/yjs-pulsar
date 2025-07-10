import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(`ws://${location.hostname}:8080`, 'tiptap-demo-doc', ydoc);

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
        name: `User ${Math.floor(Math.random() * 100)}`,
        color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      },
    }),
  ],
});

(window as any).editor = editor;
(window as any).provider = provider;
