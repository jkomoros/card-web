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
		assert.match(block, /title=\$\{`Refine collection: \$\{readableCollectionExpression\(this\._collection\.description\)\}`\}/,
			'hover must reveal the complete expression, in the command form');
		assert.match(block, /aria-label=\$\{`Refine collection: \$\{readableCollectionExpression/,
			'assistive tech must hear the complete expression');
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
		//say, with the action grammar's verb in front of it.
		assert.match(labels[0], /Add Tagged Systems/);
		assert.match(labels[1], /Add Section Half Baked/);
		assert.match(labels[2], /Add This card and directly connected cards/);
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
		assert.strictEqual(suggestion.querySelector('.suggestion-action').textContent, 'edit');
		suggestion.click();
		await dialog.updateComplete;
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.strictEqual(dialog._entryMode, 'source');
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-source-input').value, '/c/exclude/');
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
		assert.strictEqual(input.value, '/c/upd/');
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

	//THE CLAUSE EDITOR IS A BOUNDED PANE.
	//
	//Live review: the 'Editing Updated between…' panel measured 262px inside a
	//720px dialog and ran past its bottom; .composer-actions, laid out after it,
	//hit-tested ABOVE both date inputs, so the fields were click-dead and 'Done
	//editing' and 'Remove filter' rendered where nothing paints. JSDOM computes
	//no layout, so the STRUCTURE that makes the overlap impossible is what is
	//pinned: the editor is its own scroll container, and the footer is not
	//inside it and cannot be squeezed out of its own room.
	it('keeps the clause editor inside a bounded pane, with the footer out of its flow', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		await typeInto(input, 'star');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await settleRender(dialog);
		dialog.shadowRoot.querySelector('.expression-clause-label').click();
		await settleRender(dialog);

		const editor = dialog.shadowRoot.querySelector('.clause-editor');
		assert.ok(editor, 'the clause editor must be on screen');
		const pane = editor.closest('.builder');
		assert.ok(pane, 'the editor lives in a builder region');
		assert.ok(pane.classList.contains('scroller'),
			'that region must be a bounded scroll container, not loose content that overflows the dialog');

		const footer = dialog.shadowRoot.querySelector('.buttons.composer-actions');
		assert.ok(footer);
		assert.strictEqual(footer.closest('.builder'), null,
			'the footer must be outside the editor pane, never a sibling it can paint over');
		assert.ok(footer.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_PRECEDING,
			'and it must come after it, so its room is reserved rather than borrowed');
		//Both controls the review found unreachable are inside the bounded pane.
		assert.match(pane.textContent, /Done editing/);
		assert.match(editor.querySelector('configure-collection-filter').shadowRoot.textContent, /Remove filter/);

		const styles = dialog.constructor.styles.map((sheet) => String(sheet.cssText || '')).join('\n');
		assert.match(styles, /\.builder-clause\s*\{[^}]*flex:\s*1 1 0/,
			'the pane takes the room the dialog body has left rather than its content height');
		assert.match(styles, /\.buttons\.composer-actions\s*\{[^}]*flex:\s*0 0 auto/,
			'the footer never shrinks to make room for an editor');
		assert.match(styles, /\.builder-catalog\s*\{[^}]*overflow:\s*hidden/,
			'a shrunken flex item must clip rather than paint over what follows it');
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
});
