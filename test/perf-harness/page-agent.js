/*eslint-env browser*/

//Functions executed IN THE PAGE (serialized into page.evaluate). They use only
//browser globals and the acceptance hooks installed in the production bundle;
//importing unbundled source here would create a second store/action graph.

//Read load-state + card count. Uses the app's OWN served selectDataIsFullyLoaded
//(which correctly gates on permissionsFinal + userDataLoaded, src/selectors.ts)
//rather than a hand-reconstruction that could report ready before permissions
//resolve.
export const readStateInPage = async () => {
	const store = window.DEBUG_STORE;
	if (!store) return {ready: false, reason: 'no DEBUG_STORE'};
	const s = store.getState();
	const data = s.data || {};
	const userState = s.user || {};
	const userExists = Boolean(userState.user);
	const permissionsFinal = !userState.pending && (!userExists || userState.userPermissionsLoaded);
	const userDataLoaded = !userState.pending && (!userExists || (userState.starsLoaded && userState.readsLoaded && userState.readingListLoaded && userState.userPermissionsLoaded));
	const dataFullyLoaded = permissionsFinal && Object.keys(data.loadingCardFetchTypes || {}).length === 0 && data.sectionsLoaded && data.tagsLoaded && userDataLoaded;
	//In worker (shadow/on) modes the worker's own signals are the real readiness
	//gate — the main store can hold a cache-primed corpus the worker hasn't
	//finished/blessed. loadComplete = corpus as complete as this connection can
	//make it (BOTH sync modes). syncState is watermark-only: '' in listen mode,
	//'unverified'|'live'|'stale' in watermark. null when no worker (off mode).
	const cw = window.CORPUS_WORKER;
	const syncState = cw ? cw.syncState() : null;
	const workerLoadComplete = cw && cw.loadComplete ? cw.loadComplete() : null;
	//The worker's OWN corpus size: distinguishes "worker has the cards but the
	//main store doesn't" (forwarding bug) from "the worker's prime yielded ~0"
	//(the emulator transport collapsed on the cold 40k prime).
	const workerCorpusSize = cw && cw.corpusSize ? cw.corpusSize() : null;
	return {
		ready: true,
		cardCount: Object.keys(data.cards || {}).length,
		dataFullyLoaded: Boolean(dataFullyLoaded),
		loadingFetchTypes: Object.keys(data.loadingCardFetchTypes || {}),
		syncState,
		workerLoadComplete,
		workerCorpusSize,
		user: s.user && s.user.user ? {uid: s.user.user.uid, isAnonymous: s.user.user.isAnonymous} : null,
	};
};

//Runs IN NODE; polls readStateInPage() until fully loaded (or minCards) or timeout.
//requireWorkerLive: in worker (shadow/on) modes, ALSO wait for the worker to
//announce loadComplete AND not be sitting on an unverified (cache-primed, not
//yet trust-blessed) corpus — otherwise the script can fire against a partial /
//untrusted worker corpus and silently inflate the numbers. loadComplete is the
//universal signal (both sync modes); sync==='unverified' only occurs in
//watermark mode, where we additionally require the trust gate to have passed.
export const waitForCorpus = async (page, {minCards = 1, timeoutMs = 180000, pollMs = 500, requireWorkerLive = false, expectedSyncState = null, progressEveryMs = 0} = {}) => {
	const start = Date.now();
	let last = null;
	let lastProgress = 0;
	while (Date.now() - start < timeoutMs) {
		last = await page.evaluate(readStateInPage);
		//Periodic progress so long (40k+) loads aren't a black box until timeout.
		if (progressEveryMs && Date.now() - lastProgress >= progressEveryMs) {
			lastProgress = Date.now();
			console.log('[waitForCorpus] +' + Math.round((Date.now() - start) / 1000) + 's mainCards=' + last.cardCount + ' workerCorpus=' + last.workerCorpusSize + ' loadComplete=' + last.workerLoadComplete + ' syncState="' + last.syncState + '" dataFullyLoaded=' + last.dataFullyLoaded);
		}
		const syncReady = expectedSyncState === null ? (last.syncState === '' || last.syncState === 'live') : last.syncState === expectedSyncState;
		const workerReady = !requireWorkerLive || (last.workerLoadComplete === true && syncReady);
		if (last.ready && last.dataFullyLoaded && last.cardCount >= minCards && workerReady) return last;
		await page.waitForTimeout(pollMs);
	}
	throw new Error('waitForCorpus timed out after ' + timeoutMs + 'ms; last=' + JSON.stringify(last));
};

