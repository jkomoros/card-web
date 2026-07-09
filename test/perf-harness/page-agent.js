/*eslint-env browser*/

//Functions executed IN THE PAGE (serialized into page.evaluate). They may only
//use browser globals and may `import('/lib/src/...js')` (absolute URL — wds
//serves it and rewrites its internal bare specifiers), but must NEVER
//`import('firebase/...')` or any other bare specifier at runtime — the browser
//has no import map and wds does not rewrite a bare specifier from injected code.

//Read load-state + card count. Uses the app's OWN served selectDataIsFullyLoaded
//(which correctly gates on permissionsFinal + userDataLoaded, src/selectors.ts)
//rather than a hand-reconstruction that could report ready before permissions
//resolve.
export const readStateInPage = async () => {
	const store = window.DEBUG_STORE;
	if (!store) return {ready: false, reason: 'no DEBUG_STORE'};
	const selectors = await import('/lib/src/selectors.js');
	const s = store.getState();
	const data = s.data || {};
	//In worker (shadow/on) modes the worker's own signals are the real readiness
	//gate — the main store can hold a cache-primed corpus the worker hasn't
	//finished/blessed. loadComplete = corpus as complete as this connection can
	//make it (BOTH sync modes). syncState is watermark-only: '' in listen mode,
	//'unverified'|'live'|'stale' in watermark. null when no worker (off mode).
	const cw = window.CORPUS_WORKER;
	const syncState = cw ? cw.syncState() : null;
	const workerLoadComplete = cw && cw.loadComplete ? cw.loadComplete() : null;
	return {
		ready: true,
		cardCount: Object.keys(data.cards || {}).length,
		dataFullyLoaded: !!selectors.selectDataIsFullyLoaded(s),
		loadingFetchTypes: Object.keys(data.loadingCardFetchTypes || {}),
		syncState,
		workerLoadComplete,
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
export const waitForCorpus = async (page, {minCards = 1, timeoutMs = 180000, pollMs = 500, requireWorkerLive = false} = {}) => {
	const start = Date.now();
	let last = null;
	while (Date.now() - start < timeoutMs) {
		last = await page.evaluate(readStateInPage);
		const workerReady = !requireWorkerLive || (last.workerLoadComplete === true && last.syncState !== 'unverified');
		if (last.ready && last.dataFullyLoaded && last.cardCount >= minCards && workerReady) return last;
		await page.waitForTimeout(pollMs);
	}
	throw new Error('waitForCorpus timed out after ' + timeoutMs + 'ms; last=' + JSON.stringify(last));
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
