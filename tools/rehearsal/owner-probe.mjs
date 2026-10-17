/*eslint-env browser, es2022*/
//First, in the DevTools console of the SIGNED-IN session on the build under
//rehearsal, run `DEBUG_PERF.enable()` and reload: that exposes DEBUG_STORE,
//which this probe reads. Then paste this file's contents and use the app
//normally: do five Save → new-note cycles
//(Cmd+Shift+M for a new working note, type, Save), open the Working notes
//tab, rename a concept and come back, create a note while offline and
//reconnect. It only observes the store and the DOM — it writes nothing —
//and `REHEARSAL.report()` prints a JSON block to paste back.
(() => {
	const store = window.DEBUG_STORE;
	if (!store) { console.error('No DEBUG_STORE on this page: run DEBUG_PERF.enable() in this console, reload, sign in, then paste again'); return; }
	const cycles = [];
	const events = [];
	const seenMessages = new Set();
	const messages = [];
	let prev = store.getState();
	let tSave = null;
	let savedCard = null;
	let tNew = null;
	const unsubscribe = store.subscribe(() => {
		const s = store.getState();
		const now = performance.now();
		const wasEditing = Boolean(prev.editor && prev.editor.editing);
		const isEditing = Boolean(s.editor && s.editor.editing);
		const prevCard = prev.editor && prev.editor.card ? prev.editor.card.id : null;
		const card = s.editor && s.editor.card ? s.editor.card.id : null;
		if (wasEditing && !isEditing) { tSave = now; savedCard = prevCard; events.push({t: Math.round(now), e: 'editor-closed', card: prevCard}); }
		const pendingNew = s.data.pendingNewCardIDToNavigateTo;
		if (pendingNew && pendingNew !== prev.data.pendingNewCardIDToNavigateTo) { tNew = now; events.push({t: Math.round(now), e: 'new-card-expected', card: pendingNew}); }
		if (!wasEditing && isEditing) {
			events.push({t: Math.round(now), e: 'editor-opened', card});
			if (tSave !== null && tNew !== null && tNew >= tSave && card !== savedCard) {
				cycles.push({savedCard, newCard: card, saveToEditorMs: Math.round(now - tSave), newPressToEditorMs: Math.round(now - tNew)});
			}
			tNew = null;
		}
		for (const entry of (s.app && s.app.snackbars) || []) {
			if (!seenMessages.has(entry.id)) { seenMessages.add(entry.id); messages.push({t: Math.round(now), kind: 'snackbar', text: entry.message}); }
		}
		for (const entry of (s.errors && s.errors.errors) || []) {
			const key = 'err:' + (entry.dedupeKey || entry.what);
			if (!seenMessages.has(key)) { seenMessages.add(key); messages.push({t: Math.round(now), kind: 'banner', text: entry.what + ' ' + (entry.reassurance || '')}); }
		}
		if (s.data.corpusStatus !== prev.data.corpusStatus) events.push({t: Math.round(now), e: 'corpus-status', status: s.data.corpusStatus});
		prev = s;
	});
	const lists = () => { const out = []; const walk = root => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'CARD-THUMBNAIL-LIST' && el.shadowRoot) out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(document); return out; };
	const workingNotesRows = () => {
		const cards = store.getState().data.cards;
		let rows = 0, wn = 0, dateOnly = 0;
		for (const l of lists()) for (const th of l.shadowRoot.querySelectorAll('.thumbnail[data-card]')) {
			rows++; const c = cards[th.getAttribute('data-card')]; if (!c || c.card_type !== 'working-notes') continue; wn++;
			const h = th.querySelector('h3'); const txt = h ? h.textContent.trim() : '';
			if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(txt)) dateOnly++;
		}
		return {rows, workingNotes: wn, dateOnlyTitles: dateOnly};
	};
	const snapshots = () => new Promise(res => {
		const rq = indexedDB.open('corpus-worker-snapshot');
		rq.onerror = () => res({err: String(rq.error)});
		rq.onsuccess = () => {
			const db = rq.result;
			if (!db.objectStoreNames.contains('snapshots')) { res([]); return; }
			const st = db.transaction('snapshots', 'readonly').objectStore('snapshots');
			const rows = []; const c = st.openCursor();
			c.onsuccess = () => { const cur = c.result; if (!cur) { res(rows); return; } const v = cur.value || {}; rows.push({key: String(cur.key), cards: v.cards ? Object.keys(v.cards).length : null, displayTitles: v.displayTitles ? Object.keys(v.displayTitles).length : 0}); cur.continue(); };
		};
	});
	window.REHEARSAL = {
		cycles, events, messages, workingNotesRows,
		report: async () => {
			const s = store.getState();
			const med = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
			const report = {
				stamp: await fetch('/deploy-stamp.json').then(r => r.json()).catch(() => null),
				uid: s.user && s.user.user ? s.user.user.uid : null,
				corpusStatus: s.data.corpusStatus, cards: Object.keys(s.data.cards).length,
				cycles, medianSaveToEditorMs: med(cycles.map(c => c.saveToEditorMs)),
				workingNotesRows: workingNotesRows(), snapshots: await snapshots(),
				messages, events: events.slice(-60),
				pendingAuxWrites: (() => { try { return Object.keys(localStorage).filter(k => /aux-write/.test(k)).length; } catch { return null; } })(),
				pausedMultiEdit: (() => { try { return localStorage.getItem('card-web-pending-multi-edit-v1'); } catch { return null; } })(),
			};
			console.log('REHEARSAL REPORT\n' + JSON.stringify(report, null, 2));
			return report;
		},
		stop: unsubscribe,
	};
	console.log('REHEARSAL probe armed. Use the app, then run: await REHEARSAL.report()');
})();
