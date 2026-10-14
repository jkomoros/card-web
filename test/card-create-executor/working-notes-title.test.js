/*eslint-env node, es2022*/

//No write path yields a generated working-notes title (slice 5, §5.1). The
//finisher that derived "<date> <eight fingerprint terms>" from the VIEWER's
//corpus and wrote it into the shared title field is gone; the title is
//authorable and optional. Real thunks against the emulator: a bulk import,
//a body edit and an authored-title edit must leave the server title '' or
//exactly what the author typed.

import assert from 'assert';
import {bootstrapApp, clearAuxQueue, clearHarnessAlerts} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {db, store, firestore} = app;
const {doc, getDocs, getDocsFromServer, getDoc, query, collection: coll, where} = firestore;

const {bulkCreateWorkingNotes, modifyCard, createCard} = await import('../../lib/src/actions/data.js');
const {newID} = await import('../../lib/src/util.js');
const {CARD_TYPE_EDITING_FINISHERS} = await import('../../lib/src/card_finishers.js');
const {DERIVED_FIELDS_FOR_CARD_TYPE, OPTIONAL_FIELDS_FOR_CARD_TYPE, TEXT_FIELD_CONFIGURATION} = await import('../../lib/shared/card_fields.js');
const {selectRawCards} = await import('../../lib/src/selectors.js');
store.addReducers({
	collection: (await import('../../lib/src/reducers/collection.js')).default,
	bulkImport: (await import('../../lib/src/reducers/bulk-import.js')).default,
});

