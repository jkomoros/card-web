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

const {bulkCreateWorkingNotes, modifyCard} = await import('../../lib/src/actions/data.js');
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
		//Delta-listener stand-in: bulkCreateWorkingNotes waits for its cards
		//to arrive in the store, which in the app the listener provides.
		const delivered = new Set();
		const deliveryTimer = setInterval(() => {
			void (async () => {
				const snapshot = await getDocs(query(coll(db, 'cards'), where('card_type', '==', 'working-notes')));
				for (const docSnapshot of snapshot.docs) {
					const card = docSnapshot.data();
					if (delivered.has(docSnapshot.id) || !String(card.body || '').includes(marker)) continue;
					delivered.add(docSnapshot.id);
					//Raw UPDATE_CARDS, not receiveCards: the import's own pending
					//modification would gate a receiveCards delivery.
					store.dispatch({type: 'UPDATE_CARDS', cards: {[docSnapshot.id]: {...card, id: docSnapshot.id}}, fetchType: 'unpublished'});
				}
			})();
		}, 50);
		try {
			await store.dispatch(bulkCreateWorkingNotes(bodies));
		} finally {
			clearInterval(deliveryTimer);
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
});
