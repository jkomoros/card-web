/*eslint-env node, es2022*/

//The drawer's web view labels each node with a child SVG <title> (what
//browsers render as a tooltip; a `title` ATTRIBUTE on a circle is not one),
//and the text is the same display title the list shows, so a graph of
//working notes — which store no authored title — does not show bare ids.
//Mounted for real through the app harness: the renderer reads the store.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {store, dom} = app;

await import('../../lib/src/components/web-renderer.js');
const {UPDATE_CARDS} = await import('../../lib/src/actions.js');
const {displayTitleDateLabel} = await import('../../lib/src/working-notes-display-title.js');
const {selectCards} = await import('../../lib/src/selectors.js');

const stamp = (seconds) => ({seconds, nanoseconds: 0, toMillis() { return seconds * 1000; }});
const NOTE_SECONDS = 1_604_500_000;
const card = (id, extras = {}) => ({
	id, card_type: 'content', title: '', body: '', section: 'main', tags: [], references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	created: stamp(NOTE_SECONDS), updated: stamp(NOTE_SECONDS), updated_substantive: stamp(NOTE_SECONDS), published: true, author: 'harness-user',
	permissions: {}, collaborators: [], star_count: 0, thread_count: 0, thread_resolved_count: 0, images: [], auto_todo_overrides: {}, ...extras,
});

const mount = async (webInfo) => {
	const element = dom.window.document.createElement('web-renderer');
	element.webInfo = webInfo;
	dom.window.document.body.appendChild(element);
	await element.updateComplete;
	return element;
};

const labelOf = (element, id) => {
	const circle = element.shadowRoot.querySelector(`circle[id="${id}"]`);
	assert.ok(circle, `circle for ${id}`);
	assert.strictEqual(circle.getAttribute('title'), null, 'the label is not a title attribute');
	const title = circle.querySelector('title');
	assert.ok(title, `a child <title> under ${id}`);
	assert.strictEqual(title.namespaceURI, 'http://www.w3.org/2000/svg');
	return title.textContent;
};

describe('web-renderer node labels', () => {
	before(() => {
		store.dispatch({type: UPDATE_CARDS, cards: {
			authored: card('authored', {title: 'An Authored Title', body: '<p>Body.</p>'}),
			note: card('note', {card_type: 'working-notes', published: false, body: '<p>Hill climbing is totally a thing. Truth is a mindset, a process.</p>'}),
			bare: card('bare', {body: '<p>No title at all.</p>'}),
		}, fetchType: 'unpublished'});
		assert.ok(selectCards(store.getState()).note, 'the harness store holds the note');
	});

	it('labels a working note with its display title, an authored card with its title, and a titleless card with its id', async () => {
		const element = await mount({nodes: [
			{id: 'authored', name: 'An Authored Title'},
			{id: 'note', name: 'note'},
			{id: 'bare', name: 'bare'},
		], edges: [{source: 'authored', target: 'note', value: 1}]});
		assert.strictEqual(labelOf(element, 'authored'), 'An Authored Title');
		const noteCard = selectCards(store.getState()).note;
		const noteLabel = labelOf(element, 'note');
		assert.ok(noteLabel.startsWith(displayTitleDateLabel(noteCard) + ' '), `note label starts with the date: ${noteLabel}`);
		assert.ok(noteLabel.length > displayTitleDateLabel(noteCard).length + 1, `note label carries words beyond the date: ${noteLabel}`);
		assert.strictEqual(labelOf(element, 'bare'), 'bare');
		element.remove();
	});

	it('keeps the collection’s own name for a node whose card the store does not hold', async () => {
		const element = await mount({nodes: [{id: 'ghost', name: 'From The Collection'}], edges: []});
		assert.strictEqual(labelOf(element, 'ghost'), 'From The Collection');
		element.remove();
	});
});
