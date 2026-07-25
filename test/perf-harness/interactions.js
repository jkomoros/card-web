/*eslint-env node*/

//Drives the Appendix-A interactions and captures the AUTHORITATIVE main-thread
//cost from the app's own perfMiddleware (DEBUG_PERF.data().actionStats
//['dispatch:<TYPE>'] = {count, totalMs, maxMs}; avg = totalMs/count). Node-side
//wall-clock (timed) includes Playwright IPC and is a coarse upper bound only;
//commit/find wall-clock is additionally emulator-optimistic (near-zero local
//write-echo) — NOT budget-authoritative.
//
//Two robustness lessons baked in (learned against the running app):
// - Playwright's CSS locator does NOT reliably pierce this app's nested Lit
//   shadow roots; a manual shadowRoot deep-walk inside page.evaluate does. So
//   the body is found/focused via deep-walk, not a locator.
// - Interleaving page.evaluate with keyboard nav that pushStates races the
//   navigation ("Execution context destroyed"). So nav+echo is one atomic
//   dispatch (navigateToNextCard + markActiveCardReadIfLoggedIn), which drives
//   the same SHOW_CARD + UPDATE_READS -> makeFilterFromCards path the budget
//   cares about.

const stat = (actionStats, type) => {
	const s = actionStats && actionStats['dispatch:' + type];
	if (!s || !s.count) return null;
	return {count: s.count, avgMs: +(s.totalMs / s.count).toFixed(2), maxMs: +s.maxMs.toFixed(2)};
};
const rawStat = (actionStats, name) => {
	const s = actionStats && actionStats[name];
	if (!s || !s.count) return null;
	return {count: s.count, avgMs: +(s.totalMs / s.count).toFixed(2), maxMs: +s.maxMs.toFixed(2)};
};
//Worker-scoped stats use raw phase labels (no 'dispatch:' prefix — they aren't
//Redux dispatches). Same {count,totalMs,maxMs} shape as src/perf.ts actionStats.
const wstat = (workerStats, label) => {
	const s = workerStats && workerStats[label];
	if (!s || !s.count) return null;
	return {count: s.count, avgMs: +(s.totalMs / s.count).toFixed(2), maxMs: +s.maxMs.toFixed(2)};
};
const timed = async (fn) => { const t = Date.now(); await fn(); return Date.now() - t; };
const pctl = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(2); };
const wall = (a) => ({n: a.length, p50: pctl(a, 50), p95: pctl(a, 95), max: a.length ? +Math.max(...a).toFixed(2) : null});

//Poll (deep-walk) until the editor's actual body textarea exists. Older
//versions looked for an unrelated contenteditable node and could type into
//the rendered card instead of the editor, producing a false-positive save.
const waitForBody = async (page, timeoutMs = 10000) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const found = await page.evaluate(() => {
			const walk = (root) => { if (root.querySelector('textarea[data-field="body"]')) return true; for (const el of root.querySelectorAll('*')) { if (el.shadowRoot && walk(el.shadowRoot)) return true; } return false; };
			return walk(document);
		});
		if (found) return;
		await page.waitForTimeout(200);
	}
	throw new Error('editor body textarea did not appear within ' + timeoutMs + 'ms');
};

//Focus the editor body (deep-walk). Returns whether it was found.
const focusBody = (page) => page.evaluate(() => {
	const walk = (root) => { const h = root.querySelector('textarea[data-field="body"]'); if (h) return h; for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const r = walk(el.shadowRoot); if (r) return r; } } return null; };
	const b = walk(document); if (b) b.focus();
	return !!b;
});