//Runs IN NODE. After the corpus is loaded the worker does a ONE-TIME cold
//computation of the active collection (at 40k this is many seconds); if the
//interaction script starts before it finishes, that boot-settle cost leaks into
//the measurement window (recorded as a giant collectionPush) and is mis-read as
//a per-interaction cost. Wait until the worker's collection-computation counters
//(collectionPush + runCollection) stop changing for idleMs, so measurement
//starts against a settled worker. No-op in off mode (no worker perf channel).
export const waitForWorkerIdle = async (page, {idleMs = 5000, timeoutMs = 120000, pollMs = 1000} = {}) => {
	const start = Date.now();
	let lastSig = null;
	let stableSince = Date.now();
	let sawActivity = false;
	while (Date.now() - start < timeoutMs) {
		const snap = await page.evaluate(async () => (window.CORPUS_WORKER && window.CORPUS_WORKER.perfData) ? await window.CORPUS_WORKER.perfData() : null);
		if (!snap) return {idle: true, reason: 'no worker'};
		const A = snap.actionStats || {};
		const busy = ['collectionPush', 'runCollection'].map(k => (A[k] ? A[k].count + ':' + Math.round(A[k].totalMs) : '0')).join('|');
		if (busy !== '0|0') sawActivity = true;
		if (busy !== lastSig) { lastSig = busy; stableSince = Date.now(); }
		//Require: (a) at least one full idle window elapsed (so a not-yet-started
		//compute isn't mistaken for idle), and (b) counters stable for idleMs.
		else if (Date.now() - stableSince >= idleMs && Date.now() - start >= idleMs) {
			return {idle: true, sawActivity, sig: busy, waitedMs: Date.now() - start};
		}
		await page.waitForTimeout(pollMs);
	}
	return {idle: false, sawActivity, sig: lastSig, waitedMs: Date.now() - start};
};

//Wait for the worker's background search-recall index build to finish. That
//build (chunked, ~28s on the 12k emulator corpus) does not surface as a
//runCollection/collectionPush in waitForWorkerIdle, but it competes for the
//worker event loop and — combined with CORS-failing similarity retries in
//the emulator — can delay a just-committed card's echo past the interaction
//script's readback window. Settling on it first makes the interaction
//timings attributable and non-flaky.
export const waitForSearchRecallReady = async (page, {timeoutMs = 120000, pollMs = 1000} = {}) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const state = await page.evaluate(() => {
			const recall = window.DEBUG_STORE && window.DEBUG_STORE.getState().find ? window.DEBUG_STORE.getState().find.searchRecall : null;
			//No worker-served collections (off/fallback modes) => nothing to wait for.
			const serves = window.CORPUS_WORKER && window.CORPUS_WORKER.mode && window.CORPUS_WORKER.mode() === 'on';
			return {ready: recall ? recall.ready : null, serves};
		});
		if (!state.serves || state.ready === true) return {ready: true, waitedMs: Date.now() - start};
		await page.waitForTimeout(pollMs);
	}
	return {ready: false, waitedMs: Date.now() - start};
};

//Signs in against the Auth emulator with an unsigned Firebase CUSTOM token
//through the app's OWN served firebase module. Unlike a Google-IdP credential
//(which mints a random uid), a custom token's `uid` claim BECOMES the user's
//uid — so it deterministically matches the seeded permissions/{uid} admin doc.
//The emulator does not verify the signature. Runs IN THE PAGE.
export const signInAsAdminInPage = async ({uid}) => {
	const b = (o) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	const now = Math.floor(Date.now() / 1000);
	const header = {alg: 'none', typ: 'JWT'};
	const payload = {
		iss: 'perf-harness', sub: 'perf-harness',
		aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
		iat: now, exp: now + 3600, uid,
	};
	const token = `${b(header)}.${b(payload)}.`;
	const fb = await import('/lib/src/firebase.js');
	const res = await fb.signInWithCustomToken(fb.auth, token);
	return {uid: res.user.uid, isAnonymous: res.user.isAnonymous};
};
