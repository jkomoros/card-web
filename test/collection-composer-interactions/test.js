/*eslint-env node, es2022*/

import { JSDOM } from 'jsdom';
import assert from 'assert';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const dom = new JSDOM('', { url: 'https://example.com/c/main/' });
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent',
	'InputEvent', 'KeyboardEvent', 'ShadowRoot', 'HTMLInputElement',
	'HTMLButtonElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLSlotElement',
	//find-dialog reaches card-drawer, which reaches @polymer/polymer's gesture
	//module — it reads navigator at module scope, so it must exist before the
	//first import, not merely before the first render.
	'navigator', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame',
	'DocumentFragment', 'HTMLImageElement', 'HTMLAnchorElement',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.BroadcastChannel = class {
	addEventListener() {}
	removeEventListener() {}
	postMessage() {}
	close() {}
};

window.localStorage.setItem('collection-composer', 'on');

//The scope is the signed-in uid, which is empty in these tests.
const HISTORY_KEY = 'collection-composer-history:public';

describe('Collection Composer interactions', () => {
	let store;
	let dialog;
	let findDialog;
	let CollectionDescription;
	let OPEN_CONFIGURE_COLLECTION_DIALOG;
	let CANCEL_CONFIGURE_COLLECTION_DIALOG;
	let UPDATE_PAGE;

	before(async () => {
		({ store } = await import('../../lib/src/store.js'));
		const collection = (await import('../../lib/src/reducers/collection.js')).default;
		const editor = (state = { editing: false }, action) =>
			action.type === 'TEST_SET_EDITING' ? { ...state, editing: action.value } : state;
		({
			OPEN_CONFIGURE_COLLECTION_DIALOG,
			CANCEL_CONFIGURE_COLLECTION_DIALOG,
			UPDATE_PAGE,
		} = await import('../../lib/src/actions.js'));
		({ CollectionDescription } = await import('../../lib/src/collection_description.js'));
		await import('../../lib/src/components/configure-collection-dialog.js');
		//Picking a card is find-dialog's job now (HS-5), so the picker has to be
		//really mounted: its Escape binding only exists while it is open, and
		//the layering these tests pin is between two REGISTERED bindings.
		//Importing it also registers the `find` reducer.
		await import('../../lib/src/components/find-dialog.js');
		//EAGERLY, so it cannot arrive later. navigated() lazy-imports main-view
		//the first time a test navigates, and main-view registers the REAL
		//editor reducer — which would replace the stub below PART WAY THROUGH
		//the run, after which TEST_SET_EDITING means nothing and the two
		//"editing blocks navigation" tests would assert against a navigation
		//that was never blocked. Loading it here makes that later import a cache
		//hit. (It used to reject instead, on an extensionless import plain Node
		//cannot resolve, which is the only reason the stub survived at all.)
		await import('../../lib/src/components/main-view.js');
		//The Ctrl-Shift-L pin drives the REAL binding through the REAL registry,
		//and card-view is the module that declares it. loadPage imports it
		//lazily on the first navigation anyway; doing it here makes the binding's
		//presence a fact of the suite rather than a side effect of test order.
		await import('../../lib/src/components/card-view.js');
		//LAST, for the same reason: whoever registers `editor` last wins.
		store.addReducers({ collection, editor });
	});

	//Most users open the composer with a populated recent history. Seed one so
	//the Enter tests exercise the list a real user sees rather than an empty one.
	const seedRecents = async (entries) => {
		window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.map(([raw, visits]) => {
			const description = CollectionDescription.deserialize(raw);
			return {
				canonical: description.serialize(),
				authoring: description.serializeOriginalOrder(),
				visitedAt: Date.now(),
				visits,
			};
		})));
		dialog.requestUpdate();
		await dialog.updateComplete;
	};

	//A picked card travels dialog → configure-collection-filter → key-card, and
	//every element on that road has its own update cycle. One await settles the
	//first of them, which is how an assertion about what the user SEES can read
	//the frame before the answer arrived.
	const settleRender = async (...elements) => {
		for (let round = 0; round < 3; round++) {
			for (const element of elements) await element.updateComplete;
		}
	};

	const suggestionRows = () =>
		Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));

	const suggestionLabels = () =>
		suggestionRows().map((button) => button.textContent.replace(/\s+/g, ' ').trim());

	const highlightedRow = () =>
		dialog.shadowRoot.querySelector('[role="option"][data-highlighted]');

	//JSDOM computes no layout, so every geometry property this suite cares
	//about is pinned against the real registered component's own stylesheet.
	const composerStyles = () =>
		dialog.constructor.styles.map((sheet) => String(sheet.cssText || '')).join('\n');

	beforeEach(async () => {
		window.history.replaceState({}, '', '/c/main/');
		store.dispatch({ type: 'TEST_SET_EDITING', value: false });
		dialog = document.createElement('configure-collection-dialog');
		document.body.append(dialog);
		findDialog = document.createElement('find-dialog');
		document.body.append(findDialog);
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await dialog.updateComplete;
		await dialog.updateComplete;
	});

	afterEach(() => {
		//Cancelling now PRESERVES an un-committed draft so the next open can
		//resume it — that is the point of the feature. A second cancel, with
		//nothing left to preserve, clears it: every test has to begin from
		///c/main/ rather than from whatever the previous test was composing.
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: 'FIND_DIALOG_CLOSE' });
		dialog.remove();
		findDialog.remove();
		window.localStorage.removeItem(HISTORY_KEY);
	});

	//Same guarantee, master's mechanism. This used to pin the ordering inside
	//card-view's own document-level _handleKeyDown ("the gate must run before
	//Ctrl-K"). #740 replaced that handler with declarative bindings dispatched
	//by the shortcut registry, which applies each binding's `when` before its
	//handler — so the property to pin is that BOTH composer entry points
	//declare the shared gate, and that they draw their combos from the
	//canonical table rather than inlining them.
	it('routes global composer shortcuts through the shared modal and ownership gate', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		const binding = (id) => {
			const start = source.indexOf(`id: '${id}',`);
			assert.ok(start >= 0, `card-view must declare the '${id}' binding`);
			const end = source.indexOf('\n\t},', start);
			return source.slice(start, end === -1 ? undefined : end);
		};
		const open = binding('open-collection-composer');
		assert.match(open, /keys: SHORTCUT_COMBOS\['open-collection-composer'\]/,
			'Ctrl-K must come from the canonical combo table');
		//Ctrl-K takes the shared gate minus one term: its own dialog. The spec's
		//keyboard table defines what Ctrl-K does when the composer is already open,
		//and the full gate made that unreachable. Every OTHER modal still refuses
		//it — which is what the selector assertion below actually checks.
		assert.match(open, /when:[^\n]*whenKeyboardNavigatesIgnoringCollectionComposer/,
			'the shared keyboard gate must guard Ctrl-K opening the composer');
		assert.match(open, /collectionComposerEnabled\(\)/);

		const navigate = binding('navigate-to-path');
		assert.match(navigate, /keys: SHORTCUT_COMBOS\['navigate-to-path'\]/,
			'Ctrl-Shift-L must come from the canonical combo table');
		assert.match(navigate, /when: whenKeyboardNavigates/,
			'the shared keyboard gate must guard Ctrl-Shift-L opening Source');
		assert.match(navigate, /openConfigureCollectionDialog\('source'\)/,
			'Ctrl-Shift-L must open the composer in Source mode when it is enabled');
	});

	//A source pin, for the same reason the gate pin above is one: card-view
	//cannot be mounted in this harness (its dependency graph reaches an
	//extensionless import that only the bundler resolves), and the property is
	//structural. An empty collection collapses the card drawer to zero width,
	//taking the collection summary — the composer's only visible entry point —
	//with it, exactly when refining is the only useful thing left to do.
	it('offers the composer from the card view when the collection is empty', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		const start = source.indexOf('get _showCollectionEmptyState()');
		assert.ok(start >= 0, 'card-view must decide when the collection reads as empty');
		const predicate = source.slice(start, source.indexOf('\n\t}', start));
		//Empty is only worth saying once the answer is final.
		assert.match(predicate, /_collectionPending/);
		assert.match(predicate, /_collectionUpdating/);
		assert.match(predicate, /_collectionFailureMessage/);
		//The engine sets isFallback precisely when the filter result is empty
		//(collection_description._makeFilteredCards), so gating the empty state
		//on it suppressed the message in exactly its target case — verified
		//against the live app. When fallback placeholder cards actually render,
		//finalSortedCards is non-empty and the length check already declines.
		assert.ok(!/_collectionIsFallback/.test(predicate),
			'the empty state must not gate on isFallback — that flag IS the empty-collection signal');
		assert.match(predicate, /collectionComposerEnabled\(\)/);
		assert.match(predicate, /finalSortedCards\.length === 0/);

		const emptyStart = source.indexOf('class=\'collection-empty\'');
		assert.ok(emptyStart >= 0, 'the card view area must render an empty state');
		const block = source.slice(emptyStart, source.indexOf('</div>', emptyStart));
		//HS-2.6: one sentence-case fragment, no terminal period, no exclamation.
		assert.match(block, /No cards match this collection/);
		assert.ok(!/No cards match this collection[.!]/.test(block), 'an empty state takes no terminal period');
		//And the affordance is the same dialog, named with its shortcut.
		assert.match(block, /_handleConfigureCollectionClicked/);
		assert.match(block, /shortcutKeys\('open-collection-composer'\)/);
		assert.match(block, /aria-label=/, 'the affordance needs an accessible name (HS-2.5)');
	});

	//The summary is ~133px wide with a two-line clamp, so a draft of more than
	//two clauses is visibly truncated. The spec requires the complete expression
	//to be reachable from it.
	it('exposes the whole collection expression from the truncated summary', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		const start = source.indexOf('class=\'collection-summary-main\'');
		assert.ok(start >= 0);
		const block = source.slice(start, source.indexOf('</button>', start));
		//The tooltip still carries the whole expression, but as a COMMAND rather
		//than a bare state readout (HS-2.5) — same shape as the aria-label below.
		//Both now read one getter rather than two copies of one template: the
		//name also has to say when a clause was struck (see the unresolved-clause
		//test below), and two literals would have drifted the first time it did.
		assert.match(block, /title=\$\{this\._collectionSummaryName\}/,
			'hover must reveal the complete expression, in the command form');
		assert.match(block, /aria-label=\$\{this\._collectionSummaryName\}/,
			'assistive tech must hear the complete expression');
		const nameStart = source.indexOf('get _collectionSummaryName()');
		assert.ok(nameStart >= 0, 'card-view must compose the summary\'s name in one place');
		const name = source.slice(nameStart, source.indexOf('\n\t}', nameStart));
		assert.match(name, /`Refine collection: \$\{expression\}`/,
			'and it is still the complete expression in the command form');
		assert.match(name, /readableCollectionExpression\(this\._collection\.description\)/);
		assert.match(source, /\.collection-summary-main:focus-visible \.collection-summary-expression\s*\{[^}]*line-clamp: unset/,
			'keyboard focus, which gets neither a tooltip nor a label readout, must unfold it');
	});

	//A deployment's own domain is configuration, not a literal (HS-1.4 for
	//APP_TITLE, same reasoning). It was hardcoded in two component literals, so
	//every other deployment of this app trusted somebody else's site.
	it('takes its trusted origins from configuration, not a literal', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/configure-collection-dialog.ts'), 'utf8');
		assert.ok(!/'https:\/\/thecompendium\.cards'/.test(source),
			'a deployment domain must not be a literal in a component');
		assert.match(source, /import \{ SITE_DOMAIN \} from '\.\.\/config\.GENERATED\.SECRET\.js'/);
		assert.match(source, /allowedOrigins: COMPOSER_ALLOWED_ORIGINS/);
		assert.match(source, /sourceAllowedOrigins: COMPOSER_ALLOWED_ORIGINS/);
		const start = source.indexOf('const COMPOSER_ALLOWED_ORIGINS');
		const block = source.slice(start, source.indexOf(']);', start));
		assert.match(block, /window\.location\.origin/, 'same-origin is always trusted');
		assert.match(block, /SITE_DOMAIN \?/, 'the configured domain is the only other one');
	});

	it('drops only the composer\'s own dialog from the keyboard gate', async () => {
		const { selectKeyboardNavigates, selectKeyboardNavigatesIgnoringCollectionComposer } =
      await import('../../lib/src/selectors.js');
		const { UPDATE_PAGE } = await import('../../lib/src/actions.js');
		const { PAGE_DEFAULT } = await import('../../lib/src/actions/app.js');
		//The gate also requires being on the collection page, which nothing in this
		//harness sets.
		store.dispatch({ type: UPDATE_PAGE, page: PAGE_DEFAULT, location: '/c/main/', pageExtra: 'main/' });
		//The composer is open (beforeEach). The general gate refuses; Ctrl-K's
		//does not, which is the whole difference between the two.
		assert.strictEqual(selectKeyboardNavigates(store.getState()), false);
		assert.strictEqual(selectKeyboardNavigatesIgnoringCollectionComposer(store.getState()), true);
		//Everything else the gate guards still refuses it.
		store.dispatch({ type: 'TEST_SET_EDITING', value: true });
		assert.strictEqual(selectKeyboardNavigatesIgnoringCollectionComposer(store.getState()), false);
		store.dispatch({ type: 'TEST_SET_EDITING', value: false });
		store.dispatch({ type: UPDATE_PAGE, page: '', location: '/c/main/', pageExtra: 'main/' });
	});

	//Spec keyboard table: Ctrl-K with the composer already open focuses the
	//input. It used to do nothing at all — the binding was gated out, so the
	//reducer never saw the second open.
	it('refocuses the composer input when asked to open while already open', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		const elsewhere = dialog.shadowRoot.querySelector('[role="option"]') ||
      dialog.shadowRoot.querySelector('.composer-actions .primary');
		elsewhere.focus();
		assert.notStrictEqual(dialog.shadowRoot.activeElement, input);
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await dialog.updateComplete;
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.strictEqual(dialog.shadowRoot.activeElement, input);
	});

	it('clicking an Add suggestion updates only the draft', async () => {
		const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
		const starred = buttons.find((button) => button.textContent.includes('Add Starred'));
		assert.ok(starred);
		const beforePath = window.location.pathname;
		starred.click();
		await dialog.updateComplete;
		const state = store.getState();
		assert.deepStrictEqual(state.collection.snapshot.filterNames, ['starred']);
		assert.deepStrictEqual(state.collection.active.filterNames, []);
		assert.strictEqual(window.location.pathname, beforePath);
		assert.match(dialog.shadowRoot.querySelector('.expression').textContent, /Starred/);
		assert.strictEqual(dialog.open, true);
	});

	it('adds a discovered concrete value as its exact URL-native filter', async () => {
		dialog._composerCandidates = [{
			filter: 'inductively-knowable',
			category: 'tag',
			label: 'Tagged “Inductively Knowable”',
			detail: 'Keeps cards tagged Inductively Knowable',
			aliases: ['tag', 'inductively knowable'],
		}];
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'tag inductively';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Tagged “Inductively Knowable”'));
		assert.ok(suggestion);
		//This used to assert the raw URL spelling was VISIBLE in the row, as proof
		//the suggestion carried the exact filter. That is the HS-1.4 violation
		//itself; the assertion below — that clicking it applies exactly
		//"inductively-knowable" — proves the same thing without a raw key on
		//screen, so the row is now checked for its ABSENCE.
		assert.ok(!suggestion.textContent.includes('inductively-knowable'),
			'a filter\'s URL spelling must not reach the user');
		suggestion.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['inductively-knowable']);
	});

	it('surfaces a diversified, durable context from the active card', async () => {
		dialog._composerCandidates = [
			{ filter: 'systems', category: 'tag', label: 'Tagged “Systems”', detail: '', valueLabel: 'Systems', clauseLabel: 'Tagged Systems' },
			{ filter: 'half-baked', category: 'section', label: 'In section “Half Baked”', detail: '', valueLabel: 'Half Baked', clauseLabel: 'Section Half Baked' },
			{ filter: 'working-notes', category: 'card type', label: 'Card type: Working Notes', detail: '', valueLabel: 'Working Notes', clauseLabel: 'Card Type Working Notes' },
		];
		dialog._activeCardID = 'card-123';
		dialog._activeCard = {
			section: 'half-baked',
			tags: ['systems'],
			card_type: 'working-notes',
			author: '',
			collaborators: [],
		};
		await dialog.updateComplete;
		const labels = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.slice(0, 3)
			.map((button) => button.textContent);
		//One clause, one name: the row says exactly what the chip it produces will
		//say, with the action grammar's verb in front of it. The active-card
		//destination leads, because it is the one row about where the user is.
		assert.match(labels[0], /Add This card and directly connected cards/);
		assert.match(labels[1], /Add Tagged Systems/);
		assert.match(labels[2], /Add Section Half Baked/);
	});

	it('explains preview counts as consequences without changing row order', async () => {
		const before = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.map((button) => button.id);
		dialog._previewCounts = {
			'current-draft-preview': 12,
			'add:starred': 5,
			'add:unread': 19,
		};
		await dialog.updateComplete;
		const after = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
		assert.deepStrictEqual(after.map((button) => button.id), before);
		assert.match(after.find((button) => button.textContent.includes('Add Starred')).textContent, /5 cards · 7 fewer/);
		assert.match(after.find((button) => button.textContent.includes('Add Unread')).textContent, /19 cards · 7 more/);
		//The draft's own count is a readout BESIDE the primary now, not inside
		//its label: HS-3.3 makes that button a round glyph, so it has no label
		//to put a number in. The primary is asserted separately, and what it
		//asserts is that it stayed a glyph with a stable name.
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim(), '12 cards');
		const primary = dialog.shadowRoot.querySelector('.composer-actions .primary');
		assert.ok(primary.classList.contains('round'), 'the committing action is a round primary (HS-3.3)');
		assert.strictEqual(primary.getAttribute('aria-label'), 'Open this collection');
		assert.strictEqual(primary.textContent.trim(), '', 'a round primary carries a glyph, not a label');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim(), '');
	});

	//Tab in the empty state used to do nothing at all: it was gated on the input
	//having text, so the keyboard could not reach a list of destinations without
	//first typing something to make them go away.
	it('Tab reaches the empty-state list, then materializes the row it landed on', async () => {
		assert.strictEqual(highlightedRow(), null);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-suggestion-0',
			'the first Tab makes the list keyboard-enterable without typing');
		assert.match(highlightedRow().textContent, /Add Starred/);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [],
			'and changes nothing on its own');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'the second Tab materializes that row into the draft');
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.match(dialog.shadowRoot.querySelector('.draft-receipt').textContent, /Added Starred/);
	});

	//A destination is not a transformation, so Tab on one is the spec's labeled
	//secondary action: it copies the destination's expression into the draft
	//instead of leaving for it.
	it('Tab on a destination copies its expression into the draft, and says so', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.match(highlightedRow().textContent, /Main AND Starred/);
		assert.match(dialog.shadowRoot.querySelector('.key-hints').textContent, /Tab copies it into the draft/);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(store.getState().collection.snapshot.sortName, 'recent');
		assert.strictEqual(window.location.pathname, '/c/main/', 'Tab does not navigate');
		assert.match(dialog.shadowRoot.querySelector('.draft-receipt').textContent,
			/Replaced the draft with Main AND Starred/);
	});

	//Counts rank the list when it is built. They may keep updating a row the user
	//is pointing at, but they may not move it out from under them.
	it('ranks empty rows down when the list is built, and never once it is focused', async () => {
		const indexOf = (text) => suggestionLabels().findIndex((label) => label.includes(text));
		assert.strictEqual(indexOf('Add Starred'), 0);
		dialog._previewCounts = { 'current-draft-preview': 12, 'add:starred': 0, 'add:unread': 5 };
		await dialog.updateComplete;
		assert.ok(indexOf('Add Unread') < indexOf('Add Starred'),
			'a row that yields no cards never sits above one that yields some');
		assert.notStrictEqual(indexOf('Add Starred'), 0);
		const withoutCounts = () => suggestionLabels().map((label) => label.replace(/\d+ (cards?|fewer|more)/g, ''));
		const focusedOrder = withoutCounts();
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		const highlighted = highlightedRow().textContent;
		dialog._previewCounts = { ...dialog._previewCounts, 'add:unread': 0, 'add:starred': 9 };
		await dialog.updateComplete;
		assert.deepStrictEqual(
			withoutCounts(),
			focusedOrder,
			'the focused list does not reorder when late counts arrive'
		);
		assert.strictEqual(
			highlightedRow().textContent.replace(/\d+ (cards?|fewer|more)/g, ''),
			highlighted.replace(/\d+ (cards?|fewer|more)/g, ''),
			'and the row the user is pointing at is still the same row'
		);
	});

	it('opens the edited draft only from the explicit primary action', async () => {
		const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
		buttons.find((button) => button.textContent.includes('Add Starred')).click();
		await dialog.updateComplete;
		const primary = dialog.shadowRoot.querySelector('.composer-actions button[aria-label="Open this collection"]');
		primary.click();
		await dialog.updateComplete;
		assert.match(window.location.pathname, /starred/);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.strictEqual(store.getState().collection.snapshot, null);
	});

	it('keeps the selected card when Enter adds and opens a suggestion', async () => {
		dialog._draftSelectedCard = 'card-123';
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const highlighted = dialog.shadowRoot.querySelector('[role="option"][data-highlighted]');
		assert.match(highlighted.textContent, /Starred/);
		input.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
			cancelable: true,
		}));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/card-123');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
	});

	//The state every user is in after their first Tab. The Enter test above types
	//"star" first, so the row that happens to be highlighted is also the row the
	//user wanted; that coincidence hid a flow where Ctrl-K → type → Tab → Enter
	//closed the dialog, left the URL alone, and discarded the clause in silence.
	it('commits the composed draft when Enter follows Tab, with recents on offer', async () => {
		await seedRecents([['main/', 9], ['main/starred/sort/recent/', 2]]);
		assert.strictEqual(highlightedRow(), null,
			'nothing is highlighted before the user points at a row, so no row looks primary');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(highlightedRow().textContent, /Starred/,
			'typing makes the list interpretations of what was typed, and the top one is highlighted');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(highlightedRow(), null,
			'Tab rebuilt the list, and nothing in the new list is what the user was pointing at');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/',
			'Enter with no highlighted suggestion opens the draft the user just composed');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
	});

	//THE RECEIPT AS THE USER ACTUALLY SEES IT.
	//
	//The audit's ask was a test that renders the snack bar and asserts the
	//receipt is really on screen, with something to press. Everything else about
	//receipts is asserted against state; this one mounts the real component, so a
	//receipt that reaches the store but never reaches a pixel fails here.
	//
	//It also drives the Undo through the registered action rather than calling
	//the thunk directly, because the serializable actionID in the message and the
	//thunk registered under it are two halves that can drift apart.
	const mountSnackBar = async () => {
		await import('../../lib/src/components/snack-bar.js');
		const bar = document.createElement('snack-bar');
		document.body.append(bar);
		await bar.updateComplete;
		return bar;
	};

	const visibleToasts = (bar) =>
		Array.from(bar.shadowRoot.querySelectorAll('.toast'));

	it('shows the navigation receipt on screen, with a working Undo', async () => {
		for (const entry of [...store.getState().app.snackbars]) {
			store.dispatch({ type: 'DISMISS_SNACKBAR', snackbarID: entry.id });
		}
		const bar = await mountSnackBar();
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/');

		await bar.updateComplete;
		const toasts = visibleToasts(bar);
		assert.strictEqual(toasts.length, 1, 'the receipt must be on screen, not merely in the store');
		assert.match(toasts[0].textContent, /Now showing/,
			'the toast must carry the receipt\'s own words');
		//'info' is the honest kind: nothing was written to a server, so it gets no
		//status dot. 'committed'/'queued' are write-outcome words (snackbar-copy).
		assert.strictEqual(toasts[0].dataset.kind, 'info');
		assert.strictEqual(toasts[0].querySelector('.dot'), null);
		const undo = Array.from(toasts[0].querySelectorAll('button'))
			.find((button) => button.textContent.trim() === 'Undo');
		assert.ok(undo, 'a receipt with nothing to press is not a receipt');

		undo.click();
		await bar.updateComplete;
		//Pressing it returns to the collection the receipt interrupted and says
		//nothing further: the promise was kept, so there is nothing to report.
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.deepStrictEqual(store.getState().app.snackbars, []);
		bar.remove();
	});

	//THE UNDO REDESIGN, DRIVEN THROUGH THE REAL BUTTON.
	//
	//Undo used to be history.back() behind a guard that required the live URL's
	//card to alias the one recorded at commit time. But the COMMIT auto-selects
	//a card and the route then canonicalizes it, so the guard refused an Undo
	//pressed with zero user actions in between — observed live. Undo now
	//re-navigates to the collection the receipt interrupted, and the card at
	//either end is none of its business.
	const commitStarredWithReceipt = async () => {
		for (const entry of [...store.getState().app.snackbars]) {
			store.dispatch({ type: 'DISMISS_SNACKBAR', snackbarID: entry.id });
		}
		const bar = await mountSnackBar();
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await bar.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/');
		return bar;
	};

	const pressUndo = async (bar) => {
		const undo = Array.from(bar.shadowRoot.querySelectorAll('.toast button'))
			.find((button) => button.textContent.trim() === 'Undo');
		assert.ok(undo, 'the receipt must still offer an Undo to press');
		undo.click();
		await bar.updateComplete;
	};

	it('undoes after the commit has auto-selected a card for the user', async () => {
		const bar = await commitStarredWithReceipt();
		//What the app itself does a beat after arriving: pick a card and
		//canonicalize the route around it. No user action at all.
		window.history.replaceState({}, '', '/c/starred/auto-selected-card');
		await pressUndo(bar);
		assert.strictEqual(window.location.pathname, '/c/main/',
			'the receipt returns to the collection it interrupted');
		assert.deepStrictEqual(store.getState().app.snackbars, [],
			'a kept promise reports nothing');
		bar.remove();
	});

	it('undoes the collection even after the user picks a different card', async () => {
		const bar = await commitStarredWithReceipt();
		window.history.replaceState({}, '', '/c/starred/some-card-the-user-clicked');
		await pressUndo(bar);
		assert.strictEqual(window.location.pathname, '/c/main/',
			'it is a collection-level undo; reading a card is not moving on');
		bar.remove();
	});

	it('refuses the receipt\'s Undo out loud, and only once the user is back', async () => {
		const bar = await commitStarredWithReceipt();
		//The user has already walked back to where the receipt would return
		//them. Now, and only now, there is genuinely nothing to undo.
		window.history.replaceState({}, '', '/c/main/some-card');
		await pressUndo(bar);
		//A refusal is never silent (HOUSE-STYLE §3.5): the receipt is replaced by
		//a plain message rather than quietly doing nothing. This is the ONLY
		//outcome other than the navigation — the old silent no-op path (a
		//history.back() with nothing behind it) no longer exists.
		const snackbars = store.getState().app.snackbars;
		assert.strictEqual(snackbars.length, 1);
		assert.match(snackbars[0].message, /nothing to undo/);
		assert.strictEqual(snackbars[0].action, undefined,
			'the refusal has nothing to press; offering Undo again would be a lie');
		assert.strictEqual(window.location.pathname, '/c/main/some-card');
		bar.remove();
		window.history.replaceState({}, '', '/c/main/');
	});

	it('Enter on an untouched draft closes the composer without navigating', async () => {
		await seedRecents([['main/starred/', 4]]);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.strictEqual(store.getState().collection.snapshot, null);
	});

	it('only an explicit Arrow key makes a suggestion the Enter target', async () => {
		await seedRecents([['main/starred/', 4]]);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		//Arrowing into a list with nothing highlighted lands on the first row
		//rather than skipping one.
		assert.strictEqual(highlightedRow().id, 'collection-suggestion-0');
		//The seeded recent (Main AND Starred) and the "Add Starred" refinement
		//resolve to the identical collection, so only one row offers it — the
		//refinement, which teaches the transformation. Either way Enter lands on
		//the same collection.
		assert.match(highlightedRow().textContent, /Add Starred/);
		assert.ok(!suggestionLabels().some((label) => label.includes('Main AND Starred')),
			'the recent that duplicates a refinement\'s destination is not offered twice');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/');
	});

	//Recents are destinations, and the collection you are already standing in is
	//not one: opening it throws the draft away and changes nothing.
	it('never offers the collection already on screen as a recent destination', async () => {
		await seedRecents([['main/', 9], ['main/starred/sort/recent/', 2]]);
		//This one IS the collection visited before the active one, which is the
		//only recent allowed to claim a direction.
		assert.ok(suggestionLabels().some((label) => label.includes('Back to Main AND Starred')),
			'an unrelated recent is still offered');
		assert.ok(!suggestionLabels().some((label) => /(Open|Back to) Main(?! AND)/.test(label)),
			'the active collection is not offered even before the draft diverges');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		//Now the draft is Main AND Starred, so deduping against the draft alone
		//would let "Back to Main" — the collection on screen — reappear.
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.ok(!suggestionLabels().some((label) => /(Open|Back to) Main(?! AND)/.test(label)),
			'the active collection stays suppressed once the draft diverges from it');
		assert.ok(suggestionLabels().some((label) => label.includes('Back to Main AND Starred')),
			'and the recent that is genuinely a different collection survives');
	});

	it('says so, in the dialog, when a chosen destination is already open', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		//"Remove Starred" rebuilds exactly the collection already on screen.
		assert.match(highlightedRow().textContent, /Remove Starred/);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'the composer stays open rather than vanishing with no explanation');
		assert.match(dialog.shadowRoot.querySelector('.activation-message').textContent,
			/This collection is already open\./);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'the draft survives');
		assert.strictEqual(window.location.pathname, '/c/main/');
	});

	//mouseenter fires whenever rows shift under a resting cursor, so a re-render
	//used to hand whatever row landed under the pointer the power to decide what
	//Enter does.
	it('a re-render under a resting cursor does not take the highlight', async () => {
		await seedRecents([['main/starred/', 4]]);
		const rows = suggestionRows();
		assert.ok(rows.length > 3);
		rows[3].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow(), null,
			'mouseenter without a mousemove is not evidence the pointer moved');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-suggestion-0');
		suggestionRows()[3].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-suggestion-0',
			'the keyboard keeps the highlight across a re-render the user did not point at');
		//Genuine hovering still works.
		suggestionRows()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-suggestion-3');
		//And once the pointer has proven it moves, mouseenter is honored again.
		suggestionRows()[1].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-suggestion-1');
	});

	//HOVER AND KEYBOARD SELECTION MUST NOT BOTH READ AS SELECTED.
	//
	//They painted the identical lavender fill, with keyboard selection adding
	//only a 3px bar — so with the cursor resting anywhere over the list, two
	//rows looked chosen and only one of them was the one Enter would take. The
	//spec's MUST is that "the transformation accepted on keydown is the one
	//visibly highlighted on keydown", so hover paints only while the POINTER
	//owns the highlight, and in that state the hovered row IS the highlighted
	//row. JSDOM computes no styles, so the rule's shape is pinned; the state it
	//is gated on is driven for real.
	it('paints a hover fill only while the pointer owns the highlight', async () => {
		const styles = composerStyles();
		const hover = styles.match(/[^}]*\.suggestion button:hover\s*\{[^}]*\}/g) || [];
		assert.ok(hover.length, 'there must be a hover rule to check');
		for (const rule of hover) {
			assert.match(rule, /:host\(\[data-pointer-armed\]\)\s*\.suggestion button:hover/,
				'every hover rule for a row must be gated on the pointer owning the highlight');
		}
		//And the keyboard-owned row gets more than a bar: the fill, the bar,
		//and its action chip filled rather than outlined.
		assert.match(styles, /\.suggestion button\[data-highlighted\]\s*\{[^}]*border-left-color:\s*var\(--app-primary-color\)/);
		assert.match(styles, /\.suggestion button\[data-highlighted\] \.suggestion-action\s*\{[^}]*background:\s*var\(--app-primary-color\)/,
			'the chip on the accepted row is filled, which no hovered row ever is');

		await seedRecents([['main/starred/', 4]]);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.ok(!dialog.hasAttribute('data-pointer-armed'),
			'a keystroke hands the highlight back to the keyboard, and hover stops painting');
		suggestionRows()[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
		await dialog.updateComplete;
		assert.ok(dialog.hasAttribute('data-pointer-armed'),
			'a real mousemove hands it to the pointer, and hover paints again');
		assert.strictEqual(highlightedRow().id, 'collection-suggestion-2',
			'and the row under the cursor is the highlighted one, so there is still only one');
	});

	//The catalog is painted by the same .suggestion rules, so it needs the same
	//rule: the row under a moving cursor becomes the highlighted row, rather
	//than hover fill landing on one row while the keyboard index sits on
	//another. Its Enter acts on _catalogHighlightedIndex.
	it('moves the catalog highlight to the row a moving pointer is over', async () => {
		dialog.shadowRoot.querySelector('.builder-toggle button').click();
		await settleRender(dialog);
		const rows = Array.from(dialog.shadowRoot.querySelectorAll('.catalog-list [role="option"]'));
		assert.ok(rows.length > 2, 'the catalog must have rows to check');
		assert.strictEqual(dialog._catalogHighlightedIndex, 0);
		rows[2].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(dialog._catalogHighlightedIndex, 0,
			'mouseenter without a mousemove is not evidence the pointer moved, here either');
		rows[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._catalogHighlightedIndex, 2);
		assert.strictEqual(dialog.shadowRoot.querySelector('.catalog-list [role="option"][data-highlighted]'), rows[2],
			'and it is the visibly highlighted one, which is what Enter takes');
	});

	it('Escape cancels the draft without changing the active collection', async () => {
		const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
		buttons.find((button) => button.textContent.includes('Add Starred')).click();
		await dialog.updateComplete;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.strictEqual(store.getState().collection.snapshot, null);
		assert.deepStrictEqual(store.getState().collection.active.filterNames, []);
		assert.strictEqual(window.location.pathname, '/c/main/');
	});

	//DIALOG OVER DIALOG. The composer's nested-Escape binding sits one notch
	//ABOVE dialog priority so it can peel the composer's own layers first — and
	//that outranks the Escape of a dialog stacked on TOP of it. Opening the card
	//picker from inside the filter catalog and pressing Escape peeled the
	//catalog, two layers below what the user was looking at, and left the picker
	//on screen. The binding declines while any other dialog is open now.
	it('lets Escape close only the card picker, leaving the composer and its draft', async () => {
		dialog._cardTagInfos = { 'card-1': { id: 'card-1', title: 'Inductively Knowable' } };
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'similar';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('[data-filter=\'similar\']').click();
		await dialog.updateComplete;
		assert.strictEqual(dialog._catalogOpen, true);
		assert.strictEqual(dialog._pendingCatalogFilter, 'similar/key-card-id');

		const keyCard = dialog.shadowRoot
			.querySelector('.pending-filter-editor configure-collection-filter').shadowRoot
			.querySelector('configure-collection-key-card');
		await keyCard.updateComplete;
		keyCard.shadowRoot.querySelector('#choose-card').click();
		await keyCard.updateComplete;
		assert.strictEqual(store.getState().find.open, true);

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		await findDialog.updateComplete;
		assert.strictEqual(store.getState().find.open, false, 'Escape closes the picker');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'and only the picker — the composer is still open');
		assert.strictEqual(dialog._catalogOpen, true, 'with the layer the user was in intact');
		assert.strictEqual(dialog._pendingCatalogFilter, 'similar/key-card-id',
			'and the filter being configured not thrown away');

		//The picker still works after the detour, and the value still lands.
		keyCard.shadowRoot.querySelector('#choose-card').click();
		await keyCard.updateComplete;
		findDialog._handleThumbnailTapped({ detail: { card: 'card-1' } });
		await dialog.updateComplete;
		assert.strictEqual(dialog._pendingCatalogFilter, 'similar/card-1');

		//And with the picker gone, Escape peels the composer's own layers again.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._pendingCatalogFilter, '');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
	});

	it('lets the keyboard drive the card picker, and hands focus back on close', async () => {
		//The picker was mouse-only: no keydown handler anywhere in find-dialog,
		//and card-thumbnail-list's thumbnails are plain divs with no tabindex,
		//so dialog-element's own Tab cycle skipped them too. A keyboard user
		//could type a query and then had nowhere to go with the results.
		dialog._cardTagInfos = {
			'card-1': { id: 'card-1', title: 'Inductively Knowable' },
			'card-2': { id: 'card-2', title: 'Mechanistically Knowable' },
		};
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'similar';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('[data-filter=\'similar\']').click();
		await dialog.updateComplete;
		const keyCard = dialog.shadowRoot
			.querySelector('.pending-filter-editor configure-collection-filter').shadowRoot
			.querySelector('configure-collection-key-card');
		await keyCard.updateComplete;
		const invoker = keyCard.shadowRoot.querySelector('#choose-card');
		invoker.focus();
		invoker.click();
		await keyCard.updateComplete;
		await findDialog.updateComplete;
		assert.strictEqual(findDialog._picker, true, 'configuring is a picker like linking and permissions');

		//The harness's find collection is empty (no corpus worker), so the list
		//the keyboard walks is stood in for directly. What is under test is the
		//navigation and the pick, not the query that produced the results.
		findDialog._collection = {
			finalSortedCards: [
				{ id: 'card-1', title: 'Inductively Knowable' },
				{ id: 'card-2', title: 'Mechanistically Knowable' },
			],
		};
		await findDialog.updateComplete;

		const query = findDialog.shadowRoot.querySelector('#query');
		assert.strictEqual(query.getAttribute('role'), 'combobox', 'the picker states its idiom');
		const arrow = (key) => query.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

		//Nothing is highlighted until the user arrows in, so the first Enter
		//cannot commit a card nobody chose.
		assert.strictEqual(findDialog._highlightedCardID, '');
		const ids = findDialog._pickerCardIDs;
		assert.ok(ids.length >= 2, 'the fixture has cards to arrow through');
		arrow('ArrowDown');
		await findDialog.updateComplete;
		assert.strictEqual(findDialog._highlightedCardID, ids[0], 'ArrowDown enters at the top');
		arrow('ArrowDown');
		await findDialog.updateComplete;
		assert.strictEqual(findDialog._highlightedCardID, ids[1]);
		arrow('ArrowUp');
		await findDialog.updateComplete;
		assert.strictEqual(findDialog._highlightedCardID, ids[0]);
		//The highlight is visible, through card-drawer's existing property.
		assert.strictEqual(findDialog.shadowRoot.querySelector('card-drawer').highlightedCardId, ids[0]);
		//And audible, because aria-activedescendant cannot name an element two
		//shadow roots down.
		assert.match(findDialog._highlightedCardAnnouncement, new RegExp(`1 of ${ids.length}`));

		query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await findDialog.updateComplete;
		assert.strictEqual(store.getState().find.open, false, 'Enter picks and closes');
		assert.strictEqual(dialog._pendingCatalogFilter, `similar/${ids[0]}`, 'and the value lands');
		//Enter and a click are the same act, so they go through one path.
		assert.strictEqual(typeof findDialog._pickCard, 'function');
	});

	//Ctrl-K opens the composer, but every OTHER modal refuses it — including the
	//picker the composer itself opens.
	it('refuses Ctrl-K while the card picker it opened is in front', async () => {
		const { selectKeyboardNavigatesIgnoringCollectionComposer } =
			await import('../../lib/src/selectors.js');
		assert.strictEqual(selectKeyboardNavigatesIgnoringCollectionComposer(store.getState()), true);
		store.dispatch({ type: 'FIND_CARD_TO_CONFIGURE', query: '', requestID: 'a-request' });
		assert.strictEqual(selectKeyboardNavigatesIgnoringCollectionComposer(store.getState()), false);
	});

	it('keeps the draft open and explains when editing blocks navigation', async () => {
		const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
		buttons.find((button) => button.textContent.includes('Add Starred')).click();
		await dialog.updateComplete;
		store.dispatch({ type: 'TEST_SET_EDITING', value: true });
		const primary = dialog.shadowRoot.querySelector('.composer-actions button[aria-label="Open this collection"]');
		primary.click();
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.match(dialog.shadowRoot.querySelector('.activation-message').textContent, /Finish or cancel/);
	});

	it('renders accepted clauses with explicit edit, remove, and Undo controls', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		const clause = dialog.shadowRoot.querySelector('.expression-clause');
		assert.match(clause.textContent, /Starred/);
		assert.strictEqual(clause.querySelector('.expression-clause-label').getAttribute('aria-label'), 'Edit Starred filter');
		clause.querySelector('.expression-clause-remove').click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.match(dialog.shadowRoot.querySelector('.draft-receipt').textContent, /Removed Starred/);
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Undo')).click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
	});

	//THE DRAFT READS AS A SENTENCE, NOT AS A FORM.
	//
	//Four separate ways it did not. The remove control was a literal × where
	//CANCEL_ICON exists, which §4.2 forbids outright. The set name — the one
	//term that is NOT interactive — was bold purple 700, the loudest token in
	//the dialog, while every editable clause sat in a quiet grey box. The chip
	//itself was a bordered white box with a second rule down its middle, which
	//is the anatomy of a table cell. And AND was a sibling of the chip it
	//introduces in a wrapping row, so a line could end on a dangling operator
	//with its clause on the line below.
	it('renders the draft as a sentence rather than a row of form fields', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;

		const remove = dialog.shadowRoot.querySelector('.expression-clause-remove');
		assert.ok(remove.querySelector('svg'), 'the remove control is an icon, not a text glyph');
		assert.ok(!remove.textContent.includes('×'), 'the literal × is gone');
		assert.strictEqual(remove.getAttribute('aria-label'), 'Remove Starred filter');

		//The operator and the clause it introduces are ONE inline group, so they
		//cannot be split across a wrap.
		const term = dialog.shadowRoot.querySelector('.expression-term');
		assert.ok(term, 'each clause is bound to its operator');
		assert.match(term.querySelector('.expression-operator').textContent, /AND/);
		assert.ok(term.querySelector('.expression-clause'), 'the chip lives inside that group');

		//The help badge defines a word; it is a footnote to the sentence, not
		//its first element.
		const expressionChildren = Array.from(dialog.shadowRoot.querySelector('.expression').children);
		assert.ok(!expressionChildren[0].classList.contains('help'),
			'the badge must not open the sentence');
		assert.ok(expressionChildren[expressionChildren.length - 1].classList.contains('help'),
			'it follows the expression instead');

		const styles = composerStyles();
		//The non-interactive set name reads at the sentence's own weight; purple
		//is the brand/link/committing colour (§4.5) and this is none of those.
		assert.match(styles, /\.expression-set\s*\{[^}]*color:\s*var\(--app-dark-text-color\)/);
		assert.match(styles, /\.expression-set\s*\{[^}]*font-weight:\s*400/);
		//The chip carries the presence instead, as a wash rather than a cell.
		assert.match(styles, /\.expression-clause\s*\{[^}]*background:\s*var\(--app-primary-color-light-very-transparent\)/);
		assert.ok(!/\.expression-clause-remove\s*\{[^}]*border-left/.test(styles),
			'the internal vertical rule that made the chip read as a table cell is gone');
		//And the removal stays quiet until it is hovered or focused, with no
		//warning colour: removing a draft clause loses nothing (§3.7 Tier 2).
		assert.match(styles, /\.expression-clause-remove svg\s*\{[^}]*fill:\s*var\(--app-dark-text-color-light\)/);
		assert.ok(!/expression-clause-remove[^}]*--app-warning-color/.test(styles));
		//The input continues the sentence: its flex basis is what decides
		//whether it fits beside the last chip, so it must be a typing minimum
		//rather than a full field width.
		assert.match(styles, /\.composer-input\s*\{[^}]*flex:\s*1 1 8em/);
	});

	//A RECEIPT IS A THING, SO IT NEEDS AN EDGE. This strip floated between the
	//input and the suggestion list with no container of its own, in a grey
	//(#AAA, ~2.3:1) that this file has already rejected once for text that has
	//to be read — and it sat hard against the list's clipping fade.
	it('gives the draft receipt a container of its own', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		assert.ok(dialog.shadowRoot.querySelector('.draft-receipt'));
		const styles = composerStyles();
		assert.match(styles, /\.draft-receipt\s*\{[^}]*background:\s*var\(--app-primary-color-light-very-transparent\)/);
		assert.match(styles, /\.draft-receipt\s*\{[^}]*padding:/);
		assert.match(styles, /\.draft-receipt\s*\{[^}]*color:\s*var\(--app-dark-text-color-darker\)/);
	});

	it('uses two-step Backspace to select and then remove the last clause', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.ok(dialog.shadowRoot.querySelector('.expression-clause').hasAttribute('data-selected'));
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
	});

	it('does not interpret composing keystrokes as clause commands', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Backspace',
			isComposing: true,
			bubbles: true,
			cancelable: true,
		}));
		input.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Backspace',
			keyCode: 229,
			bubbles: true,
			cancelable: true,
		}));
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(dialog.shadowRoot.querySelector('.expression-clause').hasAttribute('data-selected'), false);
	});

	it('preserves draft Undo while keyboard-selecting a clause', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		const undo = Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Undo'));
		assert.ok(undo);
		undo.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
	});

	it('zooms from a clause into its builder control and Escape returns', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await dialog.updateComplete;
		const filter = dialog.shadowRoot.querySelector('configure-collection-filter');
		//Focus now waits for the editor's own render before deciding whether it
		//found a control, so the assertion has to wait for the same road.
		await settleRender(dialog, filter);
		assert.strictEqual(filter.shadowRoot.querySelector('select'), null);
		assert.strictEqual(dialog.shadowRoot.activeElement?.textContent, 'Done editing');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.strictEqual(dialog.shadowRoot.querySelector('configure-collection-filter'), null);
		assert.strictEqual(dialog.shadowRoot.activeElement?.id, 'collection-composer-input');

		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.ok(dialog.shadowRoot.querySelector('.expression-clause').hasAttribute('data-selected'));
	});

	it('focuses a configurable clause value and saves direct edits', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'inductively knowable';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const querySuggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Text contains “inductively knowable”'));
		assert.ok(querySuggestion);
		querySuggestion.click();
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await dialog.updateComplete;
		const filter = dialog.shadowRoot.querySelector('configure-collection-filter');
		await settleRender(dialog, filter);
		const queryInput = filter.shadowRoot.querySelector('.pieces input');
		assert.strictEqual(filter.shadowRoot.activeElement, queryInput);
		queryInput.value = 'mechanistically knowable';
		queryInput.dispatchEvent(new Event('change', { bubbles: true }));
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['query/mechanistically knowable']);
	});

	it('manual builder collapse disarms the edited clause', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Done editing')).click();
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('configure-collection-filter'), null);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		assert.strictEqual(dialog.shadowRoot.activeElement, input);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.ok(dialog.shadowRoot.querySelector('.expression-clause').hasAttribute('data-selected'));
	});

	//Removing the clause the editor is open on used to leave the panel expanded
	//with nothing in it: _selectedClauseIndex went to -1 while _builderExpanded
	//stayed true, so '' rendered into a still-visible .builder container.
	it('collapses the clause editor when the clause being edited is removed', async () => {
		const add = (label) => {
			const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
				.find((button) => button.textContent.includes(label));
			assert.ok(suggestion, `no suggestion labeled ${label}`);
			suggestion.click();
			return dialog.updateComplete;
		};
		await add('Add Starred');
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await dialog.updateComplete;
		assert.ok(dialog.shadowRoot.querySelector('.clause-editor'));
		dialog.shadowRoot.querySelector('.expression-clause-remove').click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.strictEqual(dialog.shadowRoot.querySelector('.clause-editor'), null);
		assert.strictEqual(dialog.shadowRoot.querySelector('.builder'), null,
			'an empty builder container must not stay on screen');
	});

	it('keeps editing the same clause when a different one is removed', async () => {
		const add = (label) => {
			const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
				.find((button) => button.textContent.includes(label));
			assert.ok(suggestion, `no suggestion labeled ${label}`);
			suggestion.click();
			return dialog.updateComplete;
		};
		await add('Add Starred');
		await add('Add Unread');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred', 'unread']);
		const clauses = () => Array.from(dialog.shadowRoot.querySelectorAll('.expression-clause'));
		//Edit the second clause, then remove the first: the editor must follow the
		//clause, which has just been renumbered from index 1 to index 0.
		clauses()[1].querySelector('.expression-clause-label').click();
		await dialog.updateComplete;
		assert.ok(dialog.shadowRoot.querySelector('.clause-editor'));
		clauses()[0].querySelector('.expression-clause-remove').click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['unread']);
		const editor = dialog.shadowRoot.querySelector('.clause-editor');
		assert.ok(editor, 'the editor must stay open on the clause it was editing');
		assert.match(editor.textContent, /Unread/);
	});

	it('browses a categorized catalog and adds an ordinary filter without opening', async () => {
		dialog._composerCandidates = [{
			filter: 'inductively-knowable',
			category: 'tag',
			label: 'Tagged “Inductively Knowable”',
			detail: 'Keeps cards tagged Inductively Knowable',
			aliases: ['tag', 'inductively knowable'],
		}];
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		assert.strictEqual(input.getAttribute('aria-controls'), 'collection-filter-catalog');
		assert.match(dialog.shadowRoot.textContent, /Dates/);
		assert.match(dialog.shadowRoot.textContent, /Tags and sections/);
		assert.ok(dialog.shadowRoot.querySelector('[aria-label=\'Starting collection set\']'));
		assert.ok(dialog.shadowRoot.querySelector('[aria-label=\'Card order\']'));
		assert.ok(dialog.shadowRoot.querySelector('[aria-label=\'Collection view\']'));
		const starred = Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [role=option]'))
			.find((button) => button.textContent.includes('Starred'));
		assert.ok(starred);
		starred.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.match(dialog.shadowRoot.querySelector('#collection-filter-catalog').textContent, /Already in this collection/);
	});

	it('makes capped catalog categories explicit and expandable', async () => {
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const catalog = dialog.shadowRoot.querySelector('#collection-filter-catalog');
		const before = catalog.querySelectorAll('[data-filter]').length;
		//The visible label is a grammatical fragment for every category; the
		//category lives in the accessible name, where it can be a phrase.
		const more = Array.from(catalog.querySelectorAll('.catalog-more'))
			.find((button) => button.getAttribute('aria-label').includes('filters in card properties'));
		assert.ok(more);
		assert.match(more.textContent, /^\s*Show \d+ more\s*$/);
		assert.match(more.getAttribute('aria-label'), /^Show \d+ more filters in card properties$/);
		more.click();
		await dialog.updateComplete;
		const after = dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [data-filter]').length;
		assert.ok(after > before);
		const fewer = Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog .catalog-more'))
			.find((button) => button.getAttribute('aria-label') === 'Show fewer filters in card properties');
		assert.ok(fewer);
		assert.match(fewer.textContent, /^\s*Show fewer\s*$/);
	});

	it('searches catalog aliases and configures a filter before committing it', async () => {
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'text';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const query = Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [role=option]'))
			.find((button) => button.textContent.includes('Query'));
		assert.ok(query);
		assert.match(query.textContent, /configure/i);
		query.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		const pending = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter');
		assert.ok(pending);
		assert.strictEqual(pending.shadowRoot.querySelector('select'), null);
		const add = dialog.shadowRoot.querySelector('.pending-filter-actions button[aria-label="Add this filter to the draft"]');
		assert.strictEqual(add.disabled, true);
		const queryInput = pending.shadowRoot.querySelector('.pieces input');
		queryInput.value = 'inductively knowable';
		queryInput.dispatchEvent(new Event('change', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(add.disabled, false);
		add.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['query/inductively knowable']);
		assert.match(dialog.shadowRoot.textContent, /Added Text contains “inductively knowable”/);
	});

	it('lands focus inside the editor a Configure row just opened', async () => {
		//Opening an editor and leaving focus in the search field behind it puts
		//the field the user asked for a dozen Tabs away. focusPrimaryControl was
		//always wired here; what it lacked was anything to find, because it ran
		//before the editor it queries had rendered.
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const catalogInput = dialog.shadowRoot.querySelector('#collection-composer-input');
		catalogInput.value = 'text';
		catalogInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [role=option]'))
			.find((button) => button.textContent.includes('Query')).click();
		await dialog.updateComplete;
		const pending = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter');
		await settleRender(dialog, pending);
		assert.notStrictEqual(dialog.shadowRoot.activeElement?.id, 'collection-composer-input',
			'focus must not stay in the search field behind the editor');
		assert.strictEqual(dialog.shadowRoot.activeElement, pending);
		assert.strictEqual(pending.shadowRoot.activeElement, pending.shadowRoot.querySelector('.pieces input'));
		//And Escape still peels this layer rather than closing the composer.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.strictEqual(dialog.shadowRoot.querySelector('.pending-filter-editor'), null);
	});

	it('routes typed configurable families through guided controls before changing the draft', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'updated';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role=option]'))
			.find((button) => button.textContent.includes('Configure Updated'));
		assert.ok(suggestion);
		assert.match(suggestion.textContent, /configure/i);
		suggestion.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.ok(dialog.shadowRoot.querySelector('.pending-filter-editor'));
		assert.strictEqual(dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter').value, 'updated/after/7-days-ago');
	});

	it('routes nested collection expressions to discoverable Source mode without changing the draft', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'exclude';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role=option]'))
			.find((button) => button.textContent.includes('Edit Exclude in Source'));
		assert.ok(suggestion);
		assert.match(suggestion.textContent, /source/i);
		//Sentence case, and in the DOM rather than only on the screen. The chip
		//used to be lowercase text painted ALL-CAPS by text-transform, so the
		//accessible name said "edit" while the screen said "EDIT" — and HS-2.1
		//asks for sentence case on an action label, which is neither of those.
		assert.strictEqual(suggestion.querySelector('.suggestion-action').textContent, 'Edit');
		//Opening a nested expression in Source does not LEAVE the composer, so
		//the chip carries the quiet transform treatment rather than Open's
		//filled one.
		assert.strictEqual(suggestion.querySelector('.suggestion-action').getAttribute('data-consequence'), 'transform');
		suggestion.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.strictEqual(dialog._entryMode, 'source');
		//`/c/main/exclude/`, not `/c/exclude/`: every collection path the composer
		//writes now comes from collectionURLPath, whose whole point is that the
		//bare Main collection is never spelled as nothing. Both texts parse to
		//the same description — Main is the default set — so this is the same
		//source said unambiguously.
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-source-input').value, '/c/main/exclude/');
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /needs 1 more value/);
		assert.match(dialog.shadowRoot.querySelector('#collection-source-completions').textContent, /Working Notes/);
		const source = dialog.shadowRoot.querySelector('#collection-source-input');
		source.value = '/c/exclude/working-n/';
		source.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(dialog.shadowRoot.querySelector('#collection-source-completions').textContent, /Working Notes/);
	});

	it('supports keyboard catalog search and lets Escape back out one layer', async () => {
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'query';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await dialog.updateComplete;
		assert.ok(dialog.shadowRoot.querySelector('.pending-filter-editor'));
		const pendingInput = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter').shadowRoot.querySelector('input');
		pendingInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('.pending-filter-editor'), null);
		assert.ok(dialog.shadowRoot.querySelector('#collection-filter-catalog'));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-filter-catalog'), null);
		assert.strictEqual(dialog.open, true);
	});

	it('offers a safe rolling date default without requiring a meaningless edit', async () => {
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const updated = Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [role=option]'))
			.find((button) => button.textContent.includes('Updated'));
		assert.ok(updated);
		updated.click();
		await dialog.updateComplete;
		const add = dialog.shadowRoot.querySelector('.pending-filter-actions button[aria-label="Add this filter to the draft"]');
		assert.strictEqual(add.disabled, false);
		const pending = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter');
		assert.strictEqual(pending.value, 'updated/after/7-days-ago');
		const dateControl = pending.shadowRoot.querySelector('configure-collection-date');
		await dateControl.updateComplete;
		assert.match(dateControl.shadowRoot.textContent, /Rolling date/);
		assert.match(dateControl.shadowRoot.textContent, /A time ago/);
		add.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['updated/after/7-days-ago']);
	});

	//A readback test: assert what the control DISPLAYS, not what confirming it
	//produces. The comparison <select> rendered at selectedIndex 0 ("Before")
	//while the seeded filter said "after", and a 41-test suite that only ever
	//asserted the committed value never saw it.
	it('displays the comparison the seeded date filter actually names', async () => {
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [role=option]'))
			.find((button) => button.textContent.includes('Updated')).click();
		await dialog.updateComplete;
		const pending = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter');
		assert.strictEqual(pending.value, 'updated/after/7-days-ago');
		const dateControl = pending.shadowRoot.querySelector('configure-collection-date');
		await dateControl.updateComplete;
		const comparison = dateControl.shadowRoot.querySelector('[aria-label="Date comparison"]');
		assert.strictEqual(comparison.value, 'after');
		assert.strictEqual(comparison.selectedIndex, 1);
		assert.strictEqual(comparison.options[comparison.selectedIndex].textContent, 'After');
		assert.deepStrictEqual(
			Array.from(comparison.options).filter((option) => option.selected).map((option) => option.value),
			['after']
		);
		//And the same control, reopened on an applied clause, still reads back what
		//the clause says rather than the first option.
		dialog.shadowRoot.querySelector('.pending-filter-actions button[aria-label="Add this filter to the draft"]').click();
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await dialog.updateComplete;
		const appliedDate = dialog.shadowRoot
			.querySelector('configure-collection-filter').shadowRoot
			.querySelector('configure-collection-date');
		await appliedDate.updateComplete;
		assert.strictEqual(
			appliedDate.shadowRoot.querySelector('[aria-label="Date comparison"]').value,
			'after'
		);
	});

	it('reads back every date sub-control rather than its first option', async () => {
		const dateControl = document.createElement('configure-collection-date');
		dateControl.value = 'between/last-thursday/yesterday';
		document.body.append(dateControl);
		try {
			await dateControl.updateComplete;
			const displayed = (label) => {
				const select = dateControl.shadowRoot.querySelector(`[aria-label="${label}"]`);
				return select.options[select.selectedIndex].value;
			};
			assert.strictEqual(displayed('Date comparison'), 'between');
			assert.strictEqual(displayed('First rolling date kind'), 'weekday');
			assert.strictEqual(displayed('First rolling weekday'), 'thursday');
			assert.strictEqual(displayed('Second rolling date kind'), 'special');
			assert.strictEqual(displayed('Second rolling special date'), 'yesterday');
		} finally {
			dateControl.remove();
		}
	});

	it('configures each boundary of a rolling date range independently', async () => {
		const dateControl = document.createElement('configure-collection-date');
		dateControl.value = 'between/3-days-ago/yesterday';
		dateControl.addEventListener('filter-modified-complex', (event) => {
			dateControl.value = event.detail.value;
		});
		document.body.append(dateControl);
		try {
			await dateControl.updateComplete;
			assert.strictEqual(
				dateControl.shadowRoot.querySelector('[aria-label="First rolling date kind"]').value,
				'offset'
			);
			assert.strictEqual(
				dateControl.shadowRoot.querySelector('[aria-label="First rolling date amount"]').value,
				'3'
			);
			const secondSpecial = dateControl.shadowRoot.querySelector('[aria-label="Second rolling special date"]');
			assert.strictEqual(secondSpecial.value, 'yesterday');
			secondSpecial.value = 'today';
			secondSpecial.dispatchEvent(new Event('change', { bubbles: true }));
			await dateControl.updateComplete;
			assert.strictEqual(dateControl.value, 'between/3-days-ago/today');
			assert.strictEqual(
				dateControl.shadowRoot.querySelector('[aria-label="First rolling date amount"]').value,
				'3'
			);
		} finally {
			dateControl.remove();
		}
	});

	it('supports fixed and rolling dates in the same range', async () => {
		const dateControl = document.createElement('configure-collection-date');
		dateControl.value = 'between/2026-08-01/yesterday';
		document.body.append(dateControl);
		try {
			await dateControl.updateComplete;
			const boundaries = dateControl.shadowRoot.querySelectorAll('.date-boundary');
			assert.strictEqual(boundaries.length, 2);
			assert.strictEqual(boundaries[0].querySelector('input[value="absolute"]').checked, true);
			assert.strictEqual(boundaries[0].querySelector('input[type="date"]').value, '2026-08-01');
			assert.strictEqual(boundaries[1].querySelector('input[value="relative"]').checked, true);
			assert.strictEqual(
				boundaries[1].querySelector('[aria-label="Second rolling special date"]').value,
				'yesterday'
			);
		} finally {
			dateControl.remove();
		}
	});

	it('configures card-valued filters from titled choices instead of raw IDs', async () => {
		dialog._cardTagInfos = {
			'card-1': { id: 'card-1', title: 'Inductively Knowable' },
			'card-2': { id: 'card-2', title: 'Mechanistic Magic' },
		};
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'similar';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('[data-filter=\'similar\']').click();
		await dialog.updateComplete;
		const pending = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter');
		const keyCard = pending.shadowRoot.querySelector('configure-collection-key-card');
		await keyCard.updateComplete;
		//HS-5: picking a card is find-dialog's job. The <select> this replaced
		//could only offer the cards the app happened to have loaded, in load
		//order, with no search.
		assert.strictEqual(keyCard.shadowRoot.querySelector('select'), null);
		//And with nothing picked yet it says so in words — never the raw id,
		//which is an internal identifier (HS-1.4).
		assert.match(keyCard.shadowRoot.textContent, /No card chosen yet/);
		assert.doesNotMatch(keyCard.shadowRoot.textContent, /key-card-id/);

		const choose = keyCard.shadowRoot.querySelector('#choose-card');
		assert.strictEqual(choose.getAttribute('aria-label'), 'Choose card');
		assert.strictEqual(choose.getAttribute('title'), 'Choose card', 'an icon-only button needs a hover name too (HS-2.5)');
		choose.click();
		await keyCard.updateComplete;
		assert.strictEqual(store.getState().find.open, true, 'the choose button opens the picker');
		assert.strictEqual(store.getState().find.configuring, true);
		assert.ok(store.getState().find.configureRequestID, 'the picker is told which control asked');

		//The pick travels the same road every other find mode's does: a tapped
		//thumbnail, reported through the mode's own action.
		findDialog._handleThumbnailTapped({ detail: { card: 'card-1' } });
		await settleRender(dialog, pending, keyCard);
		assert.strictEqual(pending.value, 'similar/card-1');
		assert.strictEqual(store.getState().find.open, false, 'picking closes the picker');
		//stateChanged recomputes _cardTagInfos from the (empty) corpus on every
		//dispatch, so the fake has to be restated once they have all landed.
		//That is this suite's standing fiction, not something the pick disturbed.
		dialog._cardTagInfos = {
			'card-1': { id: 'card-1', title: 'Inductively Knowable' },
			'card-2': { id: 'card-2', title: 'Mechanistic Magic' },
		};
		await settleRender(dialog, pending, keyCard);
		//The chosen card is shown by title, through the shared tag primitive.
		const shown = keyCard.shadowRoot.querySelector('tag-list');
		assert.deepStrictEqual(shown.tags, ['card-1']);
		assert.strictEqual(shown.tagInfos['card-1'].title, 'Inductively Knowable');

		const add = dialog.shadowRoot.querySelector('.pending-filter-actions button[aria-label="Add this filter to the draft"]');
		assert.strictEqual(add.disabled, false);
	});

	//Two key-card controls can be on screen at once, and the picker is one
	//dialog. Without an addressed answer, a pick made for the clause editor
	//would also land in the web-focus-card control beside it.
	it('delivers a picked card only to the control that asked for it', async () => {
		dialog._cardTagInfos = { 'card-2': { id: 'card-2', title: 'Mechanistic Magic' } };
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const view = dialog.shadowRoot.querySelector('[aria-label=\'Collection view\']');
		view.value = 'web';
		view.dispatchEvent(new Event('change', { bubbles: true }));
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'similar';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('[data-filter=\'similar\']').click();
		await dialog.updateComplete;

		const focusCard = dialog.shadowRoot.querySelector('.catalog-setup configure-collection-key-card');
		const clauseCard = dialog.shadowRoot
			.querySelector('.pending-filter-editor configure-collection-filter').shadowRoot
			.querySelector('configure-collection-key-card');
		await focusCard.updateComplete;
		await clauseCard.updateComplete;
		assert.ok(focusCard && clauseCard && focusCard !== clauseCard, 'both controls are live at once');

		clauseCard.shadowRoot.querySelector('#choose-card').click();
		await clauseCard.updateComplete;
		findDialog._handleThumbnailTapped({ detail: { card: 'card-2' } });
		await settleRender(dialog, focusCard, clauseCard);
		assert.strictEqual(dialog._pendingCatalogFilter, 'similar/card-2');
		assert.notStrictEqual(store.getState().collection.snapshot.viewModeExtra, 'card-2',
			'the control that did not ask must not take the answer');
	});

	it('shows contributor names while preserving durable author IDs', async () => {
		dialog._userIDs = ['alex-uid', 'sam-uid'];
		dialog._userInfos = {
			'alex-uid': { id: 'alex-uid', title: 'Alex Komoroske' },
			'sam-uid': { id: 'sam-uid', title: 'Sam Example' },
		};
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'author';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('[data-filter=\'author\']').click();
		await dialog.updateComplete;
		const pending = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter');
		const authorSelect = pending.shadowRoot.querySelector('.pieces select');
		assert.match(authorSelect.textContent, /Me/);
		assert.match(authorSelect.textContent, /Alex Komoroske/);
		assert.match(authorSelect.textContent, /Sam Example/);
		authorSelect.value = 'sam-uid';
		authorSelect.dispatchEvent(new Event('change', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(pending.value, 'author/sam-uid');
	});

	it('edits setup and applied catalog items through the same visual surface', async () => {
		const starred = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		starred.click();
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const view = dialog.shadowRoot.querySelector('[aria-label=\'Collection view\']');
		view.value = 'web';
		view.dispatchEvent(new Event('change', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(store.getState().collection.snapshot.viewMode, 'web');
		assert.ok(store.getState().collection.snapshot.viewModeExtra);
		dialog._cardTagInfos = { 'card-2': { id: 'card-2', title: 'Mechanistic Magic' } };
		await dialog.updateComplete;
		const focusCard = dialog.shadowRoot.querySelector('.catalog-setup configure-collection-key-card');
		await focusCard.updateComplete;
		assert.strictEqual(focusCard.shadowRoot.querySelector('select'), null);
		assert.match(focusCard.shadowRoot.textContent, /The first card in the collection/);
		focusCard.shadowRoot.querySelector('#choose-card').click();
		await focusCard.updateComplete;
		findDialog._handleThumbnailTapped({ detail: { card: 'card-2' } });
		await settleRender(dialog, focusCard);
		assert.strictEqual(store.getState().collection.snapshot.viewModeExtra, 'card-2');
		//stateChanged recomputes _cardTagInfos from the (empty) corpus on every
		//dispatch, so the fake has to be restated once they have all landed.
		dialog._cardTagInfos = { 'card-2': { id: 'card-2', title: 'Mechanistic Magic' } };
		await settleRender(dialog, focusCard);
		assert.deepStrictEqual(focusCard.shadowRoot.querySelector('tag-list').tags, ['card-2']);
		//The <select> also carried the way BACK to "whichever card the collection
		//opens on". A card picker cannot offer that, so it is its own control now
		//rather than something that quietly disappeared with the dropdown.
		focusCard.shadowRoot.querySelector('.discard').click();
		await settleRender(dialog, focusCard);
		assert.strictEqual(store.getState().collection.snapshot.viewModeExtra, '_');
		assert.match(focusCard.shadowRoot.textContent, /The first card in the collection/);
		focusCard.shadowRoot.querySelector('#choose-card').click();
		await focusCard.updateComplete;
		findDialog._handleThumbnailTapped({ detail: { card: 'card-2' } });
		await dialog.updateComplete;
		assert.strictEqual(store.getState().collection.snapshot.viewModeExtra, 'card-2');
		const appliedStarred = Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [role=option]'))
			.find((button) => button.textContent.includes('Starred'));
		appliedStarred.click();
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-filter-catalog'), null);
		const editor = dialog.shadowRoot.querySelector('configure-collection-filter');
		assert.ok(editor);
		assert.strictEqual(editor.shadowRoot.querySelector('select'), null);
		assert.match(editor.shadowRoot.textContent, /Remove filter/);
		assert.match(dialog.shadowRoot.textContent, /Done editing/);
		editor.shadowRoot.querySelector('.remove-filter').click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.strictEqual(dialog.shadowRoot.querySelector('configure-collection-filter'), null);
	});

	//THE SOURCE PANE'S TONES WERE INVERTED.
	//
	//'Ready to open' — the one state where nothing is wrong — took a loud 3px
	//purple bar, while the parse error took --app-divider-color, which on white
	//is invisible. The pane shouted when it had nothing to say and went silent
	//when the user had made a mistake. The spec asks for parse errors in the
	//existing warning colour, and §4.5 reserves purple for the committing
	//action, which on this pane is the Open button.
	it('tones the source diagnostic by what it is actually telling the user', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/main/');
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await settleRender(dialog);
		const status = () => dialog.shadowRoot.querySelector('#collection-source-status');
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		const type = async (value) => {
			input.value = value;
			input.dispatchEvent(new InputEvent('input', { bubbles: true }));
			await settleRender(dialog);
		};
		assert.strictEqual(status().getAttribute('data-status'), 'valid');
		await type('/c/exclude/');
		assert.strictEqual(status().getAttribute('data-status'), 'incomplete',
			'keep typing is not an error and must not be toned as one');
		await type('/c/main/zzzznotafilter/');
		assert.strictEqual(status().getAttribute('data-status'), 'unsupported');
		await type('https://evil.example.com/c/main/');
		assert.strictEqual(status().getAttribute('data-status'), 'invalid');

		const styles = composerStyles();
		assert.ok(!/\.source-status\[data-valid\]/.test(styles),
			'the boolean that could only say "valid or not" is gone; the tone needs three answers');
		assert.match(styles, /\.source-status\[data-status='valid'\]\s*\{[^}]*border-left-color:\s*var\(--app-secondary-color\)/,
			'valid is a quiet confirmation, not the loudest thing on the pane');
		assert.ok(!/\.source-status\[data-status='valid'\]\s*\{[^}]*var\(--app-primary-color\)/.test(styles),
			'purple belongs to the committing action (HS-4.5)');
		const error = styles.match(/\.source-status\[data-status='invalid'\],\s*\.source-status\[data-status='unsupported'\]\s*\{[^}]*\}/);
		assert.ok(error, 'the two refusing states share one rule');
		assert.match(error[0], /border-left-color:\s*var\(--app-warning-color\)/,
			'the spec asks for parse errors in the existing warning colour');
		//Neutral by omission: no rule may give the incomplete state a tone.
		assert.ok(!/\[data-status='incomplete'\]/.test(styles),
			'an incomplete source keeps the neutral rule');
	});

	it('opens Source mode from the current route with the exact text selected', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/everything/starred/card-7');
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		assert.ok(input);
		assert.strictEqual(input.value, '/c/everything/starred/card-7');
		assert.strictEqual(input.selectionStart, 0);
		assert.strictEqual(input.selectionEnd, input.value.length);
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /Ready to open/);
		assert.match(dialog.shadowRoot.textContent, /Opens on/);
	});

	it('hands visual composers into Source at the add-next position', async () => {
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit source')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		assert.strictEqual(input.selectionStart, input.value.length);
		assert.strictEqual(input.selectionEnd, input.value.length);
		input.value = `${input.value}upd`;
		input.setSelectionRange(input.value.length, input.value.length);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'upd' }));
		await dialog.updateComplete;
		//Source now OPENS at '/c/main/', because '/c/' names no collection at
		//all — the old text handed the router an empty collection portion. The
		//add-next position is still the end of that text, which is the property
		//this test is about.
		assert.strictEqual(input.value, '/c/main/upd/');
		assert.match(dialog.shadowRoot.textContent, /Updated/);
	});

	it('preserves invalid source and opens a valid route with its selected card', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		const open = () => dialog.shadowRoot.querySelector('.composer-actions .primary');
		input.value = 'updated/before/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(input.value, 'updated/before/');
		assert.strictEqual(open().disabled, true);
		assert.strictEqual(window.location.pathname, '/c/main/');

		input.value = '/c/everything/starred/card-9';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(open().disabled, false);
		open().click();
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/everything/starred/card-9');
		assert.strictEqual(dialog.open, false);
	});

	it('keeps source intact when editing blocks navigation', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = '/c/everything/starred/card-9';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		store.dispatch({ type: 'TEST_SET_EDITING', value: true });
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.composer-actions .primary').click();
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.strictEqual(dialog.open, true);
		assert.strictEqual(input.value, '/c/everything/starred/card-9');
		assert.match(dialog.shadowRoot.querySelector('.activation-message').textContent, /Finish or cancel/);
	});

	it('makes incomplete date grammar discoverable through completion', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = 'updated/before/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(dialog.shadowRoot.textContent, /today/);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(input.value, 'updated/before/today/');
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .primary').disabled, false);
	});

	it('exposes completions as an announced combobox and replaces the caret segment', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = '';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(input.getAttribute('role'), 'combobox');
		assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
		assert.ok(input.getAttribute('aria-activedescendant'));
		assert.match(dialog.shadowRoot.querySelector('#collection-source-completions').textContent, /Choose how cards are ordered/);

		input.value = 'sta/unread/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.setSelectionRange(3, 3);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(input.value, 'starred/unread/');
	});

	it('keeps valid Source approachable with searchable add-next choices', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		dialog._filterDescriptions = {
			...dialog._filterDescriptions,
			'inductively-knowable': 'Cards tagged Inductively Knowable',
		};
		dialog._composerCandidates = [{
			filter: 'inductively-knowable',
			category: 'tag',
			label: 'Tagged “Inductively Knowable”',
			detail: 'Keeps cards tagged Inductively Knowable',
			aliases: ['tag', 'inductively knowable'],
		}];
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.select();
		Array.from(dialog.shadowRoot.querySelectorAll('#collection-source-completions [role=option]'))
			.find((button) => button.textContent.includes('Starred')).click();
		await dialog.updateComplete;
		assert.strictEqual(input.value, '/c/main/starred/');

		input.value = 'starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
		assert.match(dialog.shadowRoot.textContent, /Add another filter or modifier/);
		assert.match(dialog.shadowRoot.textContent, /Choose an order/);
		assert.match(dialog.shadowRoot.textContent, /Start with Main/);
		assert.match(dialog.shadowRoot.textContent, /Then Starred/);

		input.value = 'starred/induct';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const tag = Array.from(dialog.shadowRoot.querySelectorAll('#collection-source-completions [role=option]'))
			.find((button) => button.textContent.includes('Tagged “Inductively Knowable”'));
		assert.ok(tag);
		assert.match(tag.textContent, /tag/i);
		tag.click();
		await dialog.updateComplete;
		assert.strictEqual(input.value, 'starred/inductively-knowable/');
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .primary').disabled, false);
	});

	it('keeps Enter as the fast open action while valid add-next choices are visible', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = 'starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/');
	});

	it('interprets typing after a route delimiter as filter search, not a card suffix', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.setSelectionRange(input.value.length, input.value.length);
		input.value = `${input.value}upd`;
		input.setSelectionRange(input.value.length, input.value.length);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'upd' }));
		await dialog.updateComplete;
		assert.strictEqual(input.value, '/c/main/upd/');
		assert.match(dialog.shadowRoot.textContent, /Updated/);
		assert.doesNotMatch(dialog.shadowRoot.textContent, /Opens on/);
	});

	it('requires an explicit recovery before leaving nonvalid Source', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		let input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = 'updated/before/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit visually')).click();
		await dialog.updateComplete;
		assert.ok(dialog.shadowRoot.querySelector('#collection-source-input'));
		assert.match(dialog.shadowRoot.textContent, /do not form an openable collection/);
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Return to last valid collection')).click();
		await dialog.updateComplete;
		assert.ok(dialog.shadowRoot.querySelector('#collection-composer-input'));
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit source')).click();
		await dialog.updateComplete;
		input = dialog.shadowRoot.querySelector('#collection-source-input');
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .primary').disabled, false);
	});

	//"WILL OPEN AS" sitting above "Open is unavailable until the current source
	//is valid" was a heading contradicting its own value; and a canonical path
	//that silently drops the default set reads as the app rewriting what was
	//typed unless something says otherwise.
	it('shows a destination heading only when there is a destination, and names canonicalization', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = 'updated/before/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-source-destination'), null,
			'no heading claims a destination while there is none');
		assert.doesNotMatch(dialog.shadowRoot.textContent, /Will open as/);
		assert.strictEqual(input.getAttribute('aria-describedby'), 'collection-source-status');

		input.value = '/c/main/starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(dialog.shadowRoot.querySelector('#collection-source-destination').textContent, /\/c\/starred\/$/);
		assert.match(dialog.shadowRoot.textContent, /Will open as/);
		assert.match(dialog.shadowRoot.textContent, /Same collection, written in this app’s canonical form/);

		input.value = '/c/starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.doesNotMatch(dialog.shadowRoot.textContent, /Will open as/);
		assert.doesNotMatch(dialog.shadowRoot.textContent, /canonical form/);
		assert.match(dialog.shadowRoot.textContent, /Link/);
	});

	//A TRANSLATED ORIGIN IS NOT A SPELLING.
	//
	//A pasted link from this deployment's public address is accepted, and it is
	//genuinely the same collection — but "written in this app's canonical form"
	//describes a change of SPELLING, and this one changed the host the link
	//points at. On a build served from somewhere else, that sentence claimed the
	//two were interchangeable when the whole point is that they are not.
	it('says an origin was translated rather than calling it a spelling', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		//The configured site_domain, which is not the origin this client runs on.
		input.value = 'https://thecompendium.cards/c/main/starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /Ready to open/,
			'the deployment’s own public address is still accepted');
		assert.match(dialog.shadowRoot.textContent, /From thecompendium\.cards, opened in this app/);
		assert.doesNotMatch(dialog.shadowRoot.textContent, /canonical form/);

		//A same-origin route keeps the copy it had.
		input.value = '';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.value = '/c/main/starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(dialog.shadowRoot.textContent, /Same collection, written in this app’s canonical form/);
		assert.doesNotMatch(dialog.shadowRoot.textContent, /opened in this app/);
	});

	//ONE HONEST HEADER PER STATE CLASS (§2.4). 'Not supported here' and 'Can’t
	//understand this source' were two headers for one class — the source cannot
	//be opened — and each was wrong about the other's half: the app understands
	//`zzznope` perfectly well and simply has no such filter, and a malformed
	//date is understood and rejected. The header states what both share; the
	//diagnostic underneath says which it was.
	it('uses one header for every source it cannot open', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		const headerFor = async (value) => {
			input.value = '';
			input.dispatchEvent(new InputEvent('input', { bubbles: true }));
			await dialog.updateComplete;
			input.value = value;
			input.dispatchEvent(new InputEvent('input', { bubbles: true }));
			await dialog.updateComplete;
			return dialog.shadowRoot.querySelector('.source-status strong').textContent;
		};
		//unsupported and invalid, in that order.
		assert.strictEqual(await headerFor('zzznope/'), 'Can’t open this source');
		assert.strictEqual(await headerFor('updated/after/not-a-date/'), 'Can’t open this source');
		//The incomplete state stays distinct: nothing is wrong there yet.
		assert.strictEqual(await headerFor('updated/'), 'Keep typing');
		assert.strictEqual(await headerFor('starred/'), 'Ready to open');
	});

	//A HEADING AND ITS BODY MUST NOT BE ABLE TO CONTRADICT EACH OTHER.
	//
	//They used to be computed independently: the heading branched on
	//parsed.status, while the body took the first diagnostic and fell back to a
	//single sentence shared by every state — the VALID state's own sentence. An
	//incomplete or invalid source that produced no diagnostic therefore rendered
	//'Keep typing — This source is complete and safe to open.': one status
	//element saying, in two halves, that the source both is and is not openable.
	//
	//The fix is structural rather than a third fallback, so this pins the
	//structure: both halves come out of one decision, and each state owns its
	//own sentence. The no-diagnostic case is the one that used to fall through,
	//so it is asked about directly.
	it('never pairs a source heading with a body that contradicts it', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await settleRender(dialog);
		const description = CollectionDescription.deserialize('everything/starred/');
		const READY = /complete and safe to open|opens for you/;
		for (const status of ['valid', 'incomplete', 'invalid', 'unsupported']) {
			//No diagnostic: exactly the shape that used to fall through.
			const bare = dialog._sourceStatus({ status, diagnostics: [] }, description);
			assert.ok(bare.sentence.trim(), `${status} must say something`);
			assert.strictEqual(READY.test(bare.sentence), status === 'valid',
				`only a valid source may claim it is ready to open, not ${status}: "${bare.label} — ${bare.sentence}"`);
			assert.strictEqual(bare.label === 'Ready to open', status === 'valid',
				`only a valid source may be headed Ready to open, not ${status}`);
			//And with a diagnostic, the diagnostic is what is shown — the
			//heading is unchanged, so the pair still agrees.
			const diagnosed = dialog._sourceStatus(
				{ status, diagnostics: [{ message: 'needs 1 more value' }] }, description);
			assert.strictEqual(diagnosed.sentence, 'needs 1 more value');
			assert.strictEqual(diagnosed.label, bare.label);
		}
		//The real thing, through the real parser: an incomplete source can never
		//be told it is safe to open.
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = 'updated/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
		const rendered = dialog.shadowRoot.querySelector('.source-status').textContent;
		assert.match(rendered, /Keep typing/);
		assert.ok(!READY.test(rendered), `an incomplete source must not claim it is openable: ${rendered}`);
	});

	//A collection with no cards opens on nothing, so "Opens on: the first card
	//in the collection" names a card that does not exist. Suppressed only at a
	//RESOLVED zero — undefined means the answer is not in yet, which is a
	//different fact (§3.6), and guessing is what produced the claim.
	it('does not claim a collection with no cards opens on one', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/main/card-7');
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = '/c/main/starred/card-7';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		dialog._previewCounts = { [dialog._draftPreviewID]: 4 };
		await dialog.updateComplete;
		assert.match(dialog.shadowRoot.textContent, /Opens on/);
		dialog._previewCounts = { [dialog._draftPreviewID]: 0 };
		await dialog.updateComplete;
		assert.doesNotMatch(dialog.shadowRoot.textContent, /Opens on/);
		window.history.replaceState({}, '', '/c/main/');
	});

	it('preserves a Source selected card through Compose activation', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = '/c/everything/starred/card-42';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit visually')).click();
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.composer-actions .primary').click();
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/everything/starred/card-42');
	});

	it('undoes a Source collection and selected-card suffix atomically', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/main/');
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = '/c/everything/starred/card-42';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit visually')).click();
		await dialog.updateComplete;
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Undo')).click();
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.composer-actions .primary').click();
		await dialog.updateComplete;
		//Undo restored both halves, so the draft is the collection already on
		//screen and, per the spec, opening it just closes the composer instead of
		//adding a duplicate history entry. (This used to assert "/c/", the same
		//collection spelled differently, which is the duplicate entry the spec
		//forbids.) A half-undo -- description restored but card-42 still attached
		//-- would show up here as a navigation to /c/card-42.
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
	});

	it('preserves the raw requested-card placeholder when a route becomes a fragment', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/main/_');
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = 'starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.composer-actions .primary').click();
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/_');
	});

	//All three are pure functions of state that the composer asks for several
	//times per render, and all three used to recompute from scratch on every
	//keystroke. A stable result IDENTITY across repeated reads is the observable
	//form of "it did not recompute".
	it('recomputes its pure derivations only when their inputs change', async () => {
		const candidates = dialog._contextualComposerCandidates;
		assert.strictEqual(dialog._contextualComposerCandidates, candidates);
		assert.strictEqual(dialog._composerFilterLabels, dialog._composerFilterLabels);

		const parsed = dialog._parsedSource;
		assert.strictEqual(dialog._parsedSource, parsed);

		const catalog = dialog._catalogItems;
		assert.strictEqual(dialog._catalogItems, catalog);

		const suggestions = dialog._composerSuggestions;
		assert.strictEqual(dialog._composerSuggestions, suggestions);

		//And they still recompute when something they depend on actually moves.
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.notStrictEqual(dialog._catalogItems, catalog);
		assert.notStrictEqual(dialog._composerSuggestions, suggestions);
	});

	//Every keystroke used to blank every count and re-enqueue, so each character
	//erased counts that were still correct for the whole debounce plus a worker
	//round trip — and the count beside the primary flickered between a number
	//and nothing while the draft it describes had not changed at all. (It used
	//to flicker INSIDE the button's own label; HS-3.3 moved it out beside a
	//round glyph, which is why this now reads .action-count.)
	it('keeps a count whose collection did not change across a keystroke', async () => {
		window.localStorage.setItem('collection-composer-preview', 'on');
		try {
			const draftKey = dialog._previewCountKey(dialog._collectionDescription);
			dialog._retainedPreviewCounts.set(draftKey, 1307);
			dialog._refreshPreviewCounts();
			assert.strictEqual(dialog._previewCounts[dialog._draftPreviewID], 1307);
			assert.strictEqual(dialog._draftCountPending, false,
				'a known count is not a pending one');

			//A keystroke changes the suggestion list but not the draft collection.
			const input = dialog.shadowRoot.querySelector('#collection-composer-input');
			input.value = 'sta';
			input.dispatchEvent(new InputEvent('input', { bubbles: true }));
			await dialog.updateComplete;
			assert.strictEqual(dialog._previewCounts[dialog._draftPreviewID], 1307,
				'typing must not blank the count of a collection that did not change');
			assert.strictEqual(dialog._draftCountPending, false);
			assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim(),
				'1307 cards');

			//Changing the DRAFT is a different collection, so the count is genuinely
			//unknown — and says so, rather than silently reading as "no data".
			Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
				.find((button) => button.textContent.includes('Add Starred')).click();
			await dialog.updateComplete;
			assert.strictEqual(dialog._previewCounts[dialog._draftPreviewID], undefined);
			assert.strictEqual(dialog._draftCountPending, true);
			//Counts are recomputed in updated(), so the DOM catches up one frame later.
			await dialog.updateComplete;
			//The hand-rolled '· counting…' is now the shared loading primitive, which
			//renders its line into its own shadow root — so the assertion is that the
			//element is present and says what is loading. It sits where the count it
			//stands in for sits: beside the primary, not in the expression.
			const placeholder = dialog.shadowRoot.querySelector('.composer-actions .action-count loading-placeholder');
			assert.ok(placeholder, 'an unknown count must say it is still arriving');
			assert.strictEqual(placeholder.noun, 'the card count');
		} finally {
			window.localStorage.removeItem('collection-composer-preview');
			dialog._retainedPreviewCounts.clear();
		}
	});

	//An option must be owned by its listbox. A plain <div> in between silently
	//breaks the listbox -> option relationship, so a screen reader announces a
	//listbox with no options in it.
	const assertListboxOwnership = (listbox) => {
		const options = listbox.querySelectorAll('[role="option"]');
		for (const option of options) {
			let node = option.parentElement;
			while (node && node !== listbox) {
				const role = node.getAttribute('role');
				assert.ok(
					role === 'presentation' || role === 'none' || role === 'group',
					`an element with role="${role}" sits between the listbox and its option`
				);
				node = node.parentElement;
			}
			assert.strictEqual(node, listbox, 'every option must live inside the listbox');
		}
	};

	it('keeps every option owned by its listbox', async () => {
		await seedRecents([['everything/starred/', 3]]);
		const suggestions = dialog.shadowRoot.querySelector('#collection-composer-suggestions');
		assert.ok(suggestions);
		assert.ok(suggestions.querySelectorAll('[role="option"]').length);
		assertListboxOwnership(suggestions);

		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const catalog = dialog.shadowRoot.querySelector('#collection-filter-catalog');
		assert.ok(catalog.querySelectorAll('[role="option"]').length);
		assertListboxOwnership(catalog);
	});

	//aria-controls naming an element that is not in the document is a dangling
	//reference; the composer renders a plain empty-state line, not a listbox,
	//when nothing matches.
	it('only points aria-controls at a listbox that is rendered', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		const controls = input.getAttribute('aria-controls');
		assert.ok(controls && dialog.shadowRoot.querySelector(`#${controls}`),
			`aria-controls names a missing #${controls}`);

		//The empty-suggestion branch renders a plain line instead of a listbox.
		//Real corpus state always produces at least a text-query interpretation, so
		//the branch is driven directly rather than reached by typing something the
		//composer refuses to interpret.
		Object.defineProperty(dialog, '_composerSuggestions', { get: () => [], configurable: true });
		dialog.requestUpdate();
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-composer-suggestions'), null);
		assert.strictEqual(input.getAttribute('aria-controls'), null);
		delete dialog._composerSuggestions;
	});

	//One row stands for the whole x / not-x pair. Flipping its polarity and
	//choosing it must add the OTHER filter, not the one the row started on.
	it('adds the inverse filter when a catalog row\'s polarity is flipped', async () => {
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const rowFor = (filterName) => {
			const option = dialog.shadowRoot.querySelector(`#collection-filter-catalog [data-filter="${filterName}"]`);
			return option ? option.closest('.suggestion') : null;
		};
		const starred = rowFor('starred');
		assert.ok(starred, 'the starred row must be in the catalog');
		assert.strictEqual(rowFor('unstarred'), null, 'unstarred is the same row, not a second one');
		const polarity = starred.querySelector('.catalog-polarity');
		assert.ok(polarity, 'a merged row must offer a polarity affordance');
		assert.strictEqual(polarity.getAttribute('aria-pressed'), 'false');
		polarity.click();
		await dialog.updateComplete;
		const flipped = rowFor('unstarred');
		assert.ok(flipped, 'flipping polarity must offer the inverse filter');
		assert.strictEqual(flipped.querySelector('.catalog-polarity').getAttribute('aria-pressed'), 'true');

		//AND THE ON STATE MUST PAINT. aria-pressed=true and aria-pressed=false
		//rendered identical pixels: ButtonSharedStyles gives a toggle its on
		//state through `button.selected`, and `button.small`'s transparent
		//background has the same specificity and comes after it, so the shared
		//rule never reached the screen. The class is the pairing HS-4.2
		//requires; the local rule is what makes it visible.
		assert.ok(flipped.querySelector('.catalog-polarity').classList.contains('selected'),
			'HS-4.2 pairs aria-pressed with .selected');
		const styles = composerStyles();
		const onState = styles.match(/button\.catalog-polarity\.selected\s*\{[^}]*\}/);
		assert.ok(onState,
			'the toggle needs an on-state rule the local .suggestion/.small rules cannot shadow');
		assert.match(onState[0], /background:\s*var\(--app-secondary-color-light\)/,
			'HS-4.5: teal is a toggle that is on');
		assert.match(onState[0], /color:\s*var\(--app-dark-text-color-darker\)/,
			'and the label darkens with it — the purple .verb sets is unreadable on teal');

		flipped.querySelector('[role="option"]').click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['unstarred']);
	});

	//SOURCE MODE'S ENTER — the one keystroke the live review caught spending
	//itself twice.
	//
	//Counting pushes rather than reading history.length: the assertion is about
	//how many history entries a single Enter creates, and that is exactly what
	//pushState calls are.
	const countingPushes = async (body) => {
		const original = window.history.pushState;
		const pushed = [];
		window.history.pushState = function (...args) {
			pushed.push(args[2]);
			return original.apply(this, args);
		};
		try {
			await body(pushed);
		} finally {
			window.history.pushState = original;
		}
	};

	const openSourceMode = async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		return dialog.shadowRoot.querySelector('#collection-source-input');
	};

	//Typed the way a user does rather than pasted over the top: the source editor
	//auto-delimits a segment that EXTENDS what is already there, so assigning a
	//value that happens to start with the current one produces an extra slash.
	//Clearing first is what select-all-and-type does.
	const typeInto = async (input, value) => {
		input.value = '';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		input.value = value;
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
	};

	const pressEnter = (element, overrides = {}) =>
		element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...overrides }));

	//Repro: on /c/main/, Edit source, type a DIFFERENT SPELLING of the same
	//collection, press Enter once. It pushed /c/ and then let the quick
	//composer's highlighted-suggestion Enter fire as well, landing somewhere the
	//user never chose with a receipt that named it. Both halves are asserted
	//here: zero pushes, and nothing said about a navigation that did not happen.
	it('closes silently when Source names the collection already open, in any spelling', async () => {
		for (const entry of [...store.getState().app.snackbars]) {
			store.dispatch({ type: 'DISMISS_SNACKBAR', snackbarID: entry.id });
		}
		await seedRecents([['everything/sort/stars/', 9], ['main/starred/', 2]]);
		const input = await openSourceMode();
		await typeInto(input, '/c/main/sort/default/');
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /Ready to open/);
		await countingPushes(async (pushed) => {
			pressEnter(input);
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, [],
				'a different spelling of the collection already open is not a navigation');
		});
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.deepStrictEqual(store.getState().app.snackbars, [],
			'nothing happened, so there is no receipt to show');
	});

	it('pushes exactly once from Source, and the receipt names that destination', async () => {
		for (const entry of [...store.getState().app.snackbars]) {
			store.dispatch({ type: 'DISMISS_SNACKBAR', snackbarID: entry.id });
		}
		//A populated CONTINUE list is what made the second, stolen navigation
		//visible in the live app; seeding one keeps this test honest.
		await seedRecents([['everything/sort/stars/', 9], ['main/starred/', 2]]);
		const input = await openSourceMode();
		await typeInto(input, '/c/everything/starred/');
		await countingPushes(async (pushed) => {
			pressEnter(input);
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, ['/c/everything/starred/'],
				'one Enter is one history entry, and it is the one Source named');
		});
		assert.strictEqual(window.location.pathname, '/c/everything/starred/');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		const snackbars = store.getState().app.snackbars;
		assert.strictEqual(snackbars.length, 1);
		assert.match(snackbars[0].message, /Now showing Everything AND Starred/,
			'the receipt names the destination Source opened, not a suggestion row');
		window.history.replaceState({}, '', '/c/main/');
	});

	//`/c/` IS NOT A SPELLING OF MAIN.
	//
	//Live repro: standing in a filtered collection, the recents row that opens
	//Main pushed `/c/` — because serializeShort() elides the default set and the
	//bare Main collection has nothing else to say — and the router resolved that
	//pathless route through its own default substitution, landing on
	///c/everything/sort/stars/ under a receipt that read "Now showing Main · 765
	//cards", with an Undo that did nothing.
	it('opens the bare Main collection at a path that names it', async () => {
		const { updateCollection, updateCollectionConfigurationSnapshot } =
      await import('../../lib/src/actions/collection.js');
		for (const entry of [...store.getState().app.snackbars]) {
			store.dispatch({ type: 'DISMISS_SNACKBAR', snackbarID: entry.id });
		}
		//Standing in a filtered collection, with bare Main as the draft — the
		//"Open Main"/"Back to Main" shape.
		window.history.replaceState({}, '', '/c/starred/');
		store.dispatch(updateCollection('main', ['starred'], 'default', false, 'list', ''));
		store.dispatch(updateCollectionConfigurationSnapshot(new CollectionDescription()));
		await settleRender(dialog);
		await countingPushes(async (pushed) => {
			dialog.shadowRoot.querySelector('.composer-actions .primary').click();
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, ['/c/main/'],
				'`/c/` is a route with no collection in it, so Main is spelled `/c/main/`');
		});
		assert.strictEqual(window.location.pathname, '/c/main/');
		const snackbars = store.getState().app.snackbars;
		assert.strictEqual(snackbars.length, 1);
		assert.match(snackbars[0].message, /^Now showing Main\b/);
		window.history.replaceState({}, '', '/c/main/');
		store.dispatch(updateCollection('main', [], 'default', false, 'list', ''));
	});

	//THE RECEIPT REPORTS THE ARRIVAL, NOT THE REQUEST.
	//
	//The receipt used to be composed from the description the composer ASKED
	//for, which is why a commit that landed somewhere else could still announce
	//"Now showing Main". It is now composed from what the router actually
	//resolves the committed path to — the same resolution updateCardSelector
	//performs — so a wrong landing is at least reported honestly.
	it('names the collection that actually became active, not the one requested', async () => {
		const { updateCollection, updateCollectionConfigurationSnapshot } =
      await import('../../lib/src/actions/collection.js');
		for (const entry of [...store.getState().app.snackbars]) {
			store.dispatch({ type: 'DISMISS_SNACKBAR', snackbarID: entry.id });
		}
		window.history.replaceState({}, '', '/c/starred/');
		store.dispatch(updateCollection('main', ['starred'], 'default', false, 'list', ''));
		store.dispatch(updateCollectionConfigurationSnapshot(new CollectionDescription()));
		await settleRender(dialog);
		//The commit lands somewhere other than what the draft named — which is
		//what a malformed destination path did for real, and what any future
		//one would do. The receipt must report the landing.
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize('everything/starred/')));
		await settleRender(dialog);
		dialog._pathWithLiveSelectedCard = () => '/c/has-todo/';
		dialog.shadowRoot.querySelector('.composer-actions .primary').click();
		await dialog.updateComplete;
		const snackbars = store.getState().app.snackbars;
		assert.strictEqual(snackbars.length, 1);
		assert.ok(!/Everything AND Starred/.test(snackbars[0].message),
			'a landing the user did not ask for must not be reported as the one they did');
		assert.match(snackbars[0].message, /^Now showing Main AND Has any TODO\./,
			'the receipt names what the router resolved the committed path to');
		delete dialog._pathWithLiveSelectedCard;
		window.history.replaceState({}, '', '/c/main/');
		store.dispatch(updateCollection('main', [], 'default', false, 'list', ''));
	});

	//Spec §Navigation to selected card. The corpus question — is this card in
	//that collection? — has no answer in this harness (there is no card data),
	//so it is the one thing stubbed; everything from the commit handler outward
	//is the real thing, which is where the bug lived.
	it('drops a selected card the destination does not contain', async () => {
		const { updateCollection, updateCollectionConfigurationSnapshot } =
      await import('../../lib/src/actions/collection.js');
		window.history.replaceState({}, '', '/c/main/card-42');
		store.dispatch({ type: 'SHOW_CARD', requestedCard: 'card-42', card: 'card-42' });
		store.dispatch(updateCollection('main', [], 'default', false, 'list', ''));
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize('everything/starred/')));
		await settleRender(dialog);
		dialog._draftSelectedCard = 'card-42';
		dialog._destinationContainsCard = () => false;
		await countingPushes(async (pushed) => {
			dialog.shadowRoot.querySelector('.composer-actions .primary').click();
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, ['/c/everything/starred/'],
				'the ejected card is dropped, and the trailing slash asks for the default item');
		});
		delete dialog._destinationContainsCard;
		store.dispatch({ type: 'SHOW_CARD', requestedCard: '', card: '' });
		window.history.replaceState({}, '', '/c/main/');
	});

	it('keeps a selected card the destination still contains', async () => {
		const { updateCollection, updateCollectionConfigurationSnapshot } =
      await import('../../lib/src/actions/collection.js');
		window.history.replaceState({}, '', '/c/main/card-42');
		store.dispatch({ type: 'SHOW_CARD', requestedCard: 'card-42', card: 'card-42' });
		store.dispatch(updateCollection('main', [], 'default', false, 'list', ''));
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize('everything/starred/')));
		await settleRender(dialog);
		dialog._draftSelectedCard = 'card-42';
		dialog._destinationContainsCard = () => true;
		await countingPushes(async (pushed) => {
			dialog.shadowRoot.querySelector('.composer-actions .primary').click();
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, ['/c/everything/starred/card-42'],
				'a card that survives the transformation is preserved by default');
		});
		delete dialog._destinationContainsCard;
		store.dispatch({ type: 'SHOW_CARD', requestedCard: '', card: '' });
		window.history.replaceState({}, '', '/c/main/');
	});

	//A DELETION IS NOT AN EXTENSION.
	//
	//The source editor closes a segment the moment you start typing one, and it
	//used to decide what to do next by comparing prefixes. That test cannot tell
	//a deletion from an insertion, and with an auto-delimiter in play the two are
	//literally the same string operation: "backspaced over the closing slash" and
	//"still extending this segment" both satisfy startsWith(). Read as an
	//extension, a Backspace was answered by re-appending the very slash it had
	//just removed — the keystroke silently undone, and _sourceInput left holding
	//a string the textarea no longer showed. Live: Backspace at the end of the
	//source did nothing, press after press.
	it('honours every Backspace in Source, and retracts the delimiter it added itself', async () => {
		const input = await openSourceMode();
		await typeInto(input, '/c/');
		//One character, typed where the auto-delimiter is meant to fire.
		input.value = '/c/s';
		input.setSelectionRange(4, 4);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 's' }));
		await dialog.updateComplete;
		assert.strictEqual(input.value, '/c/s/', 'typing after a delimiter still closes its own segment');

		//Backspace over that one character. The delimiter was this editor's idea,
		//so it leaves with the segment it was closing; left behind it butts
		//against the slash before it and the source reads `/c//`, which is the
		//"empty path segments" refusal arrived at by DELETING.
		input.value = '/c//';
		input.setSelectionRange(3, 3);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._sourceInput, '/c/', 'the auto delimiter is retracted with the segment it closed');
		assert.strictEqual(input.value, '/c/', 'and the textarea says the same thing the component believes');
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /Ready to open/);

		//And with the caret PAST the delimiter, Backspace takes the delimiter
		//itself. This is the press that used to be undone outright.
		input.value = '/c/s';
		input.setSelectionRange(4, 4);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 's' }));
		await dialog.updateComplete;
		assert.strictEqual(input.value, '/c/s/');
		input.value = '/c/s';
		input.setSelectionRange(4, 4);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._sourceInput, '/c/s', 'the deletion stands');
		assert.strictEqual(input.value, '/c/s', 'the textarea and the component never disagree about the source');
	});

	//A COLLECTION PATH IS ONE LINE, AND A PASTE IS NOT A COMMIT.
	//
	//Enter in this textarea is spoken for — the keydown half prevents the default
	//and commits — so a line break that reaches the INPUT handler arrived by a
	//route that never passed that guard: a paste, a drop, an injected insertion.
	//It was kept verbatim, and the segment logic then read it as the start of a
	//new filter and closed it with a slash nobody typed, so `…/` became `…/\n/`
	//and the pane could only say "Empty path segments are not allowed": true, and
	//no help at all about the newline that caused it.
	it('takes a pasted line break as text a path cannot hold, not as a commit', async () => {
		const input = await openSourceMode();
		await typeInto(input, '/c/starred/');
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /Ready to open/);
		input.value = '/c/starred/\n';
		input.setSelectionRange(input.value.length, input.value.length);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._sourceInput, '/c/starred/', 'the line break is dropped, and nothing is added in its place');
		assert.strictEqual(input.value, '/c/starred/',
			'the strip lands in the textarea too: it rewrites to the value the component already held, so no re-render would carry it there');
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /Ready to open/,
			'a source that was ready to open before the paste is ready to open after it');

		//The same slash, manufactured the other way: text pasted in whole has
		//already closed its own segment, and closing it again only builds the
		//empty one.
		input.value = '/c/starred/sort/recent/';
		input.setSelectionRange(input.value.length, input.value.length);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._sourceInput, '/c/starred/sort/recent/', 'a paste that ends in a delimiter is not given another');

		//And the keystroke itself never gets that far, which is what makes the
		//strip above a statement about paste rather than about Enter.
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		input.dispatchEvent(enter);
		await dialog.updateComplete;
		assert.ok(enter.defaultPrevented, 'Enter in Source commits, rather than typing a line into a path');
		window.history.replaceState({}, '', '/c/main/');
	});

	//THE PLACEHOLDER NEVER ENTERS HISTORY.
	//
	//The router rewrites "no card in the URL" to the internal placeholder '_'
	//(actions/collection.ts) and canonicalizeURL rewrites it straight back to an
	//empty segment. The composer carried it into the path it PUSHED, so every
	//navigation from the quick composer put `/c/…/_` into history and then
	//replaceState'd the real path a tick later — a URL the user never asked for,
	//built from an identifier §1.4 says never reaches them. Building the final
	//path before the push is the only fix that keeps it out of history at all,
	//rather than correcting it after the fact.
	it('never pushes the internal card placeholder into history', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/main/');
		//What the router leaves behind on a collection URL with no card.
		store.dispatch({ type: 'SHOW_CARD', requestedCard: '_', card: '' });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await dialog.updateComplete;
		assert.strictEqual(dialog._draftSelectedCard, '',
			'the placeholder is stripped where it enters the component');
		const composerInput = dialog.shadowRoot.querySelector('#collection-composer-input');
		composerInput.value = 'starred';
		composerInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		const row = suggestionRows().find((button) => button.textContent.includes('Add Starred'));
		assert.ok(row, 'the Starred row is what this test navigates with');
		row.click();
		await dialog.updateComplete;
		await countingPushes(async (pushed) => {
			dialog.shadowRoot.querySelector('.composer-actions .primary').click();
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, ['/c/starred/'],
				'the pushed path is the final one, with no placeholder segment');
		});
		store.dispatch({ type: 'SHOW_CARD', requestedCard: '', card: '' });
		window.history.replaceState({}, '', '/c/main/');
	});

	//The structural half of the same defect: a keystroke may never be consumed
	//by two commit handlers. Both mode handlers decline a keystroke the other has
	//already spent, and each declines outright while the composer is in the other
	//mode — which is what a commit that flips the mode synchronously would
	//otherwise defeat.
	it('spends one keystroke on at most one commit', async () => {
		//The live repro exactly: a populated CONTINUE list whose first row is a
		//collection the user never chose, and a Source Enter that ended up
		//opening it.
		await seedRecents([['everything/sort/stars/', 9], ['main/starred/', 2]]);
		const input = await openSourceMode();
		await typeInto(input, '/c/everything/starred/');
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		await countingPushes(async (pushed) => {
			input.dispatchEvent(enter);
			await dialog.updateComplete;
			dialog._suggestionHighlightActive = true;
			dialog._highlightedSuggestion = 0;
			//The same event, offered to the OTHER mode's handler exactly as the
			//live app offered it. The commit closes the dialog, which flips
			//_entryMode synchronously; and one Lit microtask later — which the
			//browser runs BETWEEN two listeners of the same keydown — updated()
			//clears the single-flight flag that would otherwise have caught the
			//second commit. Reproduced here, both are already true when the
			//second handler is reached.
			dialog._entryMode = 'compose';
			dialog._activationPending = false;
			dialog._handleComposerKeyDown(enter);
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, ['/c/everything/starred/'],
				'the second handler must decline a keystroke already spent');
		});
		window.history.replaceState({}, '', '/c/main/');
	});

	//Shift-Enter. The spec offers a new tab "if browser behavior can be
	//supported safely"; it cannot be — the app enforces a one-active-tab
	//ownership lease — so the modifier is deliberately inert and says so.
	//Silently aliasing Enter was the worst option: the user asks for a new tab
	//and gets a navigation in this one with no word about it.
	it('makes Shift-Enter inert, and says why once per composer session', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		await typeInto(input, 'star');
		await countingPushes(async (pushed) => {
			pressEnter(input, { shiftKey: true });
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, [], 'Shift-Enter navigates nowhere');
		});
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		const note = dialog.shadowRoot.querySelector('.modifier-note');
		assert.ok(note, 'an inert modifier must explain itself rather than do nothing');
		assert.match(note.textContent, /Opening in a new tab isn’t supported — Enter opens here\./);
		//And plain Enter still commits, so the note is about the modifier, not a
		//new refusal of the key itself.
		pressEnter(input);
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/starred/');
		window.history.replaceState({}, '', '/c/main/');
	});

	it('makes Shift-Enter inert in Source mode too', async () => {
		const input = await openSourceMode();
		await typeInto(input, '/c/everything/starred/');
		await countingPushes(async (pushed) => {
			pressEnter(input, { shiftKey: true });
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, []);
		});
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.ok(dialog.shadowRoot.querySelector('.modifier-note'));
	});

	//Shift+Tab is reverse focus traversal, everywhere. It must not materialize a
	//suggestion into the draft the way Tab does; the dialog's own focus trap
	//handles the wrapping.
	it('leaves the draft alone on Shift+Tab', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		await typeInto(input, 'star');
		assert.match(highlightedRow().textContent, /Starred/);
		const before = store.getState().collection.snapshot;
		const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
		input.dispatchEvent(shiftTab);
		await dialog.updateComplete;
		assert.strictEqual(store.getState().collection.snapshot, before,
			'Shift+Tab must not materialize the highlighted row');
		assert.strictEqual(dialog.shadowRoot.querySelector('.draft-receipt'), null,
			'and it must not claim it replaced the draft');
		assert.strictEqual(shiftTab.defaultPrevented, false,
			'the browser keeps its own reverse-focus behavior');
	});

	it('leaves Source completions alone on Shift+Tab', async () => {
		const input = await openSourceMode();
		await typeInto(input, 'updated/before/');
		const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
		input.dispatchEvent(shiftTab);
		await dialog.updateComplete;
		assert.strictEqual(input.value, 'updated/before/',
			'Shift+Tab must not accept a completion either');
		assert.strictEqual(shiftTab.defaultPrevented, false);
	});

	//ESCAPE PEELS SOURCE, IT DOES NOT CLOSE OVER IT.
	//
	//Spec, "Error recovery": switching back must not lose invalid text. Escape
	//used to close the whole dialog from Source, discarding whatever had been
	//typed with no confirmation and no way back.
	it('peels Source back to the quick composer, keeping what was typed', async () => {
		const input = await openSourceMode();
		await typeInto(input, 'updated/before/');
		//First Escape dismisses the completion list, exactly as it did before.
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-source-completions'), null);
		assert.strictEqual(dialog._entryMode, 'source');

		//Second Escape returns to the quick composer. The dialog stays open and
		//nothing is confirmed — the text is invalid, and that is allowed.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._entryMode, 'compose');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'the dialog stays open; Source is a layer, not the dialog');
		assert.ok(dialog.shadowRoot.querySelector('#collection-composer-input'));

		//Re-entering Source restores exactly what was typed, to the character.
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit source')).click();
		await dialog.updateComplete;
		await dialog.updateComplete;
		assert.strictEqual(dialog._entryMode, 'source');
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-source-input').value, 'updated/before/',
			'nothing was lost, and nothing had to be confirmed');
	});

	it('closes on the Escape after the one that peeled Source', async () => {
		const input = await openSourceMode();
		await typeInto(input, '/c/everything/starred/');
		//Valid source offers no completions to dismiss, so the first Escape is
		//the one that peels.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(dialog._entryMode, 'compose');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.strictEqual(window.location.pathname, '/c/main/');
	});

	//THE CLAUSE EDITOR IS ANCHORED TO THE SENTENCE, AND BOUNDED THERE.
	//
	//REWRITTEN, not deleted. The property this test defends is unchanged — the
	//'Editing Updated between…' panel measured 262px inside a 720px dialog and
	//ran past its bottom, .composer-actions hit-tested ABOVE both date inputs,
	//and 'Done editing' and 'Remove filter' rendered where nothing paints — but
	//the structure that defends it has moved. The editor used to be the last
	//flex child of #inner in a `.builder.builder-clause.scroller` wrapper, and
	//the old assertions named that wrapper. It now renders in the anchored slot
	//directly under the draft sentence, where being on screen is a property of
	//its POSITION rather than of a scroll into it, and the bounding moved one
	//level in: the slot caps its height and the editor's own body scrolls.
	//
	//So the same three facts are pinned against the new shape: the editor sits
	//between the sentence and everything else, its scrolling part is inside it,
	//and the footer is neither inside it nor able to give up its own room.
	//JSDOM computes no layout, so geometry is still pinned through the
	//component's own stylesheet.
	it('anchors the clause editor under the sentence, bounded, with the footer out of its flow', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		await typeInto(input, 'star');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await settleRender(dialog);
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await settleRender(dialog);

		const editor = dialog.shadowRoot.querySelector('.clause-editor');
		assert.ok(editor, 'the clause editor must be on screen');
		const pane = editor.closest('.anchored-editor');
		assert.ok(pane, 'the editor lives in the anchored slot');

		//ATTACHED TO THE SENTENCE: the slot's immediately preceding sibling is
		//the expression row itself, so no list, heading or message can come
		//between a chip and the editor it opened.
		const expression = dialog.shadowRoot.querySelector('.expression');
		assert.ok(expression);
		assert.strictEqual(pane.previousElementSibling, expression,
			'the editor must render directly under the row whose chip opened it');

		//Its BODY is the scroller, so the action row is a sibling of the
		//scrolling part rather than the last thing inside it.
		const body = editor.querySelector('.clause-editor-body');
		assert.ok(body, 'the editor has its own body');
		assert.ok(body.classList.contains('scroller'),
			'a filter whose controls overflow scrolls inside the editor, not the dialog');
		assert.ok(editor.querySelector('configure-collection-filter').closest('.clause-editor-body'),
			'the controls are what scrolls');
		const actions = editor.querySelector('.clause-editor-actions');
		assert.ok(actions, 'the action row exists');
		assert.strictEqual(actions.closest('.clause-editor-body'), null,
			'and it is outside the scroller, so it cannot fall off the bottom of it');

		const footer = dialog.shadowRoot.querySelector('.buttons.composer-actions');
		assert.ok(footer);
		assert.strictEqual(footer.closest('.anchored-editor'), null,
			'the footer must be outside the editor pane, never a sibling it can paint over');
		assert.ok(footer.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_PRECEDING,
			'and it must come after it, so its room is reserved rather than borrowed');
		//Both controls the review found unreachable are inside the bounded pane.
		assert.match(pane.textContent, /Done editing/);
		assert.match(editor.querySelector('configure-collection-filter').shadowRoot.textContent, /Remove filter/);

		const styles = composerStyles();
		//The cap is what keeps the panel from taking the whole scroll port, and
		//it is viewport-relative rather than a percentage of a flex-resolved
		//parent, so it resolves whatever the dialog body ends up measuring.
		assert.match(styles, /\.anchored-editor\s*\{[^}]*max-height:\s*min\(22em,\s*40vh\)/,
			'the anchored slot budgets its height rather than growing without bound');
		assert.match(styles, /\.anchored-editor\s*\{[^}]*min-height:\s*0/,
			'and it may shrink, so its body scrolls before the dialog does');
		assert.match(styles, /\.pending-filter-body,\s*\.clause-editor-body\s*\{[^}]*flex:\s*1 1 auto/,
			'only the body takes the room, so the action row keeps its own');
		assert.match(styles, /\.buttons\.pending-filter-actions,\s*\.clause-editor-actions,\s*\.pending-filter-heading,\s*\.clause-editor-heading\s*\{[^}]*flex:\s*0 0 auto/,
			'and neither panel’s fixed ends — heading or action row — shrink');
		//THE HEADING IS OUTSIDE THE SCROLLER TOO. Focus lands in the first
		//control as the panel opens, and the browser scrolls the nearest
		//scrollable ancestor to reveal it — verified live: with the heading
		//inside the scroller, 'Editing Updated between 2023-01-01 and
		//2023-12-31' and the contract sentence under it were scrolled off on
		//the frame the panel appeared.
		const heading = editor.querySelector('.clause-editor-heading');
		assert.ok(heading, 'the panel states what it is editing');
		assert.match(heading.textContent, /Editing /);
		assert.match(heading.textContent, /Changes update the draft immediately/,
			'and the contract it keeps');
		assert.strictEqual(heading.closest('.clause-editor-body'), null,
			'the heading must not scroll away when focus lands in a control');
		assert.match(styles, /\.buttons\.composer-actions\s*\{[^}]*flex:\s*0 0 auto/,
			'the footer never shrinks to make room for an editor');
		assert.match(styles, /\.builder-catalog\s*\{[^}]*overflow:\s*hidden/,
			'a shrunken flex item must clip rather than paint over what follows it');
		//AND THE LISTS YIELD FIRST. The slot is bounded, but a list with a 7em
		//or 8em floor would still push it: while an editor is open both drop to
		//two rows and the heading, which is also what keeps the 0-card
		//diagnostics on screen beside an open editor.
		assert.match(styles, /:host\(\[data-editor-open\]\) \.suggestions,\s*:host\(\[data-editor-open\]\) \.catalog-list\s*\{[^}]*min-height:\s*4em/,
			'the lists give up their floor to the anchored editor');
		assert.ok(dialog.hasAttribute('data-editor-open'),
			'and the attribute the rule keys off is actually set while an editor is open');
	});

	//Seeds a draft without going through the suggestion list, for the tests
	//below whose subject is the editor rather than how the clause got there.
	const seedDraft = async (source) => {
		const { updateCollectionConfigurationSnapshot } = await import('../../lib/src/actions/collection.js');
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize(source)));
		await settleRender(dialog);
	};

	const openClauseEditor = async (index = 0) => {
		const clauses = Array.from(dialog.shadowRoot.querySelectorAll('.expression-clause-label'));
		assert.ok(clauses[index], `there is a clause ${index} to edit`);
		clauses[index].click();
		await settleRender(dialog);
		const editor = dialog.shadowRoot.querySelector('.clause-editor');
		assert.ok(editor, 'the editor opened');
		return editor;
	};

	//The real date control, three shadow roots down, settled.
	const editorDateControl = async () => {
		const filter = dialog.shadowRoot.querySelector('.clause-editor configure-collection-filter');
		assert.ok(filter, 'the editor holds a filter control');
		await settleRender(dialog, filter);
		const date = filter.shadowRoot.querySelector('configure-collection-date');
		assert.ok(date, 'the filter holds a date control');
		await settleRender(dialog, filter, date);
		return date;
	};

	//ONE EDIT PER OPENING WAS THE WHOLE COST.
	//
	//_commitDraftEdit clears _selectedClauseIndex, because for every other way
	//the draft changes the selected clause is no longer what the user is
	//pointing at. A clause edit is the one change that comes FROM the selected
	//clause, so it closed the editor on the field that had just been changed:
	//the audited session set the start of a date window, watched the panel
	//vanish, and had to re-open it from the chip to set the end.
	it('keeps the clause editor open across field edits', async () => {
		await seedDraft('everything/updated/between/2026-01-01/2026-02-01/');
		await openClauseEditor();

		const setDate = async (label, value) => {
			const date = await editorDateControl();
			const input = date.shadowRoot.querySelector(`[aria-label="${label}"]`);
			assert.ok(input, `the ${label} field is on screen`);
			input.value = value;
			input.dispatchEvent(new Event('change', { bubbles: true }));
			await settleRender(dialog);
		};

		await setDate('First fixed date', '2026-01-15');
		assert.ok(dialog.shadowRoot.querySelector('.clause-editor'),
			'changing one date must not close the editor');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
			['updated/between/2026-01-15/2026-02-01'],
			'and the change reaches the draft immediately');
		assert.ok(dialog._builderExpanded);
		assert.strictEqual(dialog._selectedClauseIndex, 0,
			'the editor is still on the clause it was editing');

		//THE SECOND FIELD, without re-opening anything. This is the step the
		//audited session could not take.
		await setDate('Second fixed date', '2026-03-01');
		assert.ok(dialog.shadowRoot.querySelector('.clause-editor'), 'still open');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
			['updated/between/2026-01-15/2026-03-01'],
			'both edits are in the draft');

		//The refinement list is still on screen beside the open editor — the
		//0-card 'Remove …' diagnostics live in it, and they must not be hidden
		//behind an editor the user has to close to see them.
		assert.ok(dialog.shadowRoot.querySelector('.suggestions [role="option"]'),
			'the suggestion list stays readable while an editor is open');

		//And it closes when the user says so, not before.
		Array.from(dialog.shadowRoot.querySelectorAll('.clause-editor button'))
			.find((button) => button.textContent.includes('Done editing')).click();
		await settleRender(dialog);
		assert.strictEqual(dialog.shadowRoot.querySelector('.clause-editor'), null,
			'Done editing closes it');
		assert.strictEqual(dialog.shadowRoot.querySelector('.anchored-editor'), null,
			'and takes the anchored slot with it, rather than leaving an empty box');
		//The chip says what the clause now is.
		assert.match(dialog.shadowRoot.querySelector('.expression-clause').textContent, /2026-01-15/);
		assert.match(dialog.shadowRoot.querySelector('.expression-clause').textContent, /2026-03-01/);
	});

	//TEACH THROUGH CONSEQUENCE, AT THE MOMENT OF CHOICE (spec §8, §Count
	//preview). Choosing values with no idea what they yield is an act of faith;
	//the count that answers it belongs inside the editor, next to the values,
	//and it has to move when they do. Driven through the component's own
	//retained-count cache, the way the keystroke-retention test above drives it:
	//that is the layer the count is read from, and it makes the assertion about
	//WHAT IS DISPLAYED rather than about worker timing.
	it('runs a live count inside the clause editor as its values change', async () => {
		window.localStorage.setItem('collection-composer-preview', 'on');
		try {
			await seedDraft('everything/updated/between/2026-01-01/2026-02-01/');
			const known = (count) => {
				dialog._retainedPreviewCounts.set(dialog._previewCountKey(dialog._collectionDescription), count);
				dialog._refreshPreviewCounts();
			};
			known(57);
			await openClauseEditor();
			const readout = () => dialog.shadowRoot.querySelector('.clause-editor .editor-count');
			const text = () => readout().textContent.replace(/\s+/g, ' ').trim();
			assert.ok(readout(), 'the open editor states what the draft matches');
			//'now', because a clause edit is already in the draft — the panel's
			//own contract sentence one line above says so.
			assert.match(text(), /The draft now matches 57 cards/);

			//Changing a value makes it a different collection, so the number is
			//genuinely unknown — and says so through the shared loading
			//primitive rather than blanking or lying.
			const date = await editorDateControl();
			const input = date.shadowRoot.querySelector('[aria-label="First fixed date"]');
			input.value = '2026-01-15';
			input.dispatchEvent(new Event('change', { bubbles: true }));
			await settleRender(dialog);
			assert.ok(dialog.shadowRoot.querySelector('.clause-editor'), 'the editor is still open');
			const placeholder = readout().querySelector('loading-placeholder');
			assert.ok(placeholder, 'a count still arriving must say it is still arriving');
			assert.strictEqual(placeholder.noun, 'the card count');

			//And the answer for the new values lands in the same place.
			known(12);
			await settleRender(dialog);
			assert.match(text(), /The draft now matches 12 cards/);
		} finally {
			window.localStorage.removeItem('collection-composer-preview');
			dialog._retainedPreviewCounts.clear();
		}
	});

	//THE PENDING-ADD PANEL PREVIEWS WHAT CONFIRMING WOULD PRODUCE. Nothing is
	//added until the user confirms — that contract is unchanged — so the count
	//is explicitly conditional ('Would match'), and it is a count of the draft
	//PLUS the filter as currently valued, which is a different collection from
	//the draft's own.
	it('previews what a pending Configure would match, from the anchored panel', async () => {
		window.localStorage.setItem('collection-composer-preview', 'on');
		try {
			Array.from(dialog.shadowRoot.querySelectorAll('button'))
				.find((button) => button.textContent.includes('Browse all filters')).click();
			await settleRender(dialog);
			Array.from(dialog.shadowRoot.querySelectorAll('#collection-filter-catalog [role=option]'))
				.find((button) => button.textContent.includes('Updated')).click();
			await settleRender(dialog);

			const panel = dialog.shadowRoot.querySelector('.pending-filter-editor');
			assert.ok(panel, 'the Configure panel is on screen');
			//ANCHORED IN THE SAME SLOT AS THE CLAUSE EDITOR, under the sentence —
			//not at the bottom of the catalog's scrolling column.
			const slot = panel.closest('.anchored-editor');
			assert.ok(slot, 'the Configure panel renders in the anchored slot');
			assert.strictEqual(slot.previousElementSibling,
				dialog.shadowRoot.querySelector('.expression'),
				'directly under the draft sentence');
			assert.strictEqual(panel.closest('.builder-catalog'), null,
				'and no longer inside the catalog list’s own column');
			assert.ok(dialog.shadowRoot.querySelector('#collection-filter-catalog'),
				'the catalog is still browsable underneath it');

			const readout = () => dialog.shadowRoot.querySelector('.pending-filter-editor .editor-count');
			const text = () => readout().textContent.replace(/\s+/g, ' ').trim();
			//Unknown at first, and honest about it.
			assert.ok(readout()?.querySelector('loading-placeholder'),
				'an unresolved count says it is still arriving');

			//The collection it counts is the DRAFT PLUS the configured filter.
			const { collectionDescriptionWithFilterAppended } = await import('../../lib/src/collection_description.js');
			const withPending = () => collectionDescriptionWithFilterAppended(
				dialog._collectionDescription, dialog._pendingCatalogFilter);
			const known = (count) => {
				dialog._retainedPreviewCounts.set(dialog._previewCountKey(withPending()), count);
				dialog._refreshPreviewCounts();
			};
			known(57);
			await settleRender(dialog);
			assert.match(text(), /Would match 57 cards/);
			assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [],
				'and previewing a pending filter has still added nothing');

			//Change a value: the panel stays open, and the count follows it.
			const pending = dialog.shadowRoot.querySelector('.pending-filter-editor configure-collection-filter');
			pending.dispatchEvent(new CustomEvent('filter-modified', {
				composed: true,
				detail: { value: 'updated/after/30-days-ago', index: -1 },
			}));
			await settleRender(dialog);
			assert.ok(dialog.shadowRoot.querySelector('.pending-filter-editor'),
				'a value change must not close the Configure panel');
			assert.strictEqual(dialog._pendingCatalogFilter, 'updated/after/30-days-ago');
			assert.ok(readout().querySelector('loading-placeholder'),
				'the count for the new values is not the old one');
			known(4);
			await settleRender(dialog);
			assert.match(text(), /Would match 4 cards/);

			//And the explicit confirm still is the only thing that adds it.
			dialog.shadowRoot.querySelector('.pending-filter-actions button[aria-label="Add this filter to the draft"]').click();
			await settleRender(dialog);
			assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['updated/after/30-days-ago']);
			assert.strictEqual(dialog.shadowRoot.querySelector('.anchored-editor'), null,
				'the panel closes once its filter is in the draft');
		} finally {
			window.localStorage.removeItem('collection-composer-preview');
			dialog._retainedPreviewCounts.clear();
		}
	});

	//THE KEYBOARD CLAUSE-SELECTION FLOW COULD NOT REACH WHAT IT SELECTED.
	//
	//Backspace selects the last clause and ←→ move between them, but Enter fell
	//through to the generic commit below — with no suggestion highlighted that
	//opens the current draft, and selecting a clause does not change the draft,
	//so the draft was equivalent to the collection already on screen and 'open'
	//meant 'close the composer'. The one obvious key threw the session away.
	it('opens the editor when Enter activates a selected clause', async () => {
		await seedDraft('everything/starred/updated/between/2026-01-01/2026-02-01/');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.focus();
		//Arrow into the suggestion list first: selecting a clause has to take
		//the highlight back from it, or two things read as selected and only
		//one is what Enter takes.
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await settleRender(dialog);
		assert.ok(highlightedRow(), 'a suggestion row is highlighted');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(dialog._selectedClauseIndex, 1, 'the last clause is selected');
		assert.strictEqual(highlightedRow(), null,
			'and the list gives up its highlight, so Enter is unambiguous');
		assert.ok(!dialog._builderExpanded, 'selecting is not yet editing');
		//The footer names the key before it is pressed.
		assert.match(dialog.shadowRoot.querySelector('.key-hints').textContent, /Enter edits it/);

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(dialog.open, true,
			'Enter on a selected clause must not close the composer');
		assert.strictEqual(window.location.pathname, '/c/main/', 'and must not navigate');
		const editor = dialog.shadowRoot.querySelector('.clause-editor');
		assert.ok(editor, 'it opens the editor for the clause it had selected');
		assert.match(editor.textContent, /Editing Updated/);

		//FOCUS LANDS ON THE FIRST CONTROL, the same way a click does — the
		//existing focusPrimaryControl path, reached from the keyboard.
		const filter = dialog.shadowRoot.querySelector('.clause-editor configure-collection-filter');
		assert.strictEqual(dialog.shadowRoot.activeElement, filter,
			'focus is inside the editor that just opened');
		assert.ok(filter.shadowRoot.activeElement?.closest('configure-collection-date'),
			'and specifically in the clause’s own first control');
	});

	//THE DIALOG'S BOX MUST NOT MOVE UNDER A KEYSTROKE.
	//
	//Live review measured the composer's content box at 512px, 896px and 567px
	//on three consecutive characters of one session: .content sizes to its
	//content horizontally between min-width:40% and max-width:70%, and
	//.background centres it, so every re-measure moved the left edge of the
	//input the user was typing into. The height was already pinned for exactly
	//this reason; the width was the half nobody had done. JSDOM computes no
	//layout, so what is pinned is the rule that makes the resize impossible.
	it('pins the composer dialog to one box, so typing cannot move it', async () => {
		const styles = composerStyles();
		//Anchored on the custom property, because DialogElement's own .content
		//rule is in the same concatenated sheet and comes first.
		const content = styles.match(/\.content\s*\{[^}]*--composer-width[^}]*\}/);
		assert.ok(content, 'the composer must have its own .content rule');
		assert.match(content[0], /--composer-width:\s*min\(64em,\s*92vw\)/,
			'one expression names the box, so the three properties below cannot drift apart');
		for (const property of ['width', 'min-width', 'max-width']) {
			assert.match(content[0], new RegExp(`[;{]\\s*${property}:\\s*var\\(--composer-width\\)`),
				`${property} must take the pinned width, or the base rule's percentages re-enter and the box sizes to content again`);
		}
		assert.match(content[0], /height:\s*90%/, 'the height pin wave 1 added stays');
		//And nothing in the composer's own sheet may size the box to content.
		assert.ok(!/\.content\s*\{[^}]*width:\s*(auto|fit-content|max-content)/.test(styles),
			'no rule may hand the width back to the content');
	});

	//THE DIALOG'S NAME AND ITS HEADING ARE ONE STRING.
	//
	//A review reported the composer announcing itself as 'Compose' while its
	//heading read 'Compose a Collection'. It does not: the heading the title
	//property renders IS the element aria-labelledby points at, so there is no
	//second string that could drift. ('Compose' is compose-dialog's title —
	//a different dialog, in a different shadow root.) Pinned so the property
	//stays structural rather than remaining a coincidence.
	it('announces itself with the heading it shows', async () => {
		const heading = dialog.shadowRoot.querySelector('h2');
		const content = dialog.shadowRoot.querySelector('.content');
		assert.strictEqual(heading.textContent.trim(), 'Compose a Collection');
		assert.strictEqual(dialog.title, heading.textContent,
			'the title property and the visible heading are the same string');
		assert.strictEqual(content.getAttribute('aria-label'), null,
			'a second name would be free to drift from the visible one');
		assert.strictEqual(content.getAttribute('aria-labelledby'), heading.id,
			'the accessible name must BE the heading, not a copy of it');
	});

	//THE COMPOSER HAD NO MOTION AT ALL — not one transition or animation in
	//the whole component, while the spec asks for Card Web's existing short
	//fade timing on exactly the moments below. HS-4.4 gives the timing a token
	//and requires prefers-reduced-motion to be respected.
	it('fades its layers with the app\'s timing, and holds still when asked to', async () => {
		//The composer's OWN block, not the shared sheets it imports:
		//ButtonSharedStyles carries the app-wide button transition, and that is
		//not this component's to gate.
		const sheets = dialog.constructor.styles;
		const styles = String(sheets[sheets.length - 1].cssText || '');
		assert.match(styles, /\.expression-clause/, 'the last sheet must be the composer\'s own');
		//Every rule that moves anything is inside the gate, so reduced motion
		//gets the end state rather than a shortened version of the movement.
		const gate = styles.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\n\t{3}\}/);
		assert.ok(gate, 'the composer must gate its motion on prefers-reduced-motion');
		const outside = styles.replace(gate[0], '');
		assert.ok(!/\n\s*(transition|animation):/.test(outside),
			'no transition or animation may sit outside the gate:\n' +
			(outside.match(/.*\b(transition|animation):.*/g) || []).join('\n'));
		//The timing is the token's, never a hand-written duration (HS-4.4).
		for (const declaration of gate[0].match(/\b(transition|animation):[^;]*/g) || []) {
			assert.match(declaration, /var\(--transition-fade\)/,
				`motion must take the app's timing token: ${declaration}`);
		}
		//The moments the spec names: the surface arriving, the highlight
		//moving, and a layer being revealed.
		assert.match(gate[0], /\.container\.open \.content\s*\{[^}]*animation:\s*composer-settle/);
		assert.match(gate[0], /\.suggestion button,\s*\.suggestion-action\s*\{[^}]*transition:/);
		//The revealed layer is now the ANCHORED SLOT rather than the Configure
		//panel by name: both editors render into that one slot, so animating it
		//covers the pair the old selector had to list. Same moment, same
		//keyframes, one fewer place to forget.
		assert.match(gate[0], /\.builder,\s*\.anchored-editor\s*\{[^}]*animation:/);
		//And nothing animated is a layout property — the box and the row
		//columns were pinned precisely so nothing moves under a keystroke.
		for (const property of ['width', 'height', 'margin', 'padding', 'grid-template', 'flex']) {
			assert.ok(!new RegExp(`(transition|animation):[^;]*\\b${property}\\b`).test(gate[0]),
				`${property} is a layout property and must not be animated`);
		}
	});

	//THE FOOTER MUST STATE A CONTRACT THAT IS ACTUALLY IN FORCE.
	//
	//'Click edits' was printed whenever a list was on screen with nothing
	//highlighted, including when every row in it was a destination that
	//clicking OPENS — the one verb a footer must never get wrong. And the main
	//state never named Escape, though the spec's example contract ends with it.
	it('states the key contract the highlighted row actually has', async () => {
		const hints = () => dialog.shadowRoot.querySelector('.key-hints').textContent;
		await seedRecents([['main/starred/sort/recent/', 2]]);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		const arrowTo = async (label) => {
			for (let step = 0; step < 12; step++) {
				input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
				await dialog.updateComplete;
				if (label.test(highlightedRow().textContent)) return;
			}
			assert.fail(`never reached a row matching ${label}`);
		};

		//THE MAIN STATE: nothing highlighted, a list on screen.
		assert.strictEqual(highlightedRow(), null);
		assert.ok(!/Click edits/.test(hints()),
			'with nothing highlighted the rows differ, so the footer must claim no verb for clicking one');
		assert.match(hints(), /Enter opens this collection/);
		assert.match(hints(), /Escape cancels/,
			'the spec\'s example contract ends with Escape, and it is the only way out that does not navigate');

		//AN OPEN ROW: clicking it navigates, so the footer says so.
		await arrowTo(/Main AND Starred/);
		assert.match(hints(), /Click or Enter opens/,
			'a destination is opened by a click, not edited by one');
		assert.match(hints(), /Tab copies it into the draft/);

		//AN ADD ROW: clicking it changes the draft.
		await arrowTo(/Add Starred/);
		assert.match(hints(), /Click or Tab adds · Enter adds and opens/);
	});

	//'0 cards' IS A NUMBER, NOT A SENTENCE, and the spec asks for the sentence.
	//A draft that resolves to nothing said only "0 cards" beside the button that
	//would open it, which reads like a count still arriving.
	it('says a draft matches nothing, next to the control that would open it', async () => {
		const actions = () => dialog.shadowRoot.querySelector('.buttons.composer-actions');
		dialog._previewCounts = { [dialog._draftPreviewID]: 12 };
		await dialog.updateComplete;
		assert.strictEqual(actions().querySelector('.no-cards-note'), null,
			'a draft with cards says nothing about being empty');

		dialog._previewCounts = { [dialog._draftPreviewID]: 0 };
		await dialog.updateComplete;
		assert.strictEqual(actions().querySelector('.no-cards-note').textContent, 'No cards currently match');
		//The count is still there: the sentence adds to it rather than replacing it.
		assert.match(actions().querySelector('.action-count').textContent, /0 cards/);

		//Undefined is "not in yet", which is a different fact and gets no claim.
		dialog._previewCounts = {};
		await dialog.updateComplete;
		assert.strictEqual(actions().querySelector('.no-cards-note'), null);
	});

	//MOBILE READING ORDER: what it is, what it costs, what it does, why.
	//The verb had a full-width row of its own between the label and the
	//description, so a row read "Add Starred / 18 cards / ADD / Adds Starred to
	//this collection" — the consequence interrupting the thing it is a
	//consequence of.
	it('keeps a mobile row’s verb beside its count instead of between label and description', () => {
		const styles = composerStyles();
		const mobileGrid = /\.mobile \.suggestion button\s*\{([^}]*)\}/.exec(styles);
		assert.ok(mobileGrid, 'the mobile row grid must exist');
		const areas = mobileGrid[1].replace(/\s+/g, ' ');
		assert.match(areas, /'label\s+count'\s*'label\s+action'/,
			`the verb must share the count's column, under it: ${areas}`);
		assert.ok(!/'action\s+action'/.test(areas),
			'the verb must not take a full-width row of its own');
		//And detail stays after both, unbroken.
		assert.ok(areas.indexOf('detail') > areas.indexOf('action'));
		assert.match(styles, /\.mobile \.suggestion-action\s*\{[^}]*justify-self:\s*end/);
	});

	//A FOOTER MUST NOT NAME CONTROLS THE DEVICE DOES NOT HAVE.
	//
	//On a touch layout the contract line still read "↑↓ or Tab choose · Click
	//edits…" — four inputs a phone has none of. Same class of defect as naming
	//the wrong verb, one level up. Each row now carries its own visible verb
	//chip, so the touch line points at that.
	it('states a contract a touch layout can actually keep', async () => {
		const hints = () => dialog.shadowRoot.querySelector('.key-hints').textContent;
		await seedRecents([['main/starred/sort/recent/', 2]]);
		assert.match(hints(), /↑↓/, 'the desktop line names the keys');

		dialog.mobile = true;
		await dialog.updateComplete;
		const mobileHints = hints();
		for (const keyboardOnly of ['↑↓', 'Tab', 'Enter', 'Escape', 'Click']) {
			assert.ok(!mobileHints.includes(keyboardOnly),
				`the touch contract must not name ${keyboardOnly}: ${mobileHints}`);
		}
		assert.match(mobileHints, /Tap a row to use it/);
		assert.match(mobileHints, /tap the open button for this collection/);
		dialog.mobile = false;
		await dialog.updateComplete;
	});

	it('keeps the collection sentence out of the card scroller', async () => {
		//The sentence is the spec's persistent anchor and the composer's only
		//mouse entry point, and it was the first child of the scrolling card
		//list — so a few arrow-key steps down the list scrolled it off the top.
		//Nothing that says "persistent" can be an item in a scrolling region.
		const drawer = document.createElement('card-drawer');
		drawer.showing = true;
		document.body.append(drawer);
		await drawer.updateComplete;
		const scroller = drawer.shadowRoot.querySelector('.scrolling.scroller');
		const count = drawer.shadowRoot.querySelector('#count');
		assert.ok(scroller, 'the card list still scrolls');
		assert.ok(count, 'the summary block still exists');
		assert.ok(!scroller.contains(count), 'the summary must not live inside the scroller');
		assert.strictEqual(count.parentElement, scroller.parentElement, 'it is the scroller’s sibling');
		assert.ok(count.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING,
			'and it comes above the list, not below it');
		//Both slots travel with it, so the sentence card-view supplies through
		//visible-info is anchored too — it is the half a user actually reads.
		assert.ok(count.querySelector('slot[name="visible-info"]'), 'the sentence slot moved with the count');
		assert.ok(count.querySelector('slot[name="info"]'), 'and so did the details slot');
		//The list itself is still the scroller's business, drag targets and all.
		assert.ok(scroller.querySelector('card-thumbnail-list'), 'the thumbnails stayed in the scroller');
		drawer.remove();
	});

	it('brings a closed draft back, chips typed text and all, on the same collection', async () => {
		const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
			.find((button) => button.textContent.includes('Add Starred'));
		suggestion.click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'work in progress';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);

		//Escape. Source mode has always kept its text through this; the quick
		//composer threw a multi-clause draft away in silence.
		dialog.cancel();
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);

		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await dialog.updateComplete;
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'the chips come back');
		assert.strictEqual(dialog.shadowRoot.querySelector('.expression-clause-label').textContent.trim(), 'Starred');
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-composer-input').value, 'work in progress',
			'and so does the half-typed text');
		assert.match(dialog.shadowRoot.querySelector('.draft-receipt').textContent,
			/Restored the draft you were composing/,
			'chips reappearing with no explanation is its own small mystery');
	});

	it('names the catalog row Enter would act on, not every action the catalog has', async () => {
		//'Enter opens Source, configures, or adds' is three claims of which
		//exactly one is in force, with nothing saying which. The suggestion list
		//one branch over already lets the highlighted row decide the sentence.
		const hints = () => dialog.shadowRoot.querySelector('.key-hints').textContent;
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Browse all filters')).click();
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');

		input.value = 'text';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(hints(), /Enter configures it before adding/, hints());
		assert.ok(!hints().includes('opens Source, configures, or adds'), hints());

		input.value = 'starred';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await dialog.updateComplete;
		assert.match(hints(), /Enter adds it to the draft/, hints());

		//And the row's own verb chip agrees with the footer, because both come
		//from the one decision _handleCatalogItem makes.
		const row = dialog.shadowRoot.querySelector('#collection-filter-catalog [role=option]');
		assert.strictEqual(row.querySelector('.suggestion-action').textContent.trim(), 'Add');
	});

	//SENTENCE CASE, AND A VISIBLE CONSEQUENCE CLASS.
	//
	//The row verbs were lowercase text painted ALL-CAPS by text-transform: a
	//register §2.1 reserves for nothing, and one the DOM never agreed with, so
	//a screen reader said "add" while the screen said "ADD". Sentence case makes
	//them quieter, so the one verb that LEAVES — Open commits a navigation and
	//closes the composer — has to be told apart from the ones that rewrite the
	//draft by treatment as well as by the word.
	it('writes its row verbs in sentence case and marks the one that navigates', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		const chips = () => Array.from(dialog.shadowRoot.querySelectorAll('.suggestion-action'));
		assert.ok(chips().length, 'there are rows to check');
		for (const chip of chips()) {
			const word = chip.textContent.trim();
			assert.notStrictEqual(word, word.toLowerCase(), `a verb chip is still lowercase: ${word}`);
			assert.notStrictEqual(word, word.toUpperCase(), `a verb chip is still ALL CAPS: ${word}`);
			assert.strictEqual(chip.getAttribute('data-consequence'),
				word === 'Open' ? 'navigate' : 'transform', `wrong consequence class for ${word}`);
		}
		assert.ok(chips().some((chip) => chip.textContent.trim() === 'Open'), 'a recents row opens');
		assert.ok(chips().some((chip) => chip.textContent.trim() === 'Add'), 'a refinement row adds');

		const styles = composerStyles();
		assert.ok(!/\.suggestion-action\s*\{[^}]*text-transform/.test(styles),
			'the chip must not be painted ALL CAPS by CSS either');
		assert.match(styles, /\.suggestion-action\[data-consequence='navigate'\]\s*\{[^}]*background:\s*var\(--app-primary-color\)/,
			'the navigational verb is filled');
		assert.match(styles, /\.suggestion-action\[data-consequence='transform'\]\s*\{[^}]*border-color:\s*var\(--app-primary-color\)/,
			'the draft-transforming verbs are outlined');
	});

	//§4.6's heading register is h3-weight-normal in the subordinate colour, and
	//the spec writes every one of these headings sentence case. They were the
	//app's only ALL-CAPS headings — a fourth type register invented for one
	//dialog. text-transform never changed textContent, so the words were already
	//right; only the screen disagreed.
	it('sets its section headings in the app’s own subordinate register', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		const headings = Array.from(dialog.shadowRoot.querySelectorAll('.suggestion-heading'))
			.map((element) => element.textContent.trim());
		assert.ok(headings.includes('Continue'), `expected a Continue heading: ${headings.join(' | ')}`);
		for (const heading of headings) {
			assert.notStrictEqual(heading, heading.toUpperCase(), `heading is ALL CAPS: ${heading}`);
		}
		const styles = composerStyles();
		assert.ok(!/\.suggestion-heading\s*\{[^}]*text-transform/.test(styles));
		assert.ok(!/\.source-interpretation-label\s*\{[^}]*text-transform/.test(styles));
		assert.match(styles, /\.suggestion-heading\s*\{[^}]*font-weight:\s*400/);
		assert.match(styles, /\.suggestion-heading\s*\{[^}]*color:\s*var\(--app-dark-text-color-light\)/);
	});

	//Two numbers claimed to be "what Enter will do": the highlighted row's,
	//which was right, and the primary's readout, which described the draft. The
	//button's act never changes — clicking it always opens the draft — so
	//repointing its readout would make the button lie about itself. What
	//recedes is its weight.
	it('lets the highlighted row carry the number while it owns Enter', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		const actions = () => dialog.shadowRoot.querySelector('.buttons.composer-actions');
		assert.ok(actions());
		assert.ok(!actions().hasAttribute('data-deemphasized'),
			'with nothing highlighted Enter belongs to the primary, at full strength');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.ok(highlightedRow());
		assert.ok(actions().hasAttribute('data-deemphasized'),
			'with a row highlighted Enter belongs to the row, and the primary recedes');
		//It recedes; it is not disabled. The act is unchanged and still available.
		assert.ok(!actions().querySelector('button.primary').disabled);
		assert.match(composerStyles(), /\.buttons\.composer-actions\[data-deemphasized\]\s*\{[^}]*opacity/,
			'de-emphasis is weight, not the grey fill that means disabled');
	});

	//THE SCROLL PANES NEED A BOUNDARY, AND THEIR ROWS NEED TO LAND WHOLE.
	//
	//Both long lists take the shared .scroller treatment, which on an
	//overlay-scrollbar system is nothing at all: a list of twelve showing five
	//gave no sign the other seven existed, and the row at the boundary was cut
	//through its own label. The bottom fade is the affordance and it is
	//self-limiting — both panes are flex: 1 1 0, so content reaches the bottom
	//edge only when there is more of it than fits.
	it('bounds its scrolling lists and lands scrolled rows whole', async () => {
		const styles = composerStyles();
		const pane = styles.match(/\.suggestions,\s*\.catalog-list\s*\{[^}]*\}/);
		assert.ok(pane, 'both scroll panes must take one boundary rule');
		assert.match(pane[0], /mask-image:\s*linear-gradient\(to bottom,[^)]*currentColor[^}]*transparent 100%\)/,
			'a bottom fade is the affordance that says there is more below');
		assert.ok(!/mask-image:[^;]*#[0-9a-f]{3}/i.test(pane[0]),
			'a mask reads the alpha channel, so it must not name a colour (HS-4.1)');
		assert.match(pane[0], /scroll-padding-block:\s*2\.2em var\(--composer-edge-fade\)/,
			'the top value keeps the group heading on screen; the bottom value is the fade, so a row never lands under it');
		//And the reservation lives in ONE place: the row's own scroll-margin
		//would add to the container's padding rather than replace it.
		assert.ok(!/\.suggestion button\s*\{[^}]*scroll-margin/.test(styles),
			'the row must not carry a second, additive reservation');
		//The heading really is above row 0 inside the same scroller, which is
		//what the top value exists for.
		await seedRecents([['everything/starred/', 3]]);
		const list = dialog.shadowRoot.querySelector('#collection-composer-suggestions');
		assert.ok(list.querySelector('.suggestion-heading'), 'the heading scrolls with its rows');
		assert.ok(list.classList.contains('scroller'), 'the pane keeps the app-wide scroller idiom');
	});

	//The input flexes to exactly the width of #inner, the dialog's scroll
	//container, so a ring drawn 2px OUTSIDE it fell in the overflow on both
	//sides: the live review saw focus render as two disconnected purple bars
	//above and below the field, which reads as a rendering fault.
	it('draws the composer input\'s focus ring inside its own box', async () => {
		const styles = composerStyles();
		const ring = styles.match(/\.composer-input:focus-visible\s*\{[^}]*\}/);
		assert.ok(ring, 'the input needs a focus ring of its own');
		assert.match(ring[0], /outline-offset:\s*-2px/,
			'an inset ring cannot be clipped by the scroll container the input is exactly as wide as');
		assert.ok(!/\.composer-input:focus-visible\s*\{[^}]*outline-offset:\s*[0-9]/.test(styles),
			'a positive offset is the defect itself');
	});

	//EVERY ROW SHARES ONE COLUMN GRID.
	//
	//A CSS grid is scoped to its own container, so a per-row `auto` track is
	//measured per row: the live review found adjacent count columns starting
	//at 634px and 739px, and ADD / REPLACE chips at a different x on every
	//line. Three lists share the .suggestion markup, so fixing the tracks
	//fixes all three at once. Again, JSDOM computes no layout — the rule is
	//what is pinned, plus the DOM fact that all three lists really do use it.
	it('gives every row in every list the same column grid', async () => {
		const styles = composerStyles();
		const row = styles.match(/\.suggestion button\s*\{[^}]*\}/);
		assert.ok(row, 'the row button carries the grid');
		assert.match(row[0], /grid-template-columns:\s*minmax\(0, 1fr\) 14em 5\.5em/,
			'label flexes; count and action are FIXED, so their left edges cannot wander between rows');
		assert.ok(!/grid-template-columns:\s*minmax\(0, 1fr\) auto/.test(row[0]),
			'a content-sized track is the defect itself');
		assert.match(styles, /\.suggestion-count\s*\{[^}]*text-align:\s*right/,
			'the numbers line up with each other, not with the words after them');
		assert.match(styles, /\.suggestion-action\s*\{[^}]*justify-self:\s*start/,
			'the chip starts at the left edge of its fixed track, which is the same x on every row');
		assert.match(styles, /\.catalog-list \.suggestion\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 3\.25em/,
			'the polarity column is reserved on every catalog row, so a row with a Not toggle is no narrower than one without');

		//The count cell's width is reserved by the track, so it exists before
		//any count arrives — which is what stops the reflow when one lands.
		await seedRecents([['everything/starred/', 6], ['main/updated/after/3-days-ago/', 3]]);
		const rows = suggestionRows();
		assert.ok(rows.length >= 2, 'the list must actually have rows to check');
		assert.ok(rows.every((button) => button.closest('.suggestion')),
			'every option is a .suggestion row, so every option takes the shared grid');
		assert.ok(rows.some((button) => !button.querySelector('.suggestion-count')),
			'rows render before their counts arrive — the track, not the span, is what reserves the room');
	});

	//A `none` clause is the router's placeholder for a route that names no
	//collection. It should never reach a draft now, but a hand-typed route or an
	//old bookmark still can — and it used to render as the bare word 'None',
	//which reads like a condition somebody chose.
	it('names and explains a placeholder clause instead of showing the raw word', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await dialog.updateComplete;
		dialog._collectionDescription = CollectionDescription.deserialize('main/none/');
		dialog.requestUpdate();
		await settleRender(dialog);
		const chip = dialog.shadowRoot.querySelector('.expression-clause-label');
		assert.ok(chip);
		assert.strictEqual(chip.textContent.trim(), 'Nothing (placeholder)');
		assert.notStrictEqual(chip.textContent.trim(), 'None');
		const explanation = dialog.shadowRoot.querySelector('.unsupported-clause');
		assert.ok(explanation, 'a clause the composer cannot edit has to say why it is there');
		assert.match(explanation.textContent, /matches no cards/i);
	});

	it('never offers a none placeholder as somewhere to continue', async () => {
		await seedRecents([['main/none/', 9], ['everything/starred/', 2]]);
		const labels = suggestionLabels();
		assert.ok(labels.length, 'the list must actually have rows to check');
		assert.ok(!labels.some((label) => /\bNone\b/.test(label)),
			'a poisoned recent must never reach the CONTINUE list');
		assert.ok(!labels.some((label) => label.includes('Nothing (placeholder)')),
			'and not under its readable name either — it is not a destination at all');
		assert.ok(labels.some((label) => label.includes('Starred')),
			'while the real recent beside it survives');
	});

	//THE MOBILE TOOLBAR MUST NOT LOSE CONTROLS.
	//
	//Live review at 375px: ten round buttons in a nowrap row with overflow
	//visible, inside a column that centres its children — the row was far wider
	//than the viewport and centring pushed its left edge off screen. The first
	//item, the composer's own 'Compose collection' button, measured x=-107.
	//JSDOM computes no layout, so what is pinned is the rule that makes the
	//overflow impossible, read off the real registered component.
	it('wraps the mobile card-stage toolbar instead of pushing controls off screen', async () => {
		await import('../../lib/src/components/card-stage.js');
		const CardStage = customElements.get('card-stage');
		assert.ok(CardStage, 'card-stage must be registered');
		const styles = CardStage.styles.map((sheet) => String(sheet.cssText || '')).join('\n');
		const mobileToolbar = styles.match(/\.mobile \[name="actions"\]\s*\{[^}]*\}/);
		assert.ok(mobileToolbar, 'the mobile toolbar needs a rule of its own');
		assert.match(mobileToolbar[0], /flex-wrap:\s*wrap/,
			'controls that do not fit must move to the next row, not off the screen');
		assert.match(mobileToolbar[0], /max-width:\s*100%/,
			'and the row must be bounded, or centring pushes its left edge negative');
		assert.match(styles, /\.mobile \[name="actions"\]::slotted\(\*\)\s*\{[^}]*max-width:\s*100%/,
			'each slotted group is bounded too, so a single wide group wraps inside itself');

		//And the composer's own entry point is one of the controls in that row.
		//card-view cannot be mounted in this harness, so its placement is pinned
		//against the source the way the other card-view properties here are.
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		const start = source.indexOf('class=\'collection-mobile\'');
		assert.ok(start >= 0, 'the compose control must live in the actions toolbar');
		assert.match(source.slice(start - 200, start), /slot='actions'/);
		assert.match(source.slice(start, start + 400), /aria-label='Compose collection'/);
		assert.match(styles, /\.mobile \[name="actions"\]::slotted\(\*\)\s*\{[^}]*font-size/,
			'the existing mobile sizing survives the wrap');
	});

	//Ctrl/Cmd-Shift-L. One reviewer proved it opens Source with the path
	//selected; another saw nothing happen. Driven through the real registry from
	//the real binding, it works — so the discrepancy was modifier delivery, not
	//the binding. Pinned so it stays that way.
	it('opens Source with the path selected from the Ctrl-Shift-L combo', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/everything/starred/card-7');
		store.dispatch({ type: UPDATE_PAGE, location: 'https://example.com/c/everything/starred/card-7', page: 'c', pageExtra: 'everything/starred/card-7' });
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		//metaKey is the macOS spelling of the same combo the table declares as
		//`mod`; the registry accepts either.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, shiftKey: true, cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.strictEqual(store.getState().app.configureCollectionDialogMode, 'source');
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		assert.ok(input, 'the combo must land in Source mode');
		assert.strictEqual(input.value, '/c/everything/starred/card-7');
		assert.strictEqual(input.selectionStart, 0);
		assert.strictEqual(input.selectionEnd, input.value.length,
			'the whole path is selected, so the next keystroke replaces it');
		window.history.replaceState({}, '', '/c/main/');
	});

	//THE PERSISTENT COLLECTION SENTENCE, in the drawer.
	//
	//card-view cannot be mounted in this harness, so these are source pins, the
	//same idiom the card-stage toolbar test above uses.
	//
	//The whole sentence rendered as one flat interpolation, so AND and
	//"sorted by" carried the same weight as the clause names they join — the
	//spec makes operators quiet textual structure, and the composer's own draft
	//has said so since the last wave. The copy-link glyph was centred against a
	//block that is one line for Everything and three for anything else, so it
	//floated in the middle of a wrapped paragraph. And the card count sat in a
	//centred row above a left-aligned sentence, reading as unrelated to the
	//sentence whose cards it is counting.
	it('renders the drawer collection sentence with quiet operators, beside its count', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		assert.match(source, /collectionExpressionParts/,
			'the sentence is built from parts, so operators can be styled apart from clauses');
		assert.match(source, /class='collection-summary-operator'/);
		assert.match(source, /\.collection-summary-operator\s*\{[^}]*color:\s*var\(--app-dark-text-color-light\)/,
			'the operators step down to the subordinate colour');
		assert.match(source, /\.collection-summary\s*\{[^}]*align-items:\s*start/,
			'the copy-link glyph sits on the sentence’s first line, not centred over a wrapped block');

		const drawer = await readFile(path.join(REPO_ROOT, 'src/components/card-drawer.ts'), 'utf8');
		assert.match(drawer, /#count\.grouped\s*\{[^}]*text-align:\s*left/,
			'the count shares the sentence’s alignment');
		assert.match(drawer, /collectionComposerEnabled\(\) \? 'grouped' : ''/,
			'and only where the sentence exists — the legacy drawer keeps its centred count');
	});

	//EMPTY-STATE HIERARCHY. The three elements arrived in inverse order of
	//importance: a filled purple Refine button out-shouted everything, the
	//sentence that says WHAT is absent was at body size, and the expression —
	//the thing a user would have to change — was the smallest text on an
	//otherwise empty stage.
	it('leads the empty state with what is absent, not with the button', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		const rule = (selector) => {
			const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(source);
			assert.ok(match, `${selector} must have a rule`);
			return match[1];
		};
		const message = rule('.collection-empty-message');
		assert.match(message, /font-size:\s*1\.3em/, 'the heading leads');
		assert.match(message, /font-family:\s*var\(--app-header-font-family\)/,
			'§4.3 gives a title moment the display family');
		const expression = rule('.collection-empty-expression');
		assert.match(expression, /font-size:\s*0\.95em/, 'the expression is readable second');
		assert.match(expression, /color:\s*var\(--app-dark-text-color-darker\)/,
			'and readable at all — the light token is ~2.3:1 on white');
		const refine = rule('.collection-empty-refine');
		assert.match(refine, /font-size:\s*0\.85em/, 'the gate is present, not dominant');
		assert.match(refine, /min-height:\s*44px/, 'and still a 44px hit target (§4.2)');
		//The variant itself is right and stays: §4.2 names the filled text
		//button for a gate, and taking it fixed purple-on-dark-grey.
		assert.match(source, /class='text collection-empty-refine'/);
	});

	//THE SENTENCE AND THE COUNT HAVE TO AGREE.
	//
	//When "Didn't understand 'tag-33x' in this URL" fires, the collection is
	//computed WITHOUT that clause — but the sentence went on listing it in the
	//same weight as every real clause, two lines above the notice contradicting
	//it. The clause stays visible (the user asked for it, and §Unavailable
	//filter says preserve and explain) and reads as what it is: named, not
	//applied.
	it('marks a clause the URL parser could not resolve in the collection sentence', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		const start = source.indexOf('class=\'collection-summary-expression\'');
		assert.ok(start >= 0, 'the summary must render the expression');
		//To the NEXT element of the summary, not to the first '</span>': the
		//expression's own template closes several spans of its own.
		const block = source.slice(start, source.indexOf('collection-summary-action', start));
		assert.match(block, /\?data-unresolved=\$\{unresolved\.has\(filter\.raw\)\}/,
			'each clause is marked against the arrival\'s own diagnostics');
		//The STRIKE is the signal, not the colour — colour alone would carry it
		//to nobody who cannot see it (§4.1).
		assert.match(source, /\.collection-summary-clause\[data-unresolved\]\s*\{[^}]*text-decoration:\s*line-through/);
		assert.ok(!/\.collection-summary-clause\[data-unresolved\]\s*\{[^}]*var\(--app-warning-color\)/.test(source),
			'nothing went wrong here, so it does not take the amber state colour');
		//And assistive tech, which gets neither the strike nor the tooltip,
		//hears it in the button's name.
		const nameStart = source.indexOf('get _collectionSummaryName()');
		const name = source.slice(nameStart, source.indexOf('\n\t}', nameStart));
		assert.match(name, /not understood and/, 'the accessible name says which clauses were struck');
		//The diagnostic itself stays where it was — this marks the sentence, it
		//does not replace the notice.
		const drawer = await readFile(path.join(REPO_ROOT, 'src/components/card-drawer.ts'), 'utf8');
		assert.match(drawer, /Didn’t understand/, 'the notice is still shown');
	});

	//SPEC §Narrow: suggestions are suppressed when they are contradictory. A
	//narrowing clause whose RESOLVED count is zero, offered under the heading
	//"Refine this collection", proposes a refinement that refines the collection
	//out of existence.
	it('keeps a contradictory refinement out of the Refine list, and in the catalog', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		//A resolved, non-zero draft, and a resolved zero for one add row.
		const draftKey = dialog._previewCountKey(dialog._collectionDescription);
		dialog._retainedPreviewCounts.set(draftKey, 42);
		const addRow = dialog._composerSuggestions.find(suggestion => suggestion.action === 'add');
		assert.ok(addRow, 'there is an add row to suppress');
		dialog._retainedPreviewCounts.set(dialog._previewCountKey(addRow.description), 0);
		dialog.requestUpdate();
		await settleRender(dialog);
		assert.ok(!dialog._composerSuggestions.some(suggestion => suggestion.id === addRow.id),
			'a clause that resolves to nothing is not a refinement');
		//Still findable: the catalog is a different surface and is untouched.
		assert.ok(dialog._catalogItems.some(item => addRow.description.filters.includes(item.filter)),
			'the filter itself is still in the catalog');
		//And once the user NAMES it, it comes back — the rows are then
		//interpretations of what they typed, not unsolicited offers.
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		await typeInto(input, dialog._composerFilterLabels[addRow.description.filters.slice(-1)[0]] ||
			addRow.description.filters.slice(-1)[0]);
		assert.ok(dialog._composerSuggestions.some(suggestion => suggestion.description.serialize() === addRow.description.serialize()),
			'a filter the user asked for by name is never hidden from them');
		await typeInto(input, '');
	});

	//THE FOOTER STATES THE CONTRACT THAT IS IN FORCE. '←→ choose clause' is true
	//only while the composer INPUT has focus; once a clause editor is open,
	//focus is inside it and ←→ move the caret in its own fields. Routing the
	//keys away from the editor would break editing a date to keep a footer
	//honest, so the footer says what this mode actually offers.
	it('stops promising ←→ once a clause editor owns the arrow keys', async () => {
		const { updateCollectionConfigurationSnapshot } = await import('../../lib/src/actions/collection.js');
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize('everything/starred/unread/')));
		await settleRender(dialog);
		const hints = () => dialog.shadowRoot.querySelector('.key-hints').textContent.trim();
		//Selecting a clause without opening its editor: the keys really are the
		//composer input's, and the line is unchanged.
		dialog._selectedClauseIndex = 0;
		await settleRender(dialog);
		assert.match(hints(), /←→ choose clause/);
		//Opening the editor moves focus into it.
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await settleRender(dialog);
		assert.ok(dialog._builderExpanded, 'the editor is open');
		assert.ok(!/←→/.test(hints()), `the footer must not promise a key the editor owns: ${hints()}`);
		assert.match(hints(), /Editing a clause/);
		//And it names the way out that is actually registered for this layer.
		assert.match(hints(), /closes the editor/);
	});

	//A LIST OPENS AT ITS TOP.
	//
	//The panes are not recreated between sessions, so their scrollTop survived
	//close-and-reopen: a session that had arrowed down the suggestions reopened
	//HEADERLESS in the middle of the list, with the CONTINUE heading and the
	//0-card Remove diagnostics scrolled away and no sign anything was above.
	it('reopens its lists at the top, and starts every transition there', async () => {
		await seedRecents([['main/starred/sort/recent/', 2], ['everything/unread/', 3]]);
		const pane = () => dialog.shadowRoot.querySelector('.suggestions');
		assert.ok(pane(), 'there is a suggestion pane to scroll');
		pane().scrollTop = 120;
		//Close and reopen, the way a user does.
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		await settleRender(dialog);
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await settleRender(dialog);
		assert.strictEqual(pane().scrollTop, 0, 'a reopened list starts at its top');
		//And so does every transition that replaces what the pane holds.
		pane().scrollTop = 90;
		dialog._catalogOpen = true;
		await settleRender(dialog);
		const catalog = dialog.shadowRoot.querySelector('.catalog-list');
		assert.ok(catalog, 'the catalog is on screen');
		catalog.scrollTop = 140;
		dialog._catalogOpen = false;
		await settleRender(dialog);
		assert.strictEqual(pane().scrollTop, 0, 'closing the catalog returns to the top of the list');
	});

	//AN EDITOR THAT OPENS BELOW THE FOLD HAS NOT OPENED. The anchored slot is
	//the second child of #inner, so this is now a backstop rather than the whole
	//defence — a session scrolled down to the catalog before clicking a chip
	//would still open the editor above its scroll position. REWRITTEN for the
	//element that is actually scrolled: '.builder-clause' no longer exists.
	it('scrolls a clause editor into view when it opens', async () => {
		const scrolled = [];
		const original = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function (options) {
			scrolled.push({ element: this, options });
		};
		try {
			store.dispatch(await (async () => {
				const { updateCollectionConfigurationSnapshot } = await import('../../lib/src/actions/collection.js');
				return updateCollectionConfigurationSnapshot(CollectionDescription.deserialize('everything/starred/unread/'));
			})());
			await settleRender(dialog);
			scrolled.length = 0;
			const clause = dialog.shadowRoot.querySelector('.expression-clause-label');
			assert.ok(clause, 'there is a clause to edit');
			clause.click();
			await settleRender(dialog);
			assert.ok(dialog.shadowRoot.querySelector('.anchored-editor'), 'the editor is rendered');
			const editorScroll = scrolled.find(entry => entry.element.classList?.contains('anchored-editor'));
			assert.ok(editorScroll, 'the editor that just opened must be scrolled into view');
			//'nearest' scrolls the least that makes it visible, so an editor
			//already on screen does not jump.
			assert.deepStrictEqual(editorScroll.options, { block: 'nearest' });

			//AND IT DOES NOT SCROLL AGAIN ON EVERY FIELD EDIT. _selectedClauseIndex
			//now leaves and re-enters its own value on each edit (that is what
			//keeps the editor open), which Lit reports as a change; scrolling on
			//that would yank the port under someone typing a date.
			scrolled.length = 0;
			const filter = dialog.shadowRoot.querySelector('.clause-editor configure-collection-filter');
			filter.dispatchEvent(new CustomEvent('filter-modified', {
				composed: true,
				bubbles: true,
				detail: { value: 'unread', index: dialog._selectedClauseIndex },
			}));
			await settleRender(dialog);
			assert.ok(!scrolled.some(entry => entry.element.classList?.contains('anchored-editor')),
				'an edit inside the open editor must not re-scroll the dialog');
		} finally {
			Element.prototype.scrollIntoView = original;
		}
	});

	//AND ITS ACTION ROW STAYS INSIDE THE DIALOG. Live: a tall Configure Direct
	//References panel pushed Cancel and Add past .builder-catalog's clipped
	//bottom edge — the buttons painted, and a real click at y=644 in a dialog
	//ending at y=636 did nothing.
	it('bounds the configure panel so its own action row stays clickable', async () => {
		const styles = composerStyles();
		const rule = (selector) => {
			const match = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(styles);
			assert.ok(match, `${selector} must have a rule`);
			return match[1];
		};
		//Shrinkable, and scrolling inside its own box rather than out of the
		//pane that clips it. REWRITTEN as the shared rule: the Configure panel
		//and the clause editor now render in the same anchored slot and are
		//bounded by one rule apiece rather than two copies, so the selectors
		//name both. The properties, and the reason for them, are unchanged.
		const editor = rule('\\.pending-filter-editor,\\s*\\.clause-editor');
		assert.match(editor, /flex:\s*0 1 auto/);
		assert.match(editor, /min-height:\s*0/);
		//Only the BODY scrolls: the action row is a sibling of the scroller and
		//reserves its room out of it, so 'Cancel' and 'Add' are on screen
		//whatever height the panel gets. Left inside the scroller they were the
		//first things to fall off the bottom of it.
		const body = rule('\\.pending-filter-body,\\s*\\.clause-editor-body');
		assert.match(body, /flex:\s*1 1 auto/);
		assert.match(body, /min-height:\s*0/);
		assert.match(rule('\\.buttons\\.pending-filter-actions,\\s*\\.clause-editor-actions,\\s*\\.pending-filter-heading,\\s*\\.clause-editor-heading'), /flex:\s*0 0 auto/);
		//The scroller idiom is declared in markup, per #759 — the module owns
		//`overflow: auto` and no component restates it.
		const source = await readFile(path.join(REPO_ROOT, 'src/components/configure-collection-dialog.ts'), 'utf8');
		assert.match(source, /class='pending-filter-body scroller'/,
			'the configure panel body is a deliberate inner pane');
		//And its heading — which carries the 'nothing changes until you
		//confirm' contract — is outside that pane, so opening the panel cannot
		//scroll the contract off screen.
		assert.match(source, /class='pending-filter-heading'/,
			'the configure panel states its contract outside its scroller');
		//And the lists give up their floor first, so the panel keeps a usable
		//size before anything has to scroll. This used to key off
		//`data-configuring` on .builder-catalog, which only existed while the
		//panel was INSIDE the catalog; the panel is anchored under the sentence
		//now, so the flag is reflected on the host and covers both lists and
		//both editors.
		assert.match(styles, /:host\(\[data-editor-open\]\) \.suggestions,\s*:host\(\[data-editor-open\]\) \.catalog-list\s*\{[^}]*min-height:\s*4em/);
		assert.match(source, /toggleAttribute\('data-editor-open'/,
			'the attribute has to be set for the rule to fire');
		//The footer is the last flex child of the scroll port, so scrolling an
		//editor to its bottom edge would push Open and Cancel out of view.
		assert.match(styles, /#inner\s*\{[^}]*scroll-padding-block-end/);
	});
});
