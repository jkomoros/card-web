//#767: while the active collection is the cutover-mode transitional
//placeholder, its isFallback:false is a guess, not a verdict: the worker's
//authoritative result has not arrived. Action-layer guards that act on the
//guess do the wrong thing in both directions — start work they will abandon
//(the auto-read pending animation on every navigation to an orphaned card),
//or, if a cutover ever outlasts their timer, commit the write the guard
//exists to prevent. This module is the shared per-consumer opt-in (#762
//shipped the same idea for the drawer selector): wait for the collection to
//become concrete — immediately in the common case, after a short bounded
//re-check chain during a cutover — and refuse, by rejection, when the
//collection is a real fallback or the cutover never resolves.
//
//Deliberately a leaf module (no imports): callers hand it a view of the
//active collection, which also keeps it trivially testable.

//The two properties of a collection this module reads. Collection itself
//satisfies this structurally.
export type CollectionFallbackView = {
	readonly isTransitional : boolean,
	readonly isFallback : boolean
};

//How often to re-check while the collection is transitional. A healthy
//cutover resolves in well under a second even on huge corpora.
export const TRANSITIONAL_RECHECK_DELAY_MS = 100;

//Give up after this many re-checks (3 seconds): a transition still
//unresolved by then is a broken app, and refusing beats guessing.
export const TRANSITIONAL_MAX_RECHECKS = 30;

//Resolves once the active collection is concrete and interactable. Rejects —
//never silently swallows — when the collection is a real fallback or stays
//transitional past the bound, so callers with user-visible payloads (comment
//posting) can restore them by letting the rejection propagate;
//fire-and-forget callers catch and log. In the common concrete case this
//resolves without ever scheduling a timer.
//A refusal from this guard, carrying a message written FOR THE USER. The tag is
//the contract: callers may show `message` verbatim if and only if the error is
//one of these. Anything else reaching their catch is a real fault and must not
//be rendered.
export class NotInteractableError extends Error {
	constructor(message : string) {
		super(message);
		this.name = 'NotInteractableError';
	}
}

export const awaitInteractableCollection = async (
	getCollection : () => CollectionFallbackView | null,
	recheckDelayMs : number = TRANSITIONAL_RECHECK_DELAY_MS,
	maxRechecks : number = TRANSITIONAL_MAX_RECHECKS
) : Promise<void> => {
	for (let attempt = 0; ; attempt++) {
		const collection = getCollection();
		if (!collection || !collection.isTransitional) {
			//BOTH messages here are shown to the user verbatim by the six actions
			//that await this guard, so they are written as copy, not diagnostics.
			//The old text for this one was "Interacting with fallback content is
			//not allowed" — an HS-1.4 internal-concept leak wrapped around a rule
			//rather than a next step.
			//
			//They are thrown as a TAGGED type so a caller can tell "this is copy I
			//may show" from "something else blew up". Without the tag the six
			//catch blocks were rendering String(err) verbatim in a toast, which is
			//the thing HS-2.4 names outright: a selector TypeError in here would
			//have gone straight to the screen.
			if (collection && collection.isFallback) throw new NotInteractableError('This view is still showing placeholder content, so it\u2019t be changed yet.');
			return;
		}
		if (attempt >= maxRechecks) throw new NotInteractableError('The view is still loading; try again in a moment.');
		await new Promise(resolve => setTimeout(resolve, recheckDelayMs));
	}
};

//What scheduleAutoMarkRead should do given the active collection, pure so
//tests can drive it (#767). Unlike awaitInteractableCollection, the
//auto-read scheduler cannot await: its deferral must ride the same timeout
//handle as the real timer so a navigation's cancel kills both.
//'defer' = re-check shortly WITHOUT starting the pending animation;
//'give-up' = the cutover never resolved, schedule nothing;
//'skip' = real fallback content, never auto-read;
//'schedule' = start the real timer and animation.
export const autoMarkReadScheduleDecision = (
	collection : CollectionFallbackView | null,
	transitionalAttempt : number,
	maxRechecks : number = TRANSITIONAL_MAX_RECHECKS
) : 'defer' | 'give-up' | 'skip' | 'schedule' => {
	if (collection && collection.isTransitional) {
		return transitionalAttempt >= maxRechecks ? 'give-up' : 'defer';
	}
	if (collection && collection.isFallback) return 'skip';
	return 'schedule';
};
