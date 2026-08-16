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
	updateCard(id : CardID, tokensIn : readonly string[]) : void {
		//UNIGRAMS ONLY. `nlp_search_tokens` carries bigrams (see
		//tools/migrate-nlp-tokens.mjs), but the only production consumer of
		//this index is substringCandidates(), which skips every posting key
		//containing a space — so every bigram posting was built, stored, and
		//scanned without ever being usable. Measured on 40,225 cards: 585k
		//posting keys and 7.08M entries with bigrams versus 41k and 3.25M
		//without, ~3s of every boot's chunked build, and ~190MB of Sets. It
		//also made each narrowing query walk 14x more keys than it can use.
		//candidates() (the CORPUS_WORKER.query console hook) still works, just
		//without bigram precision.
		const tokens = tokensIn.filter(token => !token.includes(' '));
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

	//SUBSTRING union recall: cards with any indexed unigram CONTAINING any of
	//the given words. This is the sound recall for PreparedQuery.cardScore,
	//which matches by substring (nlp.ts stringPropertyScoreForStringSubQuery
	//uses indexOf) — exact-token lookup silently drops mid-typing prefixes
	//('zebr'), typos-with-matches, and words embedded in longer words. Any
	//card that can score contains at least one non-stop query word as a
	//substring of its stemmed text; a spaceless word lies within a single
	//stemmed word, and every stemmed word of a tokenized card is a unigram
	//posting — so scanning only unigram keys (bigram keys add no coverage:
	//their constituent words are also unigram postings for the same cards)
	//yields a true superset of every scorable tokenized card. An EMPTY result
	//is therefore meaningful: no tokenized card can match.
	substringCandidates(words : readonly string[]) : Set<CardID> {
		const result = new Set<CardID>();
		if (!words.length) return result;
		for (const [token, posting] of this._postings) {
			if (token.indexOf(' ') >= 0) continue;
			for (const word of words) {
				if (token.includes(word)) {
					for (const id of posting) result.add(id);
					break;
				}
			}
		}
		return result;
	}
}
