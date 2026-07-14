// Sanity check for the CRDT layer: JSON -> Y.Doc -> JSON round-trip and
// a concurrent-edit merge. Run with: node scripts/crdt-smoke.mjs
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';

const schema = getSchema([StarterKit.configure({ undoRedo: false })]);

const content = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Alpha paragraph.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Beta paragraph.' }] },
  ],
};

// 1. Round-trip
const ydocA = new Y.Doc();
prosemirrorJSONToYXmlFragment(schema, content, ydocA.getXmlFragment('content'));
const roundTrip = yXmlFragmentToProsemirrorJSON(ydocA.getXmlFragment('content'));
const rtOk = JSON.stringify(roundTrip) === JSON.stringify(content);
console.log('round-trip:', rtOk ? 'OK' : 'MISMATCH');
if (!rtOk) {
  console.log(JSON.stringify(roundTrip, null, 2));
  process.exit(1);
}

// 2. Fork into a second doc (simulates another device pulling state)
const ydocB = new Y.Doc();
Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));

// 3. Concurrent edits: A edits paragraph 1, B edits paragraph 2
ydocA.getXmlFragment('content').get(0).get(0).insert(0, 'A-EDIT ');
ydocB.getXmlFragment('content').get(1).get(0).insert(0, 'B-EDIT ');

// 4. Merge both ways (same as mergeRemoteState + push)
Y.applyUpdate(ydocA, Y.encodeStateAsUpdate(ydocB));
Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));

const finalA = yXmlFragmentToProsemirrorJSON(ydocA.getXmlFragment('content'));
const finalB = yXmlFragmentToProsemirrorJSON(ydocB.getXmlFragment('content'));
const converged = JSON.stringify(finalA) === JSON.stringify(finalB);
const t1 = finalA.content[0].content[0].text;
const t2 = finalA.content[1].content[0].text;
const mergedOk = t1 === 'A-EDIT Alpha paragraph.' && t2 === 'B-EDIT Beta paragraph.';
console.log('converged:', converged ? 'OK' : 'MISMATCH');
console.log('both edits kept:', mergedOk ? 'OK' : `MISMATCH (${t1} | ${t2})`);

// 5. State-vector diff check (mirrors hasLocalChanges)
const svB = Y.encodeStateVector(ydocB);
const noDiff = Y.encodeStateAsUpdate(ydocA, svB).byteLength <= 2;
console.log('no phantom diff after merge:', noDiff ? 'OK' : 'MISMATCH');

process.exit(converged && mergedOk && noDiff ? 0 : 1);
