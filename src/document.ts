//A RE-EXPORT, not a copy.
//
//This file used to be a byte-identical duplicate of shared/document.ts, with
//its own independent module state. A document injected into one was invisible
//to the other, so every test harness had to remember to call overrideDocument
//TWICE — and nothing enforced that. #733 was one harness forgetting: shared/
//helpers under test silently took their no-document fallback branch while the
//browser took the DOM branch, and the two disagree.
//
//The bundle already mixed the two freely (src/util.ts imported shared's while
//src/contenteditable.ts and src/nlp.ts imported this one), so there was never a
//reason for them to be separate — just a duplicate nobody collapsed.
//
//Kept as a re-export rather than deleted so the existing `./document.js`
//imports keep working and so this note has somewhere to live. New code should
//import from shared/document.js directly.
export { overrideDocument, getDocument } from '../shared/document.js';