describe('working-notes titles are authored, never generated', function() {
	this.timeout(120000);

	before(() => {
		globalThis.location = app.dom.window.location;
		globalThis.history = app.dom.window.history;
	});

	beforeEach(() => {
		clearAuxQueue();
		clearHarnessAlerts();
		store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
		store.dispatch({type: 'UPDATE_USER_PERMISSIONS', permissions: {edit: true, admin: true}});
	});

	after(() => {
		store.dispatch({type: 'CLEAR_SELECTED_CARDS'});
	});

	it('has no finisher for working-notes, and the title is legal, optional and not derived', () => {
		assert.strictEqual(CARD_TYPE_EDITING_FINISHERS['working-notes'], undefined);
		assert.ok(TEXT_FIELD_CONFIGURATION.title.legalCardTypes['working-notes'], 'the title is authorable on working-notes');
		assert.ok(!DERIVED_FIELDS_FOR_CARD_TYPE['working-notes'].title, 'the title is no longer derived');
		assert.ok(OPTIONAL_FIELDS_FOR_CARD_TYPE['working-notes'].title, 'the title may be left empty');
	});

	it('a bulk import writes empty titles; a body edit keeps them empty; an authored title is kept verbatim', async () => {
		const marker = 'wn-title-' + Date.now();
		const bodies = [`<p>${marker} alpha</p>`, `<p>${marker} beta</p>`, `<p>${marker} gamma</p>`];
		//Delta-listener stand-in, like bulk-import-session's: deliver the
		//committed cards to the store ONCE, after the import reports them all
		//committed. Polling the server while the writes are in flight made
		//the SDK fail an internal assertion about half the time.
		let delivered = false;
		const unsubscribe = store.subscribe(() => {
			if (delivered || store.getState().bulkImport.progress?.committed !== bodies.length) return;
			delivered = true;
			setTimeout(async () => {
				const snapshot = await getDocs(query(coll(db, 'cards'), where('card_type', '==', 'working-notes')));
				const cards = {};
				for (const docSnapshot of snapshot.docs) {
					if (!String(docSnapshot.data().body || '').includes(marker)) continue;
					cards[docSnapshot.id] = {...docSnapshot.data(), id: docSnapshot.id};
				}
				//Raw UPDATE_CARDS, not receiveCards: the import's own pending
				//modification would gate a receiveCards delivery.
				store.dispatch({type: 'UPDATE_CARDS', cards, fetchType: 'unpublished'});
			}, 0);
		});
		try {
			await store.dispatch(bulkCreateWorkingNotes(bodies));
		} finally {
			unsubscribe();
		}
		const snapshot = await getDocsFromServer(query(coll(db, 'cards'), where('card_type', '==', 'working-notes')));
		const created = snapshot.docs.filter(d => String(d.data().body || '').includes(marker));
		assert.strictEqual(created.length, 3);
		for (const d of created) assert.strictEqual(d.data().title, '', `${d.id} was created with a generated title: ${JSON.stringify(d.data().title)}`);

		//A body edit through the real save path leaves the title alone.
		const first = created[0];
		const held = selectRawCards(store.getState())[first.id];
		assert.ok(held, 'the imported card reached the store');
		await store.dispatch(modifyCard(held, {body: `<p>${marker} alpha edited with many more distinctive words</p>`}, true));
		let server = (await getDoc(doc(db, 'cards', first.id))).data();
		assert.strictEqual(server.title, '', 'a body edit must not generate a title');
		assert.ok(server.body.includes('edited'));

		//An authored title is written exactly as typed.
		store.dispatch({type: 'UPDATE_CARDS', cards: {[first.id]: {...server, id: first.id}}, fetchType: 'unpublished'});
		await store.dispatch(modifyCard(selectRawCards(store.getState())[first.id], {title: 'My own title'}, true));
		server = (await getDoc(doc(db, 'cards', first.id))).data();
		assert.strictEqual(server.title, 'My own title');
	});

	it('renders no title row and no type icon for an untitled note in view mode, and a placeholder while editing', async function() {
		this.timeout(20000);
		//Making the title LEGAL made editableFieldsForCardType return it, and
		//the renderer's title row (with the card-type icon) is drawn whenever
		//a title field exists — so every note grew an icon and an empty h1
		//that master never drew (the step-A review caught it).
		await import('../../lib/src/components/card-renderer.js');
		const element = app.dom.window.document.createElement('card-renderer');
		const card = {
			id: 'render-note', card_type: 'working-notes', title: '', body: '<p>A note body</p>', section: '', tags: [], published: false, full_bleed: false,
			references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {}, auto_todo_overrides: {}, images: [], slugs: [], notes: '', todo: '',
			star_count: 0, thread_count: 0, font_size_boost: {},
		};
		//jsdom has no execCommand; the renderer's empty-body caret hack
		//calls it when editing starts.
		if (!app.dom.window.document.execCommand) app.dom.window.document.execCommand = () => true;
		element.card = card;
		element.editing = false;
		element.dataIsFullyLoaded = true;
		app.dom.window.document.body.appendChild(element);
		try {
			await element.updateComplete;
			assert.strictEqual(element.shadowRoot.querySelector('[data-field=title]'), null, 'no title element in view mode');
			assert.strictEqual(element.shadowRoot.querySelector('.title-container svg'), null, 'no card-type icon in view mode');
			assert.ok(element.shadowRoot.querySelector('[data-field=body]'), 'the body still renders');
			element.editing = true;
			await element.updateComplete;
			const title = element.shadowRoot.querySelector('[data-field=title]');
			assert.ok(title, 'the title is editable while editing');
			assert.strictEqual(title.dataset.placeholder, 'Optional title');
			assert.strictEqual(title.childNodes.length, 0, 'the placeholder is a pseudo-element, never content');
			//With an authored title, view mode shows it.
			element.editing = false;
			element.card = {...card, title: 'Authored'};
			await element.updateComplete;
			//jsdom does not implement innerText, which is how a non-HTML field's
			//text is set, so check the property the renderer assigns.
			const authored = element.shadowRoot.querySelector('[data-field=title]');
			assert.ok(authored, 'an authored title renders in view mode');
			assert.strictEqual(authored.innerText || authored.textContent, 'Authored');
		} finally {
			element.remove();
		}
	});

	it('createCard writes an empty title for a working-notes card', async () => {
		//A vended id skips the slug-legality callable, so createCard runs
		//end to end in the harness.
		const id = newID();
		const marker = 'wn-create-' + Date.now();
		let delivered = false;
		const unsubscribe = store.subscribe(() => {
			if (delivered || store.getState().data.pendingNewCardID !== id) return;
			delivered = true;
			setTimeout(async () => {
				const snap = await getDoc(doc(db, 'cards', id));
				if (snap.exists()) store.dispatch({type: 'UPDATE_CARDS', cards: {[id]: {...snap.data(), id}}, fetchType: 'unpublished'});
			}, 100);
		});
		try {
			await store.dispatch(createCard({id, cardType: 'working-notes', body: `<p>${marker} created directly</p>`, noNavigate: true}));
		} finally {
			unsubscribe();
		}
		const server = (await getDoc(doc(db, 'cards', id))).data();
		assert.ok(server, 'the card was created');
		assert.strictEqual(server.card_type, 'working-notes');
		assert.strictEqual(server.title, '', `createCard generated a title: ${JSON.stringify(server.title)}`);
	});
});
