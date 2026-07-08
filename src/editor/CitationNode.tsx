import { useSyncExternalStore } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from '@tiptap/react';
import { CitationStore } from '../lib/citationStore';
import { inTextLabel } from '../lib/format';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (citationId: string) => ReturnType;
    };
  }
}

function CitationView({ node, extension, selected }: ReactNodeViewProps) {
  const store = extension.options.store as CitationStore;
  useSyncExternalStore(store.subscribe, () => store.version);

  const id = node.attrs.citationId as string;
  const citation = store.getCitation(id);
  const style = store.getStyle();

  let label: string;
  let missing = false;
  if (!citation) {
    label = '[?]';
    missing = true;
  } else if (style === 'numeric') {
    label = `[${store.getNumber(id) ?? '?'}]`;
  } else {
    label = `(${inTextLabel(citation)})`;
  }

  const classes = ['citation-chip'];
  if (missing) classes.push('citation-missing');
  if (selected) classes.push('citation-selected');

  return (
    <NodeViewWrapper as="span" className={classes.join(' ')}>
      <span
        title={
          citation
            ? [citation.title, citation.journal, citation.year].filter(Boolean).join(' · ')
            : 'Citation removed from bundle'
        }
      >
        {label}
      </span>
    </NodeViewWrapper>
  );
}

export const CitationNode = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { store: new CitationStore() };
  },

  addAttributes() {
    return {
      citationId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-citation-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-citation-id': node.attrs.citationId }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationView);
  },

  addCommands() {
    return {
      insertCitation:
        (citationId: string) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { citationId } },
            { type: 'text', text: ' ' },
          ]),
    };
  },
});
