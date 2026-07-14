import StarterKit from '@tiptap/starter-kit';
import { Mathematics } from '@tiptap/extension-mathematics';
import { CitationNode } from './CitationNode';
import { ImageNode } from './ImageNode';

/**
 * Schema-defining extensions, shared between the live editor (App.tsx) and
 * offline JSON <-> Yjs conversions (docStore.ts). Runtime-only extensions
 * (Placeholder, CharacterCount, Collaboration) don't belong here, but any
 * extension that adds nodes or marks must appear in both places.
 */
export const schemaExtensions = [
  StarterKit.configure({ undoRedo: false }),
  ImageNode,
  CitationNode,
  Mathematics,
];
