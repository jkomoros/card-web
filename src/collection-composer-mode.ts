//Leaf module (no app imports) for the Collection Composer rollout capability.
//Keeping this separate lets routing, commands, and components consult the
//same typed switch without creating import cycles.
//
//  'off'      (default) — existing collection navigation only.
//  'dogfood'            — incomplete development/admin slices and parser
//                         shadow diagnostics may be exposed.
//  'on'                 — production-ready composer for normal users.

const LOCAL_STORAGE_KEY = 'collection-composer';
const PREVIEW_LOCAL_STORAGE_KEY = 'collection-composer-preview';
const SESSION_STORAGE_KEY = 'collection-composer-session';
const PREVIEW_SESSION_STORAGE_KEY = 'collection-composer-preview-session';

export type CollectionComposerMode = 'off' | 'dogfood' | 'on';

//THE ANSWER IS CACHED, BECAUSE THE QUESTION IS ASKED FROM RENDER PATHS.
//
//Every read here is two storage reads and a URLSearchParams parse of the URL
//hash, and the callers are not occasional: card-view asks twice per render and
//card-view re-renders on every store change, which puts three storage reads and
//two hash parses on the app's hottest path — paid in full by the flag-OFF
//default, who gets nothing for them. The composer dialog asks again from its
//own render and from `stateChanged`.
//
//WHAT CAN CHANGE THE ANSWER, and therefore what clears the cache: this module's
//own writers, a `storage` event (another tab flipping the flag), a
//`hashchange`, and the window itself being replaced — which is not a browser
//event but is exactly what a test harness does between cases, and getting it
//wrong would make the cache lie to the suite that pins this module.
//
//Deliberately NOT invalidated on `history.replaceState`: the hash override
//seeds session storage on its first read precisely because ordinary collection
//navigation replaces the hash, so after that read the hash is no longer the
//source of truth for it.
let cachedWindow : unknown = null;
let cachedMode : CollectionComposerMode | null = null;

const forgetComposerMode = () : void => {
	cachedMode = null;
};

//Clears the cache when the global `window` is not the one the cache was filled
//against. Called before every read.
const syncComposerModeCacheWindow = () : void => {
	const current = typeof window === 'undefined' ? undefined : window;
	if (cachedWindow === current) return;
	cachedWindow = current;
	forgetComposerMode();
};

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
	window.addEventListener('storage', forgetComposerMode);
	window.addEventListener('hashchange', forgetComposerMode);
}

const computeCollectionComposerMode = (): CollectionComposerMode => {
	if (typeof window === 'undefined') return 'off';
	try {
		const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
		if (value === 'dogfood' || value === 'on') return value;
	} catch {
		//Best effort: capability remains safely disabled.
	}
	try {
		const value = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
		if (value === 'dogfood' || value === 'on') return value;
	} catch {
		//Best effort
	}
	//A tab-scoped development/admin override makes a dogfood URL easy to open
	//and share without changing a browser profile. Seed session storage because
	//ordinary collection navigation correctly replaces the URL hash.
	try {
		const value = new URLSearchParams(window.location?.hash.slice(1) || '').get(
			LOCAL_STORAGE_KEY
		);
		if (value === 'dogfood' || value === 'on') {
			try {
				window.sessionStorage.setItem(SESSION_STORAGE_KEY, value);
			} catch {
				//Best effort
			}
			return value;
		}
	} catch {
		//Best effort
	}
	return 'off';
};

export const readCollectionComposerMode = (): CollectionComposerMode => {
	syncComposerModeCacheWindow();
	if (cachedMode !== null) return cachedMode;
	cachedMode = computeCollectionComposerMode();
	return cachedMode;
};

export const writeCollectionComposerMode = (
	mode: CollectionComposerMode
): void => {
	forgetComposerMode();
	if (typeof window === 'undefined') return;
	try {
		if (mode === 'off') {
			window.localStorage.removeItem(LOCAL_STORAGE_KEY);
			window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
		} else {
			window.localStorage.setItem(LOCAL_STORAGE_KEY, mode);
		}
	} catch {
		//Best effort
	}
};

//The master capability. Dogfood deliberately enables unfinished vertical
//slices without implying that they are ready for normal users.
export const collectionComposerEnabled = (): boolean =>
	readCollectionComposerMode() !== 'off';

export const collectionComposerPublicEnabled = (): boolean =>
	readCollectionComposerMode() === 'on';

//Shadow diagnostics may inspect behavior but must never alter production
//navigation. Keep them limited to the explicit dogfood mode.
export const collectionComposerParserShadowEnabled = (): boolean =>
	readCollectionComposerMode() === 'dogfood';

//DELIBERATELY NOT CACHED, unlike the mode above. This one is read from
//`_refreshPreviewCounts` — a debounced, once-per-list path inside a dialog that
//is open — and never from a component's render, so the reads it saves are worth
//less than the freshness it would give up. The mode is cached because card-view
//asks it twice on every render of every card.
export const collectionComposerPreviewEnabled = (): boolean => {
	if (!collectionComposerEnabled() || typeof window === 'undefined')
		return false;
	try {
		if (window.localStorage.getItem(PREVIEW_LOCAL_STORAGE_KEY) === 'on')
			return true;
		if (window.sessionStorage.getItem(PREVIEW_SESSION_STORAGE_KEY) === 'on') return true;
		const hashEnabled = new URLSearchParams(window.location?.hash.slice(1) || '').get(
			PREVIEW_LOCAL_STORAGE_KEY
		) === 'on';
		if (hashEnabled) window.sessionStorage.setItem(PREVIEW_SESSION_STORAGE_KEY, 'on');
		return hashEnabled;
	} catch {
		return false;
	}
};

export const writeCollectionComposerPreviewEnabled = (
	enabled: boolean
): void => {
	if (typeof window === 'undefined') return;
	try {
		if (enabled) {
			window.localStorage.setItem(PREVIEW_LOCAL_STORAGE_KEY, 'on');
		} else {
			window.localStorage.removeItem(PREVIEW_LOCAL_STORAGE_KEY);
			window.sessionStorage.removeItem(PREVIEW_SESSION_STORAGE_KEY);
		}
	} catch {
		//Best effort
	}
};
