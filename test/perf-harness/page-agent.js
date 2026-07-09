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
	return {
		ready: true,
		cardCount: Object.keys(data.cards || {}).length,
		dataFullyLoaded: !!selectors.selectDataIsFullyLoaded(s),
		user: s.user && s.user.user ? {uid: s.user.user.uid, isAnonymous: s.user.user.isAnonymous} : null,
	};
};

//Runs IN NODE; polls readStateInPage() until fully loaded (or minCards) or timeout.
export const waitForCorpus = async (page, {minCards = 1, timeoutMs = 180000, pollMs = 500} = {}) => {
	const start = Date.now();
	let last = null;
	while (Date.now() - start < timeoutMs) {
		last = await page.evaluate(readStateInPage);
		if (last.ready && last.dataFullyLoaded && last.cardCount >= minCards) return last;
		await page.waitForTimeout(pollMs);
	}
	throw new Error('waitForCorpus timed out after ' + timeoutMs + 'ms; last=' + JSON.stringify(last));
};

//Signs in against the Auth emulator with a fake Google credential through the
//app's OWN served firebase module (which re-exports GoogleAuthProvider +
//signInWithCredential). The emulator does not verify signatures and provisions
//a user whose uid is the token `sub`. Runs IN THE PAGE.
export const signInAsAdminInPage = async ({uid, email}) => {
	const b = (o) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	const header = {alg: 'none', kid: '', typ: 'JWT'};
	const payload = {iss: 'https://accounts.google.com', aud: 'demo-perf', sub: uid, user_id: uid, email, email_verified: true, name: 'Perf Admin', firebase: {sign_in_provider: 'google.com', identities: {'google.com': [uid], email: [email]}}};
	const idToken = `${b(header)}.${b(payload)}.`;
	const fb = await import('/lib/src/firebase.js');
	const res = await fb.signInWithCredential(fb.auth, fb.GoogleAuthProvider.credential(idToken));
	return {uid: res.user.uid, isAnonymous: res.user.isAnonymous};
};
