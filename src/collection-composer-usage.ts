//WHAT THIS USER ACTUALLY PICKS, REMEMBERED.
//
//The owner's round-2 model for the palette is one ranked list over the whole
//vocabulary, "sorting them by how likely you are to have used them" — and the
//only honest evidence for that is what they have used. The recents store next
//door remembers COLLECTIONS the user visited, which is a different fact: it says
//where they went, not which of the two hundred nameable things they reach for
//when they type. A person who adds `Tagged Systems` twenty times and has never
//once opened a saved collection made of it gets nothing from recents and
//everything from here.
//
//SHAPE: an exponentially-decayed counter per key, which is frequency and recency
//in one number rather than two competing ones.
//
//    on accept:  score = score * 0.5^(age / HALF_LIFE) + 1
//    on read:    weight = score * 0.5^(age / HALF_LIFE)
//
//The decay is applied lazily at both ends against the same stored `at`, so a key
//accepted ten times last year and a key accepted twice yesterday rank the way a
//person would expect, and the store is O(1) per key — no list of timestamps to
//grow, prune, or migrate.
//
//DETERMINISM. The decay's only clock input is the `now` the caller passes, and
//the composer passes ONE `now` per session (fixed when the dialog opens), so a
//list cannot re-rank underneath the user mid-keystroke and a test can pin the
//order exactly. This is the same discipline the frozen palette order keeps for
//counts, applied one layer down.
//
//SCOPE IS THE UID, exactly as collection-composer-history scopes its recents,
//because this is a statement about a person and a shared browser has more than
//one. Signed out is the 'public' scope, same spelling, same reason.
//
//IT IS AN ENHANCEMENT AND IT NEVER THROWS. Every read and write is wrapped:
//quota exhaustion, a private window with storage disabled, or a corrupted value
//costs the ranking its personalization and costs the composer nothing else.

import {
	CollectionDescription,
	collectionDescriptionWithSet,
} from './collection_description.js';

import {
	SET_NAMES,
} from '../shared/collection_description_base.js';

import {
	SetName,
} from '../shared/types.js';

//THE SET THE APP BOOTS TO. Not a choice anybody made — see
//collectionDescriptionStartsFromAppDefault below, which is the whole reason this
//constant is named here rather than spelled 'main' inline.
const APP_DEFAULT_SET : SetName = SET_NAMES[0];

const USAGE_STORAGE_PREFIX = 'collection-composer-usage:';
const SET_STORAGE_PREFIX = 'collection-composer-set:';

//THIRTY DAYS. Short enough that a month of not reaching for something visibly
//demotes it; long enough that a week away from the app does not reset who you
//are. It is a half-life rather than a window because a window has an edge, and
//an edge means a row that silently changes rank at midnight.
export const USAGE_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

//How many keys one person's store may hold. The vocabulary is a few hundred
//entries and nobody accepts more than a fraction of it; the cap exists so a
//scripted session cannot grow an unbounded localStorage value.
const MAX_USAGE_KEYS = 250;

//THE SET THE COMPOSER STARTS FROM when a composition begins at the app's own
//default view. Everything is the initial answer because a composition that
//begins from `main` — the default section set — is almost never a refinement OF
//main; the user is about to say what they want out of the whole corpus, and
//`main` silently narrows it before they have typed anything.
export const DEFAULT_STICKY_SET = 'everything';

export type CompletionUsageEntry = {
	key : string;
	//The decayed count as of `at`.
	score : number;
	//When the score was last written, in epoch millis.
	at : number;
};

export type CompletionUsageWeights = Readonly<Record<string, number>>;

const storageKey = (prefix : string, scope : string) : string =>
	prefix + encodeURIComponent(scope || 'public');

const decayed = (score : number, from : number, now : number) : number => {
	if (!(score > 0)) return 0;
	//A clock that went backwards (a stored future timestamp, a machine whose
	//time was corrected) must not AMPLIFY a score. Age is clamped at zero.
	const age = Math.max(0, now - from);
	if (!age) return score;
	return score * Math.pow(0.5, age / USAGE_HALF_LIFE_MS);
};

const normalizedEntry = (value : unknown) : CompletionUsageEntry | null => {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<CompletionUsageEntry>;
	if (typeof candidate.key !== 'string' || !candidate.key) return null;
	if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score) || candidate.score <= 0) return null;
	if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return null;
	return {key: candidate.key, score: candidate.score, at: candidate.at};
};

//Parsing is keyed on the exact string that produced it, so a write from another
//tab still invalidates the cache while a repeated read inside one render costs
//only the getItem. Same idiom as the recents store.
const parsedCache = new Map<string, {raw : string | null, entries : CompletionUsageEntry[]}>();

export const readCompletionUsage = (scope = '') : CompletionUsageEntry[] => {
	if (typeof window === 'undefined') return [];
	try {
		const key = storageKey(USAGE_STORAGE_PREFIX, scope);
		const raw = window.localStorage.getItem(key);
		const cached = parsedCache.get(key);
		if (cached && cached.raw === raw) return cached.entries;
		const entries : CompletionUsageEntry[] = [];
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				const seen = new Set<string>();
				for (const value of parsed) {
					const entry = normalizedEntry(value);
					if (!entry || seen.has(entry.key)) continue;
					seen.add(entry.key);
					entries.push(entry);
					if (entries.length >= MAX_USAGE_KEYS) break;
				}
			}
		}
		parsedCache.set(key, {raw, entries});
		return entries;
	} catch {
		return [];
	}
};

//THE MAP THE RANKING CONSUMES: key -> decayed weight, as of `now`. Returned as a
//plain object with a stable identity per (storage value, now) so the completion
//index's memos can key on it.
let weightsMemo : {entries : CompletionUsageEntry[], now : number, weights : CompletionUsageWeights} | null = null;

