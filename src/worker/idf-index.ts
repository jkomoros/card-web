//The worker-owned IDF index: an incrementally-maintained document-frequency
//map over the worker's own corpus — which is the VISIBLE corpus by
//construction (published listeners for readers; everything for privileged
//viewers), so no scope logic lives here at all. See
//docs/visible-corpus-idf-design.md.
//
//Input vocabulary is the distinct-term set of the same wordCountsForSemantics
//call the TF side makes (via semanticTermsForCard), over un-enriched
//processed cards, body cards only — so document frequency is counted over
//exactly the terms fingerprints score, INCLUDING the overrideExtractor
//reference fields the old server map skipped.
//
//`docFreq` is maintained incrementally: every corpus mutation is O(changed
//card) — decrement the previous card object's distinct terms, increment the
//new one's; terms at zero are removed. A delete NEVER triggers a rebuild.
//`idf` values materialize from docFreq only at epoch publication (<10ms),
//and the published map is FROZEN per epoch: consumers hold one stable
//identity per epoch, which is what keeps the IDFMap-keyed shared fingerprint
//cache session-lived.
//
//DOM-free and store-free, like everything else under src/worker/.

import {
	processCard
} from '../card-processing.js';

import {
	semanticTermsForCard
} from '../nlp.js';

import {
	MAX_N_GRAM_FOR_FINGERPRINT
} from '../../shared/nlp.js';

import {
	BODY_CARD_TYPES
} from '../../shared/card_fields.js';

import {
	Card,
	Cards,
	CardID,
	IDFMap
} from '../types.js';

//Republish when the corpus has drifted this much (relative) from the
//published map's cardCount — the same 10% heuristic the old count-based memo
//asserted. IDF is a slow statistic; anything finer is churn.
export const IDF_REPUBLISH_DRIFT_FRACTION = 0.1;

export class IDFIndex {

	//term -> number of counted body cards containing it at least once.
	_docFreq : Map<string, number>;
	//The exact card OBJECT whose terms are currently counted for each id, so
	//every operation is idempotent and order-safe: an update decrements the
	//recorded object's terms (re-derived via the per-card memo, nearly free)
	//and increments the new one's. Entries are replaced on every update, so
	//old card objects are only retained until their card's next mutation.
	_countedCards : Map<CardID, Card>;
	_bodyCardCount : number;
	//Bumped on every docFreq mutation (diagnostics/tests).
	_version : number;
	//Bumped on every publication; the published map is frozen per epoch.
	_epoch : number;
	_published : IDFMap | null;
	_publishedCardCount : number;
	//How many times a card's term set was derived — the property tests use
	//this to prove a delete is O(one card), not a rebuild.
	_termExtractions : number;

	constructor() {
		this._docFreq = new Map();
		this._countedCards = new Map();
		this._bodyCardCount = 0;
		this._version = 0;
		this._epoch = 0;
		this._published = null;
		this._publishedCardCount = 0;
		this._termExtractions = 0;
	}

	get bodyCardCount() : number {
		return this._bodyCardCount;
	}

	get version() : number {
		return this._version;
	}

	get epoch() : number {
		return this._epoch;
	}

	//The frozen per-epoch map (null before the first publication).
	get publishedMap() : IDFMap | null {
		return this._published;
	}

	get publishedCardCount() : number {
		return this._publishedCardCount;
	}

	get termExtractionCount() : number {
		return this._termExtractions;
	}

	//The card object currently counted for this id (tests + the build loop's
	//already-counted skip).
	countedCard(id : CardID) : Card | undefined {
		return this._countedCards.get(id);
	}

	_termsFor(card : Card, allCards : Cards) : string[] {
		this._termExtractions++;
		return semanticTermsForCard(processCard(card, allCards), MAX_N_GRAM_FOR_FINGERPRINT);
	}

	//The single mutation entry point: pass the corpus's CURRENT card object
	//for id (or null for a removal) plus the corpus view to resolve
	//reference/fallback text against. Idempotent on object identity, so the
	//sliced initial build, the mid-build dirty-drain, and steady-state
	//incremental updates can all call it in any interleaving without double
	//counting.
	updateCard(id : CardID, card : Card | null, allCards : Cards) : void {
		const previous = this._countedCards.get(id) || null;
		if (previous === card) return;
		if (previous && BODY_CARD_TYPES[previous.card_type]) {
			for (const term of this._termsFor(previous, allCards)) {
				const df = this._docFreq.get(term);
				if (df === undefined) continue;
				//Terms at zero are REMOVED, not kept at zero — the map's size
				//is the live vocabulary.
				if (df <= 1) this._docFreq.delete(term);
				else this._docFreq.set(term, df - 1);
			}
			this._bodyCardCount--;
			this._version++;
		}
		if (card) {
			this._countedCards.set(id, card);
			if (BODY_CARD_TYPES[card.card_type]) {
				for (const term of this._termsFor(card, allCards)) {
					this._docFreq.set(term, (this._docFreq.get(term) || 0) + 1);
				}
				this._bodyCardCount++;
				this._version++;
			}
		} else {
			this._countedCards.delete(id);
		}
	}

	//Drop every count (a full rebuild is about to recount, e.g. a console
	//refresh healing accumulated cross-card reference drift) while KEEPING the
	//published map: consumers hold the frozen epoch until the new publication
	//replaces it.
	resetCounts() : void {
		this._docFreq = new Map();
		this._countedCards = new Map();
		this._bodyCardCount = 0;
		this._version++;
	}

	//Full teardown for a scope/generation change: nothing from the old
	//authorization world may survive, including the published map.
	reset() : void {
		this.resetCounts();
		this._published = null;
		this._publishedCardCount = 0;
	}

	//True when the corpus has drifted enough from the published map's
	//cardCount that the epoch should roll.
	cardCountDriftExceeded(fraction : number = IDF_REPUBLISH_DRIFT_FRACTION) : boolean {
		if (!this._published) return false;
		const published = this._publishedCardCount;
		if (!published) return this._bodyCardCount > 0;
		return Math.abs(this._bodyCardCount - published) > published * fraction;
	}

	//Materializes an IDFMap from docFreq — same formula as
	//calcIDFMapForCards: log10(N / (df + 1)). maxIDF is computed over the FULL
	//vocabulary; when trimSingletons is set, df==1 terms are then dropped from
	//the returned idf object only. A singleton's idf IS (approximately) the
	//untrimmed maxIDF, and absent terms already score maxIDF — so the trim is
	//semantically near-lossless while typically halving-or-better the shipped
	//vocabulary. Tests use trimSingletons:false to compare against the
	//calcIDFMapForCards ground truth exactly.
	materializedMap(trimSingletons = true) : IDFMap {
		const numCards = this._bodyCardCount;
		const idf : {[word : string] : number} = {};
		let maxIDF = 0;
		if (numCards > 0) {
			for (const [term, df] of this._docFreq.entries()) {
				const value = Math.log10(numCards / (df + 1));
				if (value > maxIDF) maxIDF = value;
				if (trimSingletons && df === 1) continue;
				idf[term] = value;
			}
		}
		return {idf, maxIDF};
	}

	//Publishes a new frozen epoch: materialize (trimmed), record its identity
	//and cardCount, bump the epoch. <10ms even at large vocabularies — this is
	//a walk over docFreq, not a recount of any card.
	publish() : IDFMap {
		this._published = this.materializedMap();
		this._publishedCardCount = this._bodyCardCount;
		this._epoch++;
		return this._published;
	}
}