export const runInteractions = async (page, {keystrokes = 30} = {}) => {
	await page.evaluate(() => {
		if (window.DEBUG_PERF) window.DEBUG_PERF.reset();
		//Worker-mode: zero the worker's timing accumulator too, so worker.* below
		//covers only the interaction script (no-op / absent in off mode).
		if (window.CORPUS_WORKER && window.CORPUS_WORKER.perfReset) window.CORPUS_WORKER.perfReset();
	});
	await page.waitForFunction(() => Boolean(window.PERF_HARNESS));
	const initialCard = await page.evaluate(() => window.PERF_HARNESS.activeRawCard());

	//NOTE on ordering: editingStart is reliable on the boot card but not after a
	//run of direct navigateToNextCard dispatches (a card-view render-timing
	//quirk). The Appendix-A budgets are independent, so we edit/type/commit
	//FIRST (commit closes the editor) and nav AFTER — each measured cleanly.

	//--- Editor open through the visible card action, then select Content. ---
	const editorWall = [await timed(async () => {
		await page.getByTestId('edit-card').click();
		await page.getByTestId('editor-main-content').click();
		await waitForBody(page);
	})];

	//--- 30 keystrokes into the focused body ---
	await focusBody(page);
	const marker = (`perf${Date.now().toString(36)}marker`).padEnd(keystrokes, 'x').slice(0, keystrokes);
	const keyWall = [];
	for (const character of marker) keyWall.push(await timed(() => page.keyboard.type(character)));

	//--- Commit through the visible Save button. Perceived time ends when the
	//blocking editor releases; server time ends only after the durable intent is
	//confirmed and removed. These are intentionally distinct UX promises. ---
	const commitPerceivedWall = [await timed(async () => {
		await page.getByTestId('save-card').click();
		await page.waitForFunction(() => !window.DEBUG_STORE.getState().editor?.editing, {timeout: 5000});
	})];
	const commitServerWall = [await timed(async () => {
		await page.waitForFunction(() => { const s = window.DEBUG_STORE.getState(); return s.data && s.data.pendingModificationCount === 0; }, {timeout: 30000});
		await page.waitForFunction(() => !localStorage.getItem('card-web-pending-multi-edit-v1'), {timeout: 30000});
	})];
	//Sync point before the AUTHORITATIVE server-side assert (readEmulatorCardBody
	//in run.js). This waits for the marker to appear in the client's raw cards
	//via the worker-delivered echo — which is NOT the perceived-latency
	//measurement (that is commitPerceivedWall, already captured) and is the
	//worker's DELTA round trip. On the emulator that echo can be delayed many
	//seconds behind the durable op's own completion (whose success is already
	//proven above: pendingModificationCount hit 0 and the intent cleared),
	//because the emulator has no cloud functions so the active card's
	//similar-cards path storms CORS-blocked similarCards and contends the
	//worker. A generous timeout keeps this a sync point, not a latency gate.
	await page.waitForFunction(marker => window.PERF_HARNESS.activeRawCard().body.includes(marker), marker, {timeout: 60000});
	const committedCard = await page.evaluate(() => window.PERF_HARNESS.activeRawCard());
	if (committedCard.modificationError) throw new Error('commit reported modification error: ' + committedCard.modificationError);
	if (committedCard.body === initialCard.body || !committedCard.body.includes(marker)) throw new Error('commit did not add the unique interaction marker');
	const committedBody = committedCard.body;

	//--- Arrow-nav x20 through the real keyboard listener. PERF_HARNESS is used
	//only to observe the active ID, never to trigger the interaction. ---
	const navWall = [];
	for (let i = 0; i < 20; i++) navWall.push(await timed(async () => {
		const before = await page.evaluate(() => window.PERF_HARNESS.activeRawCard().id);
		await page.keyboard.press('ArrowRight');
		await page.waitForFunction(id => window.PERF_HARNESS.activeRawCard().id !== id, before, {timeout: 5000});
	}));

	//--- Find dialog: dispatch openFindDialog + set a query (avoids shadow-DOM
	//    keyboard routing); waits past the 250ms debounce. ---
	const findWall = [await timed(async () => {
		await page.evaluate(() => window.PERF_HARNESS.openFind('perf'));
		await page.waitForFunction(() => window.DEBUG_STORE.getState().find.activeQuery === 'perf', {timeout: 5000});
	})];

	const perf = await page.evaluate(() => window.DEBUG_PERF ? window.DEBUG_PERF.data() : null);
	//Worker-scoped timing (on/shadow modes) — perfMiddleware can't see it, so
	//in on-mode this is where the O(corpus) cost actually lives. null in off mode.
	const workerPerf = await page.evaluate(async () => (window.CORPUS_WORKER && window.CORPUS_WORKER.perfData) ? await window.CORPUS_WORKER.perfData() : null);
	const A = perf ? perf.actionStats : {};
	const W = workerPerf ? workerPerf.actionStats : {};
	return {
		//AUTHORITATIVE main-thread dispatch cost (avg/max). Compare budgets here.
		dispatch: {
			showCard: stat(A, 'SHOW_CARD'),
			updateReads: stat(A, 'UPDATE_READS'),
			editingStart: stat(A, 'EDITING_START'),
			modifyCard: stat(A, 'MODIFY_CARD'),
			updateCards: stat(A, 'UPDATE_CARDS'),
			//Worker-mode dispatches the off-mode whitelist omits: the worker's
			//collection push landing on the main store, and the local-echo apply.
			updateWorkerCollection: stat(A, 'UPDATE_WORKER_COLLECTION'),
			echoLocalCardModifications: stat(A, 'ECHO_LOCAL_CARD_MODIFICATIONS'),
		},
		//WORKER-THREAD compute cost (on/shadow): the other half of the attributed
		//commit→interactive / nav breakdown. {count,avgMs,maxMs} per phase +
		//indexBuildMs (cumulative boot cost). null in off mode.
		worker: workerPerf ? {
			ingest: wstat(W, 'ingest'),
			indexBuild: wstat(W, 'indexBuild'),
			runCollection: wstat(W, 'runCollection'),
			collectionPush: wstat(W, 'collectionPush'),
			query: wstat(W, 'query'),
			indexBuildMsCumulative: workerPerf.indexBuildMs,
		} : null,
		mainWork: {
			collectionFilter: rawStat(A, 'collection:filter'),
			collectionSort: rawStat(A, 'collection:sort'),
		},
		//COARSE wall-clock (incl. Playwright IPC; commit/find emulator-optimistic).
		wall: {nav: wall(navWall), editorOpen: wall(editorWall), keystroke: wall(keyWall), commit: wall(commitPerceivedWall), serverCommit: wall(commitServerWall), find: wall(findWall)},
		committedCard: {id: committedCard.id, expectedBody: committedBody},
		counters: perf ? perf.counters : {},
	};
};
