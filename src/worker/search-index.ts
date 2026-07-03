//A small inverted index over each card's stored search tokens
//(nlp_search_tokens: stemmed, stop-word-free unigrams and bigrams generated
//at save time). It is used only for candidate RECALL — cheap narrowing from
//the whole corpus to the handful of cards that could possibly match — with
//precision and ranking still owned by the existing PreparedQuery.cardScore
//machinery running over just the candidates. This keeps search semantics
//bit-identical to the full client-side scan while dropping its cost from
//O(corpus) to O(candidates).
//
//Pure data structure: no DOM, no Firestore, no Redux. Runs identically in a
//worker, the main thread, or Node tests.

import {
	CardID
} from '../types.js';

export class SearchIndex {

	_postings : Map<string, Set<CardID>>;
	_cardTokens : Map<CardID, readonly string[]>;

	constructor() {
		this._postings = new Map();
		this._cardTokens = new Map();
	}

	get cardCount() : number {
		return this._cardTokens.size;
	}

	get tokenCount() : number {
		return this._postings.size;
	}

	//Sets (or replaces) the tokens for a card, incrementally updating only the
	//postings that changed.
	updateCard(id : CardID, tokens : readonly string[]) : void {
		const previous = this._cardTokens.get(id);
		if (previous) {
			const next = new Set(tokens);
			for (const token of previous) {
				if (next.has(token)) continue;
				const posting = this._postings.get(token);
				if (!posting) continue;
				posting.delete(id);
				if (posting.size === 0) this._postings.delete(token);
			}
			const prevSet = new Set(previous);
			for (const token of tokens) {
				if (prevSet.has(token)) continue;
				this._addPosting(token, id);
			}
		} else {
			for (const token of tokens) {
				this._addPosting(token, id);
			}
		}
		this._cardTokens.set(id, tokens);
	}

	_addPosting(token : string, id : CardID) : void {
		let posting = this._postings.get(token);
		if (!posting) {
			posting = new Set();
			this._postings.set(token, posting);
		}
		posting.add(id);
	}

	removeCard(id : CardID) : void {
		const tokens = this._cardTokens.get(id);
		if (!tokens) return;
		for (const token of tokens) {
			const posting = this._postings.get(token);
			if (!posting) continue;
			posting.delete(id);
			if (posting.size === 0) this._postings.delete(token);
		}
		this._cardTokens.delete(id);
	}

	//Returns the IDs of cards containing EVERY one of the given tokens
	//(intersection), starting from the rarest token's posting list. Tokens
	//with no postings at all are skipped (they'd otherwise zero out recall for
	//queries containing a typo'd or novel word — precision is the scorer's
	//job, not ours). Returns null when no token has any postings, signaling
	//the caller to fall back to a full scan.
	candidates(tokens : readonly string[]) : Set<CardID> | null {
		const postings : Set<CardID>[] = [];
		for (const token of tokens) {
			const posting = this._postings.get(token);
			if (posting) postings.push(posting);
		}
		if (postings.length === 0) return null;
		postings.sort((a, b) => a.size - b.size);
		const [smallest, ...rest] = postings;
		const result = new Set<CardID>();
		outer: for (const id of smallest) {
			for (const other of rest) {
				if (!other.has(id)) continue outer;
			}
			result.add(id);
		}
		return result;
	}

	//Union recall: cards containing ANY of the tokens. Useful as a relaxation
	//when the intersection is too strict for long queries.
	candidatesUnion(tokens : readonly string[]) : Set<CardID> {
		const result = new Set<CardID>();
		for (const token of tokens) {
			const posting = this._postings.get(token);
			if (!posting) continue;
			for (const id of posting) result.add(id);
		}
		return result;
	}
}