export const completionUsageWeights = (scope = '', now = Date.now()) : CompletionUsageWeights => {
	const entries = readCompletionUsage(scope);
	if (weightsMemo && weightsMemo.entries === entries && weightsMemo.now === now) return weightsMemo.weights;
	const weights : Record<string, number> = {};
	for (const entry of entries) {
		const weight = decayed(entry.score, entry.at, now);
		//A weight that has decayed below a hundredth of one acceptance is not
		//evidence any more; leaving it in only adds noise to the normalization
		//below it.
		if (weight < 0.01) continue;
		weights[entry.key] = weight;
	}
	weightsMemo = {entries, now, weights};
	return weights;
};

//ONE ACCEPTANCE. Called when the user CHOOSES a row — not when they highlight
//one, and not when the palette merely offers it. The distinction is the whole
//value of the signal: a list that learned from what it showed you would converge
//on whatever it happened to show you first.
export const recordCompletionAcceptance = (usageKey : string, scope = '', now = Date.now()) : void => {
	if (typeof window === 'undefined') return;
	if (!usageKey) return;
	try {
		const key = storageKey(USAGE_STORAGE_PREFIX, scope);
		const entries = readCompletionUsage(scope);
		const existing = entries.find(entry => entry.key === usageKey);
		const score = (existing ? decayed(existing.score, existing.at, now) : 0) + 1;
		const next = [
			{key: usageKey, score, at: now},
			...entries.filter(entry => entry.key !== usageKey),
		];
		//Prune by CURRENT weight rather than by stored score: a large stale score
		//is worth less than a small fresh one, and pruning on the raw number
		//would evict exactly the keys the ranking is about to want.
		const pruned = next.length <= MAX_USAGE_KEYS ? next : [...next]
			.sort((left, right) => decayed(right.score, right.at, now) - decayed(left.score, left.at, now))
			.slice(0, MAX_USAGE_KEYS);
		const raw = JSON.stringify(pruned);
		window.localStorage.setItem(key, raw);
		parsedCache.set(key, {raw, entries: pruned});
	} catch {
		//Personalization is an enhancement and must never block a composition.
	}
};

//--- The sticky starting set ------------------------------------------------

//WHICH SET A FRESH COMPOSITION STARTS FROM, remembered. The spec's principle 1 —
//refining an existing collection begins from where the user is — is untouched by
//this: it applies ONLY when the composition begins at the app's own default view,
//where there is no "where the user is" to preserve. The word is always visible in
//the sentence and switching it is one typed word or one click, so this is a
//default rather than a decision taken away from anybody.
export const readStickyComposerSet = (scope = '', legalSets : readonly string[] = []) : string => {
	if (typeof window === 'undefined') return DEFAULT_STICKY_SET;
	try {
		const value = window.localStorage.getItem(storageKey(SET_STORAGE_PREFIX, scope));
		if (!value) return DEFAULT_STICKY_SET;
		//A set name this build no longer has is not a preference, it is a stale
		//string; the default is the honest answer.
		if (legalSets.length && !legalSets.includes(value)) return DEFAULT_STICKY_SET;
		return value;
	} catch {
		return DEFAULT_STICKY_SET;
	}
};

//WHERE A COMPOSITION STARTS FROM, decided once, at the moment the composer
//opens.
//
//The spec's principle 1 — refining an existing collection begins from where the
//user is — is preserved exactly: this fires ONLY when the draft is the app's own
//bare default view (the `main` set, not explicitly chosen, with no conditions on
//it), which is the one state where there is no "where the user is" to preserve.
//`main` in that state is not a choice anybody made; it is the URL the app boots
//to. Composing from it silently narrowed every subsequent clause to the
//published sections before the user had typed anything, and the count they got
//was smaller than the corpus for a reason nothing on screen explained.
//
//"BARE MAIN, NO FILTERS" — and deliberately NOT "…and the URL did not say
//'main'". The app's own default view spells its set in the path (`/c/main/`), so
//an explicitly-set flag would make this fire nowhere at all; and a user standing
//on bare `main` with no conditions is in the app's default view whether they
//arrived by booting or by clicking home. There is nothing composed there to
//preserve, which is the whole test.
export const collectionDescriptionStartsFromAppDefault = (description : CollectionDescription) : boolean =>
	description.set === APP_DEFAULT_SET &&
	!description.filters.length;

//SUPERSEDED SIGNATURE (round-3 tightness, M6). This took (before, after,
//stickySet) and answered "what should this EDIT become", because the rewrite was
//deferred to the first condition — a composer opened and closed without an edit
//was meant to leave the draft exactly as it found it.
//
//The cost of that deferral was two values for one fact: the sentence rendered the
//set the draft still had (`Main`) while the first edit committed the set it was
//about to get (`everything`), and every count in between belonged to whichever of
//the two its caller happened to reach for. So the question is asked once, of the
//draft alone, at the moment the composer opens: from then on the description IS
//the answer and nothing downstream has to re-derive it. Escape still discards the
//whole draft, which is what "leaves it as it found it" was protecting.
export const collectionDescriptionWithStickyStart = (
	description : CollectionDescription,
	stickySet : string
) : CollectionDescription => {
	if (!collectionDescriptionStartsFromAppDefault(description)) return description;
	if (!stickySet || stickySet === description.set) return description;
	return collectionDescriptionWithSet(description, stickySet as SetName);
};

export const recordStickyComposerSet = (setName : string, scope = '') : void => {
	if (typeof window === 'undefined') return;
	if (!setName) return;
	try {
		window.localStorage.setItem(storageKey(SET_STORAGE_PREFIX, scope), setName);
	} catch {
		//As above: an enhancement.
	}
};
