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

//Atomic nav+echo: advance a card and mark it read, driving SHOW_CARD +
//UPDATE_READS (makeFilterFromCards) in one context (no keyboard/pushState race).
const navAndRead = (page) => page.evaluate(() => window.PERF_HARNESS.navigateAndRead());

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
	const committedCardID = initialCard.id;

	//NOTE on ordering: editingStart is reliable on the boot card but not after a
	//run of direct navigateToNextCard dispatches (a card-view render-timing
	//quirk). The Appendix-A budgets are independent, so we edit/type/commit
	//FIRST (commit closes the editor) and nav AFTER — each measured cleanly.

	//--- Editor open (dispatch editingStart, select Content, wait for body) ---
	const editorWall = [await timed(async () => {
		await page.evaluate(() => window.PERF_HARNESS.startEditingContent());
		await waitForBody(page);
	})];

	//--- 30 keystrokes into the focused body ---
	await focusBody(page);
	const marker = (`perf${Date.now().toString(36)}marker`).padEnd(keystrokes, 'x').slice(0, keystrokes);
	const keyWall = [];
	for (const character of marker) keyWall.push(await timed(() => page.keyboard.type(character)));

	//--- Commit: dispatch editingCommit; wait pendingModificationCount==0 (the
	//    true "interactive again" marker); this also closes the editor.
	//    EMULATOR-OPTIMISTIC wall-clock. ---
	const commitWall = [await timed(async () => {
		await page.evaluate(() => window.PERF_HARNESS.commitEditing());
		await page.waitForFunction(() => { const s = window.DEBUG_STORE.getState(); return s.data && s.data.pendingModificationCount === 0; }, {timeout: 30000});
	})];
	const committedCard = await page.evaluate(() => window.PERF_HARNESS.activeRawCard());
	if (committedCard.modificationError) throw new Error('commit reported modification error: ' + committedCard.modificationError);
	if (committedCard.body === initialCard.body || !committedCard.body.includes(marker)) throw new Error('commit did not add the unique interaction marker');
	const committedBody = committedCard.body;

	//--- Arrow-nav x20 (editor now closed): SHOW_CARD + the real auto-mark-read
	//    echo (UPDATE_READS -> makeFilterFromCards) per step ---
	const navWall = [];
	for (let i = 0; i < 20; i++) navWall.push(await timed(() => navAndRead(page)));

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
		wall: {nav: wall(navWall), editorOpen: wall(editorWall), keystroke: wall(keyWall), commit: wall(commitWall), find: wall(findWall)},
		committedCard: {id: committedCardID, expectedBody: committedBody},
		counters: perf ? perf.counters : {},
	};
};
