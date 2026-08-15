//The coherence rule for per-card async-derived UI sections (the card-info
//rail's reference blocks and word cloud, and the card face's primary
//reference blocks).
//
//THE PRINCIPLE: a section renders exactly one card's datum at a time. During
//a card transition it may show either (a) the previously-committed card's
//datum, explicitly styled with the house "updating" dim, or (b) the incoming
//card's datum once that datum was verifiably computed FOR the incoming card
//— and never a datum keyed to any other card, and never an empty flash
//between two real values. Per section, a transition swaps from (a) to (b) at
//most once; refinements of (b) (e.g., preview similarity upgrading to
//embedding similarity) may update in place but must still be keyed to the
//active card. Sync sections swap instantly with no added latency; async
//sections hold the dimmed previous value until their first for-this-card
//result arrives, at its natural arrival time.
//
//The mechanics are two tiny pure functions so the whole contract is
//Node-testable (test/section-coherence) without a DOM, in the same shape as
//corpus-status-glyph: components just render what these return.

//A section's committed snapshot: the value it last rendered undimmed, and
//which card that value was computed for ('' = nothing committed yet).
export type SectionSnapshot<T> = {
	forCardID : string,
	value : T
};

//What a section should render right now.
export type SectionRender<T> = {
	value : T,
	//True when the value belongs to a previous card and must render with the
	//stale/updating dim. Never true for the empty value.
	stale : boolean
};

//Whether an async result computed for resultForCardID may be committed while
//activeCardID is the active card. Only an exact match commits: results keyed
//to any other card — including '' / no card — must be dropped, never
//rendered. This is the gate that keeps a late-arriving previous-card result
//(worker roundtrip, similarity fetch, teardown fallback) from ever flashing
//under the new card.
export const sectionResultCommits = (resultForCardID : string, activeCardID : string) : boolean =>
	Boolean(resultForCardID) && resultForCardID === activeCardID;

//What a section renders for the active card given its committed snapshot:
//- nothing committed yet -> the section's empty state, undimmed (there is no
//  previous value worth holding);
//- committed for the active card -> the value, undimmed;
//- committed for a different card -> hold that previous value, dimmed as
//  stale, until a for-this-card result commits (stale-while-revalidate, the
//  same philosophy as Collection.handoff and the drawer's 'updating' dim).
export const sectionRender = <T>(snapshot : SectionSnapshot<T>, activeCardID : string, emptyValue : T) : SectionRender<T> => {
	if (!snapshot.forCardID) return {value: emptyValue, stale: false};
	if (snapshot.forCardID === activeCardID) return {value: snapshot.value, stale: false};
	return {value: snapshot.value, stale: true};
};
