//Leaf indirection for the similar-card filters' fetch-trigger side effect.
//filters.ts runs in BOTH the main thread and the corpus worker; it must not
//import actions/similarity.js (whose import graph reaches the store and lit
//components — `window is not defined` in a worker, observed live as repeated
//pageerrors, silently dropping every similarity fetch in worker modes).
//Instead each environment installs its own handler at bootstrap: the main
//thread dynamically imports the real actions; the corpus worker forwards the
//request to the main thread over the bridge.

import {
	CardID,
	ProcessedCard
} from './types.js';

export type SimilarityRequestHandler = (cardID : CardID, editingCard? : ProcessedCard) => void;

let handler : SimilarityRequestHandler | null = null;

export const setSimilarityRequestHandler = (newHandler : SimilarityRequestHandler) => {
	handler = newHandler;
};

//Returns true if a handler is installed (i.e. someone will actually kick off
//the fetch) — mirrors the old return contract of the inline import.
export const requestSimilarity = (cardID : CardID, editingCard? : ProcessedCard) : boolean => {
	if (!handler) return false;
	handler(cardID, editingCard);
	return true;
};
