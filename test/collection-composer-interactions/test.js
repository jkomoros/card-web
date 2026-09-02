/*eslint-env node, es2022*/

import { JSDOM } from 'jsdom';
import assert from 'assert';
import { readFile, readdir } from 'fs/promises';
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
	//The canonical combo table's own formatter (#740). The committing button's
	//name is DERIVED from it (round 9), and these pins derive theirs the same
	//way: a pin that spelled 'Cmd-Enter' by hand would be exactly the drift the
	//table exists to abolish, and it would fail off a Mac.
	let shortcutKeys;
	const openActionName = () => `Open this collection (${shortcutKeys('commit-collection-composer')})`;

	before(async () => {
		({ store } = await import('../../lib/src/store.js'));
		({ shortcutKeys } = await import('../../lib/src/shortcuts-data.js'));
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
			for (const element of elements) if (element) await element.updateComplete;
		}
	};

	const suggestionRows = () =>
		Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));

	//A ROW'S VISIBLE TEXT NOW CROSSES A SHADOW BOUNDARY. A recent renders as a
	//miniature <collection-sentence> and a completion renders as the pill it
	//would become, both of which put their words in their OWN shadow root — so
	//`button.textContent` sees an empty row. Descending is what the reader's eye
	//does; this is the same descent the accessible-name walk already makes.
	const deepText = (node) => {
		if (!node) return '';
		//A shadow root's own <style> is not text the reader sees.
		if (node.nodeType === 1 && node.localName === 'style') return '';
		let text = '';
		for (const child of node.childNodes || []) {
			if (child.nodeType === 3) text += child.textContent;
			else text += deepText(child);
		}
		if (node.shadowRoot) text += deepText(node.shadowRoot);
		return text;
	};

	const rowText = (button) => deepText(button).replace(/\s+/g, ' ').trim();

	const suggestionLabels = () => suggestionRows().map(rowText);

	const highlightedRow = () =>
		dialog.shadowRoot.querySelector('[role="option"][data-highlighted]');

	//The palette's own sentence, read the same way.
	const sentenceText = () =>
		deepText(dialog.shadowRoot.querySelector('.sentence')).replace(/\s+/g, ' ').trim();

	//The pills of the draft sentence, as the chips they are.
	const sentencePills = () => {
		const sentence = dialog.shadowRoot.querySelector('collection-sentence');
		if (!sentence) return [];
		return Array.from(sentence.shadowRoot.querySelectorAll('tag-chip'));
	};

	const pillLabels = () => sentencePills().map((chip) => deepText(chip).replace(/\s+/g, ' ').trim());

	//The idle Refine list names its rows by the clause they would become, so
	//adding one is "click the row that says Starred".
	const addRefineRow = async (label) => {
		const row = suggestionRows().find((button) => rowText(button).includes(label));
		assert.ok(row, `no row labelled ${label}`);
		row.click();
		await settleRender(dialog);
	};

	//SUPERSEDED CONTRACT (D1). "Browse all filters" was a link that seeded the
	//one list with the vocabulary; the owner's round-2 model puts the whole
	//vocabulary in the list to begin with ("don't hide the full set of filters —
	//it shows the power"), so the link and the feed behind it are deleted.
	//
	//The state those tests were reaching for — every family in the list, ranked,
	//with no draft-specific filtering — is now simply the IDLE state, so the
	//helper survives with the same NAME and a new body: it clears the input.
	//Keeping the name is deliberate; each call site below still reads as "look
	//at the whole vocabulary", and the diff shows the contract change in exactly
	//one place instead of forty.
	//A ROW FOR ONE FILTER FAMILY. The old Browse-all feed labelled a family row
	//with the bare family name; the vocabulary feed labels it with the clause it
	//would insert — the family spelled with its own defaults — because that is
	//what the row actually adds, and the row has to be able to carry a count.
	//Both are "the row for this family", so the tests ask for it that way.
	const familyRow = (family) => suggestionRows()
		.find((button) => (button.dataset.filter || '').split('/')[0] === family);

	//THE DOM IS WINDOWED; THE LIST IS NOT. The palette renders the first ~60
	//rows and grows on scroll, which is what keeps a several-hundred-row idle
	//list inside one frame. A test that wants to look at ALL of it asks for all
	//of it — the ranking, the ids and the counts are over every row either way.
	const showAllRows = async () => {
		await settleRender(dialog);
		for (let attempt = 0; attempt < 10; attempt++) {
			if (dialog._renderedRowLimit >= dialog._paletteRows.length) break;
			dialog._renderedRowLimit = dialog._paletteRows.length;
			await settleRender(dialog);
		}
	};

	const browseAll = () => ({
		click: () => {
			dialog._composerInput = '';
			dialog._wordScope = '';
			dialog._highlightedRow = 0;
			dialog._rowHighlightActive = false;
			//The window the DOM renders is a scroll position in disguise; a test
			//that asks to see the whole vocabulary is asking to see all of it.
			dialog._renderedRowLimit = Number.MAX_SAFE_INTEGER;
		},
	});

	const pillRow = () => dialog.shadowRoot.querySelector('collection-pill-row');

	const pillRowText = () => deepText(pillRow()).replace(/\s+/g, ' ').trim();

	const pillRowVerb = (label) => {
		const row = pillRow();
		if (!row) return null;
		return Array.from(row.shadowRoot.querySelectorAll('button.verb'))
			.find((button) => button.textContent.trim() === label) || null;
	};

	//Removal is the ✕ now (owner, F1), so it has no label to be found by.
	const pillRowRemove = () => pillRow()?.shadowRoot.querySelector('button.remove') || null;

	//Type into the composer input the way a user does: the element's value
	//changes and an input event carries it into the component.
	const typeComposer = async (value) => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = value;
		input.dispatchEvent(new window.InputEvent('input', { bubbles: true, composed: true }));
		await settleRender(dialog);
	};

	const pressComposer = async (key, extra = {}) => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...extra }));
		await settleRender(dialog);
	};

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
		//ONE CANCEL IS ENOUGH NOW (round 3, D1). Cancelling used to PRESERVE an
		//un-committed draft for the next open, so this had to fire twice to
		//actually clear it. The draft is discarded whole — "esc/X resets to the
		//previous state" — so the second dispatch has nothing to do.
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

	//SUPERSEDED PIN (owner, F3). It was 'exposes the whole collection expression
	//from the truncated summary', and it asserted the drawer summary's tooltip,
	//its accessible name and the focus-unfold that made a two-line clamp
	//readable. There is no summary: the owner asked for the whole always-visible
	//block to go ("the configure collection visible always at the top of the
	//card drawer is weird / bad styling and I want to remove it"), so there is
	//nothing truncated and nothing to unfold.
	//
	//What replaces it is the pin for the ABSENCE, and for the two entry points
	//that survive it, which is the shape the owner named: Ctrl-K, and the
	//Configure collection item in the drawer's collapsible info panel.
	it('offers the composer from the zippy menu and the shortcut, and nowhere else in the drawer', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');

		//THE BLOCK IS GONE, not merely hidden.
		assert.ok(!/collection-summary/.test(source),
			'no summary block, no summary styles, nothing left to grow back');
		assert.ok(!/copy-collection-link|COPY_ALL_ICON|_handleCopyCollectionLink/.test(source),
			'and its copy-link glyph goes with it — the drawer had none before #498');

		//THE ORIGINAL ENTRY POINT, in the original place. Verbatim what
		//752722bd:src/components/card-view.ts renders inside slot='info'.
		assert.match(source, /<div slot='info'>/,
			'the collapsible info panel is still where the drawer keeps its actions');
		assert.match(
			source,
			/<button id='configure-collection' class='small' title='Configure collection' @click=\$\{this\._handleConfigureCollectionClicked\}>\$\{RULE_ICON\}<\/button><label for='configure-collection'>Configure collection<\/label>/,
			'Configure collection is the zippy item it has always been');
		const info = source.slice(source.indexOf('<div slot=\'info\'>'), source.indexOf('<div slot=\'visible-info\'>'));
		assert.match(info, /word-cloud/, 'alongside the word cloud, as before');

		//AND THE SHORTCUT IS UNTOUCHED.
		assert.match(source, /open-collection-composer/,
			'Ctrl-K still opens the composer from this view');

		//The centre empty state is a DIFFERENT surface and stays: it is the only
		//offer left when the drawer has collapsed to nothing.
		assert.match(source, /No cards match this collection/);
		assert.match(source, /class='text collection-empty-refine'/);
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

	//A REFINE ROW IS NAMED BY THE CLAUSE IT WOULD BECOME, not by a verb in front
	//of it: the section heading carries the grammar now, and the verb chips are
	//deleted. Choosing it still only touches the draft.
	it('clicking a Refine row updates only the draft', async () => {
		const starred = suggestionRows().find((button) => rowText(button).includes('Starred'));
		assert.ok(starred);
		assert.ok(!rowText(starred).startsWith('Add '), 'no verb in front of the clause');
		const beforePath = window.location.pathname;
		starred.click();
		await settleRender(dialog);
		const state = store.getState();
		assert.deepStrictEqual(state.collection.snapshot.filterNames, ['starred']);
		assert.deepStrictEqual(state.collection.active.filterNames, []);
		assert.strictEqual(window.location.pathname, beforePath);
		assert.match(sentenceText(), /Starred/, 'and the clause appears in the sentence');
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
		await settleRender(dialog);
		const suggestion = suggestionRows().find((button) => rowText(button).includes('Inductively Knowable'));
		assert.ok(suggestion);
		//This used to assert the raw URL spelling was VISIBLE in the row, as proof
		//the suggestion carried the exact filter. That is the HS-1.4 violation
		//itself; the assertion below — that clicking it applies exactly
		//"inductively-knowable" — proves the same thing without a raw key on
		//screen, so the row is now checked for its ABSENCE.
		assert.ok(!rowText(suggestion).includes('inductively-knowable'),
			'a filter\'s URL spelling must not reach the user');
		suggestion.click();
		await settleRender(dialog);
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
		const labels = suggestionRows().slice(0, 3).map(rowText);
		//One clause, one name: the row says exactly what the pill it produces
		//will say, and nothing else — no verb chip and no verb in the string.
		//The active-card row leads, because it is the one row about where the
		//user is.
		assert.match(labels[0], /This card and directly connected cards/);
		assert.match(labels[1], /Tagged Systems/);
		assert.match(labels[2], /Section Half Baked/);
		assert.ok(labels.every((label) => !/^(Add|Open|Remove|Replace) /.test(label)),
			'the verbs live in the section heading, not on every row');
	});

	//A ROW COUNT IS A PREDICTION, AND IT IS WRITTEN AS THE TRANSITION IT
	//PREDICTS: `current → would-be`. The delta phrasing it replaces said the
	//same thing in words a reader had to do the arithmetic backwards from.
	it('explains preview counts as current → would-be, without changing row order', async () => {
		const before = suggestionRows().map((button) => button.id);
		dialog._previewCounts = {
			'current-draft-preview': 12,
			'add:starred': 5,
			'add:unread': 19,
		};
		await dialog.updateComplete;
		const after = suggestionRows();
		assert.deepStrictEqual(after.map((button) => button.id), before);
		assert.match(rowText(after.find((button) => rowText(button).includes('Starred'))), /12 cards → 5 cards/);
		assert.match(rowText(after.find((button) => rowText(button).includes('Unread'))), /12 cards → 19 cards/);
		//The draft's own count is a readout BESIDE the primary now, not inside
		//its label: HS-3.3 makes that button a round glyph, so it has no label
		//to put a number in. The primary is asserted separately, and what it
		//asserts is that it stayed a glyph with a stable name.
		//'Matches 12 cards', not '12 cards' (owner, round 8: "I'd expect to see
		//something like 'matches nn cards'"). Spelled once, in _openActionRender.
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim(), 'Matches 12 cards');
		const primary = dialog.shadowRoot.querySelector('.composer-actions .primary');
		assert.ok(primary.classList.contains('round'), 'the committing action is a round primary (HS-3.3)');
		//SUPERSEDED (round 9). The name used to be the bare 'Open this
		//collection'; the owner: "the commit buttons should have the keyboard
		//shortcut printed in the title". Title AND aria-label, because a round
		//glyph's accessible name is the only name it has, and both are derived
		//from SHORTCUT_COMBOS rather than spelled.
		assert.strictEqual(primary.getAttribute('aria-label'), openActionName());
		assert.strictEqual(primary.getAttribute('title'), openActionName());
		assert.match(primary.getAttribute('title'), /\((Cmd|Ctrl)-Enter\)$/,
			'and the printed combo is the commit chord, in the table’s own notation');
		assert.strictEqual(primary.textContent.trim(), '', 'a round primary carries a glyph, not a label');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'star';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim(), '');
	});

	//Tab in the empty state used to do nothing at all: it was gated on the input
	//having text, so the keyboard could not reach a list of destinations without
	//first typing something to make them go away.
	it('Tab reaches the empty-state list, then materializes the row it landed on', async () => {
		assert.strictEqual(highlightedRow(), null);
		await pressComposer('Tab');
		assert.strictEqual(highlightedRow().id, 'collection-palette-row-0',
			'the first Tab makes the list keyboard-enterable without typing');
		assert.match(rowText(highlightedRow()), /Starred/);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [],
			'and changes nothing on its own');
		await pressComposer('Tab');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'the second Tab executes that row against the draft');
		assert.strictEqual(window.location.pathname, '/c/main/');
		//SUPERSEDED PIN (round 3, D1). This used to end by reading the draft
		//receipt strip ('Added Starred'). The strip is deleted: the owner's
		//constitution makes the draft a preview of a collection nobody has
		//opened, so a receipt reporting each edit reports something that has not
		//happened. The sentence above the input is the record, and it is a live
		//one.
		assert.deepStrictEqual(sentencePills().map(pill => deepText(pill).trim()), ['Starred'],
			'the sentence is the record: the clause is in it');
		assert.strictEqual(dialog.shadowRoot.querySelector('.draft-receipt'), null,
			'and there is no receipt strip narrating it');
	});

	//SUPERSEDED PIN (round 3, D1/D3). This used to be 'Tab on a destination
	//copies its expression into the draft, and says so' — the spec's labeled
	//SECONDARY action, the primary being Enter, which navigated. The owner's
	//constitution deletes the distinction: "the top action can be … a
	//combinatorial row that does several at once", and "Navigation is only ever
	//Cmd-Enter/primary". So executing a recent is not a secondary anything; it is
	//what the row does, by Enter and by Tab and by click alike.
	it('executing a recent replaces the draft rather than navigating to it', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		await pressComposer('Tab');
		//A RECENT IS A MINIATURE SENTENCE, rendered by the same component the
		//palette's own sentence uses — so it reads with quiet interpuncts rather
		//than the capital AND the drawer's own plain-text summary says.
		assert.match(rowText(highlightedRow()), /Main · Starred/);
		//SUPERSEDED (owner, F4): this asserted the footer's one-contract line
		//here too. There is no footer line — see 'renders no key-hints line, in
		//any state'.
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(store.getState().collection.snapshot.sortName, 'recent');
		assert.strictEqual(window.location.pathname, '/c/main/',
			'Enter on a recent does not navigate; only the commit does');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'and the composer is still open, with the replaced draft in front of you');
	});

	//A RECENTS ROW STOPS SAYING 'recent' TWICE (owner, F1).
	//
	//The miniature sentence printed its order tail like the draft sentence does,
	//and the row's annotation slot says what KIND of row it is — which for a
	//remembered collection is the word 'recent'. Most of the owner's collections
	//carry `sort/recent`, so the row read `Main · Starred · sorted by recent
	//recent`: two unrelated meanings of one word, adjacent, in near-identical
	//type. Both halves of the fix are pinned here because either alone leaves it
	//half-broken.
	//
	//(a) A DESTINATION SUMMARY OMITS AN ORDER NOBODY CHOSE. Nothing is hidden —
	//the row's detail line still spells the whole diff, 'Sorts by Recent'
	//included — and an order that IS a choice survives, which is the second case
	//below.
	//(b) THE ANNOTATION READS AS METADATA. It was the same colour and, once the
	//.subtle scale is applied, the same size as the tail beside it. It takes the
	//smallest metadata size and an italic of its own now, so it reads as a note
	//about the row rather than as the row's last words.
	it('does not say “recent” twice on a recents row', async () => {
		await seedRecents([['main/starred/sort/recent/', 2], ['main/starred/sort/stars/', 1]]);
		await settleRender(dialog);
		const recentRow = () => suggestionRows()
			.find((button) => (button.dataset.rowId || '') === 'recent:main/starred/sort/recent/');
		assert.ok(recentRow(), 'the seeded recent is on the list');
		const sentence = recentRow().querySelector('collection-sentence');
		const sentenceText = sentence.shadowRoot.textContent.replace(/\s+/g, ' ').trim();
		assert.match(sentenceText, /Main/, 'the summary still names the collection');
		assert.ok(!/sorted by recent/.test(sentenceText),
			'and it does not restate an order nobody chose');
		assert.strictEqual(recentRow().dataset.annotation, 'recent',
			'the row still says what kind of row it is');
		assert.match(recentRow().getAttribute('aria-label'), /Sorts by Recent/,
			'and the whole truth is still on the detail line, which is where it always was');

		//AN ORDER THAT IS A CHOICE SURVIVES. `sort/stars` is the point of the
		//destination that carries it, so the summary says so.
		const starsRow = suggestionRows()
			.find((button) => (button.dataset.rowId || '') === 'recent:main/starred/sort/stars/');
		assert.ok(starsRow, 'the second seeded recent is on the list');
		assert.match(
			starsRow.querySelector('collection-sentence').shadowRoot.textContent.replace(/\s+/g, ' '),
			/sorted by stars/,
			'a chosen order is not a default and is stated');

		//(b), read off the stylesheet rather than off a computed style, because
		//jsdom does not cascade a shadow stylesheet onto the light-DOM text.
		const styles = Array.from(dialog.constructor.styles || [])
			.map((sheet) => String(sheet.cssText || sheet)).join('\n');
		const rule = styles.match(/\.row-annotation\s*\{[^}]*\}/)[0];
		assert.match(rule, /font-style:\s*italic/,
			'the annotation is a note about the row, not more of the sentence');
		assert.match(rule, /font-size:\s*0\.7em/, '§4.3\'s smallest-metadata size');
		assert.ok(!/text-transform/.test(rule),
			'and NOT by reintroducing the ALL-CAPS register this dialog deleted');
	});

	//THE LIST SETTLES ONCE, AT BUILD TIME (owner, F2).
	//
	//SUPERSEDED PIN: this was 'ranks empty rows down when the list is built, and
	//never once it is focused'. It set counts on an already-built list, asserted
	//that the zero-count row SANK immediately, and only then — with a row
	//highlighted — asserted that further counts moved nothing. That freeze was
	//real but narrow: it protected the KEYBOARD, and the owner was not using the
	//keyboard. "When you hit enter and it's empty search, the tags at the bottom
	//keep changing for a few seconds before settling."
	//
	//They were. Five rules read counts to decide the list, every count arrives on
	//its own worker round trip, and each arrival re-ran all five. So the rule is
	//now the frozen-order one whole: a list's order is fixed when it is BUILT,
	//from the counts retained at that instant, and a count arriving afterwards
	//fills in a NUMBER without moving anything. A re-rank waits for the next
	//build — a keystroke, a draft edit, an open.
	it('freezes the list’s order at build time, and lets late counts fill in numbers only', async () => {
		const order = () => suggestionRows().map((button) => button.dataset.rowId);
		const indexOf = (text) => suggestionLabels().findIndex((label) => label.includes(text));
		const countText = (rowID) => {
			const row = suggestionRows().find((button) => button.dataset.rowId === rowID);
			return row ? (row.querySelector('.row-count')?.textContent || '').trim() : null;
		};
		assert.strictEqual(indexOf('Starred'), 0);
		const built = order();
		assert.ok(built.includes('add:starred') && built.includes('add:unread'),
			`the idle list offers both rows: ${built.slice(0, 6).join(' | ')}`);

		//A COUNT ARRIVES — the exact event the owner watched — and it lands as a
		//number without moving a row. Nothing here is focused, arrowed or
		//hovered: this is the idle list, settling.
		dialog._previewCounts = { 'current-draft-preview': 12, 'add:starred': 0, 'add:unread': 5 };
		await settleRender(dialog);
		assert.deepStrictEqual(order(), built,
			'the idle list does not reshuffle as counts arrive');
		assert.match(countText('add:unread') || '', /5 cards/,
			'and the number the count carried is on the row, in place');
		assert.match(countText('add:starred') || '', /0 cards/,
			'including the honest zero, which is the warning and is not hidden');

		//NOR DOES A SECOND WAVE, however it contradicts the first.
		dialog._previewCounts = { ...dialog._previewCounts, 'add:unread': 0, 'add:starred': 9 };
		await settleRender(dialog);
		assert.deepStrictEqual(order(), built, 'nor does a second wave of them');

		//AND THE FREEZE IS NOT A REFUSAL TO RANK. The zero-sink is unchanged; it
		//simply reads the counts the build had. Retain them — by COLLECTION, the
		//key the ranking rules ask in — then build, which is what any keystroke
		//does, and the empty row goes down.
		const rowFor = (id) => dialog._paletteRows.find((row) => row.id === id);
		dialog._retainedPreviewCounts.set(dialog._previewCountKey(dialog._collectionDescription), 12);
		dialog._retainedPreviewCounts.set(dialog._previewCountKey(rowFor('add:starred').description), 0);
		dialog._retainedPreviewCounts.set(dialog._previewCountKey(rowFor('add:unread').description), 5);
		await typeComposer('starr');
		await typeComposer('');
		const starred = indexOf('Starred');
		assert.ok(indexOf('Unread') >= 0, 'the row that yields cards is still offered');
		assert.notStrictEqual(starred, 0,
			`a row that yields no cards must not lead, once the build knows: ${suggestionLabels().slice(0, 5).join(' | ')}`);
		//Below the row that yields cards, or suppressed outright if it was an
		//unsolicited contextual offer — the two count-driven rules, both now
		//reading the build's own snapshot.
		assert.ok(starred < 0 || starred > indexOf('Unread'),
			`and it sits below one that does: ${suggestionLabels().slice(0, 5).join(' | ')}`);

		//AND THE OLD KEYBOARD GUARANTEE IS STRICTLY INSIDE THE NEW ONE.
		const rankedOrder = order();
		await pressComposer('ArrowDown');
		const highlighted = highlightedRow().dataset.rowId;
		dialog._previewCounts = { ...dialog._previewCounts, 'add:unread': 0, 'add:starred': 9 };
		await settleRender(dialog);
		assert.deepStrictEqual(order(), rankedOrder,
			'the focused list does not reorder when late counts arrive');
		assert.strictEqual(highlightedRow().dataset.rowId, highlighted,
			'and the row the user is pointing at is still the same row');
	});

	//THE BUILD KEY IS WHAT A BUILD IS (owner, F2). Stated directly, because the
	//whole freeze rests on it: the things that change what the list is ASKED for
	//are builds, and the things that change what it SAYS are not.
	it('rebuilds on what was asked, and not on what came back', async () => {
		const key = () => dialog._paletteBuildKey;
		const opened = key();

		//A count is not a build, however many arrive.
		dialog._retainedPreviewCounts.set(dialog._previewCountKey(dialog._collectionDescription), 41);
		dialog._previewCounts = { ...dialog._previewCounts, 'add:starred': 0 };
		await settleRender(dialog);
		assert.strictEqual(key(), opened, 'a count changes what a row says, not what the list was asked');

		//Neither is scrolling further into the vocabulary, nor the highlight.
		dialog._renderedRowLimit += 20;
		await pressComposer('ArrowDown');
		await settleRender(dialog);
		assert.strictEqual(key(), opened, 'nor the render window, nor the highlight');

		//The typed token is.
		await typeComposer('star');
		assert.notStrictEqual(key(), opened, 'the typed token is a build');
		await typeComposer('');
		assert.strictEqual(key(), opened, 'and clearing it is another');

		//So is the draft.
		await seedDraft('everything/starred/');
		assert.notStrictEqual(key(), opened, 'and so is the draft');
	});

	it('opens the edited draft only from the explicit primary action', async () => {
		suggestionRows().find((button) => rowText(button).includes('Starred')).click();
		await settleRender(dialog);
		const primary = dialog.shadowRoot.querySelector('.composer-actions button.round.primary');
		primary.click();
		await dialog.updateComplete;
		assert.match(window.location.pathname, /starred/);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.strictEqual(store.getState().collection.snapshot, null);
	});

	//THE KEY CONTRACT, WHOLE (round 3, D1). This test used to be 'keeps the
	//selected card when Enter adds and opens a suggestion': Enter both added the
	//clause AND navigated, in one keystroke. The owner's constitution splits
	//them — "ENTER EXECUTES THE TOP ACTION … Not live-changing the real
	//collection until you commit with Cmd-Enter" — so Enter now applies the
	//action to the draft, clears the input and leaves the composer open, and the
	//commit modifier is what opens. The selected card survives both halves.
	it('Enter executes the top action on the draft; Cmd-Enter is what opens', async () => {
		dialog._draftSelectedCard = 'card-123';
		await typeComposer('star');
		//A COMPLETION RENDERS AS THE PILL IT WOULD BECOME, so its words live in
		//the sentence renderer's own shadow root one level down.
		assert.match(rowText(highlightedRow()), /Starred/);
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'the top action landed on the draft');
		assert.strictEqual(dialog._composerInput, '', 'and the input is cleared for the next one');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'the dialog stays open');
		assert.strictEqual(window.location.pathname, '/c/main/', 'nothing real has changed yet');
		assert.strictEqual(
			dialog.shadowRoot.activeElement && dialog.shadowRoot.activeElement.id,
			'collection-composer-input',
			'and focus stays in the input');
		await pressComposer('Enter', { metaKey: true });
		assert.strictEqual(window.location.pathname, '/c/everything/starred/card-123');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
	});

	//ENTER NEVER COMMITS (round-3 tightness, B1).
	//
	//SUPERSEDED PIN. This was 'commits on an Enter with an empty input and
	//nothing highlighted', and it pinned "type, enter, type, enter, enter" as a
	//flow that ends naturally in a commit. The tightness critique pressed exactly
	//that sequence and found what it costs: an Enter that adds a clause CLEARS
	//the input and leaves nothing highlighted, so the DOUBLE-ENTER anybody types
	//when they mean "add that, now let me type the next one" was a navigation out
	//of the composer. One key meant both "act on the draft" and "leave", a
	//keystroke apart, and which one you got depended on a highlight that is
	//invisible when the box is empty.
	//
	//The constitution gives navigation two gestures and neither of them is Enter.
	//So the second Enter is a NO-OP that keeps focus, and the commit is the
	//modifier the footer has been naming all along.
	it('does nothing on an Enter with an empty input, and never commits', async () => {
		await typeComposer('star');
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		await pressComposer('Enter');
		assert.strictEqual(window.location.pathname, '/c/main/',
			'the second Enter changed nothing real');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'and it did not leave the composer');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'and it did not touch the draft either');
		assert.strictEqual(
			dialog.shadowRoot.activeElement && dialog.shadowRoot.activeElement.id,
			'collection-composer-input',
			'focus stays in the input, where the next character goes');
		//NOTHING IS RE-ARMED. An empty input's list is the idle list, whose top
		//row is whatever the ranking put there; arming it would make the NEXT
		//Enter execute a row the user never aimed at.
		assert.strictEqual(dialog._rowHighlightActive, false);
		//And the commit is still one modifier away.
		await pressComposer('Enter', { metaKey: true });
		assert.strictEqual(window.location.pathname, '/c/everything/starred/');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
	});

	//The state every user is in after their first Tab. The Enter test above types
	//"star" first, so the row that happens to be highlighted is also the row the
	//user wanted; that coincidence hid a flow where Ctrl-K → type → Tab → Enter
	//closed the dialog, left the URL alone, and discarded the clause in silence.
	//
	//TWO SUPERSESSIONS, both from the round-3 tightness pass:
	//
	//  M5. The top row after typing 'star' used to be the REMEMBERED starred
	//      collection — "recents rank first among equals". A recent is a whole
	//      other collection replacing the draft, and no token is a request to
	//      leave the one being composed, so a destination may not lead a typed
	//      list. The clause the user typed leads; the recent is still offered,
	//      below every literal reading of the token.
	//  B1. The Enter at the end used to commit. It does nothing now, and the
	//      commit modifier is what opens.
	it('executes the typed clause on Tab, and commits only on the modifier', async () => {
		await seedRecents([['main/', 9], ['main/starred/sort/recent/', 2]]);
		assert.strictEqual(highlightedRow(), null,
			'nothing is highlighted before the user points at a row, so no row looks primary');
		await typeComposer('star');
		assert.match(rowText(highlightedRow()), /Starred/,
			'typing makes the list interpretations of what was typed, and the top one is highlighted');
		assert.strictEqual(dialog._paletteRows[0].kind !== 'destination', true,
			`a destination may not be the top action for a typed token: ${dialog._paletteRows.slice(0, 3).map(row => `${row.kind}/${row.id}`).join(' | ')}`);
		await pressComposer('Tab');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(store.getState().collection.snapshot.sortName, 'default',
			'the clause landed on the draft; the recent that would have replaced it whole did not');
		assert.strictEqual(highlightedRow(), null,
			'Tab rebuilt the list, and nothing in the new list is what the user was pointing at');
		await pressComposer('Enter');
		assert.strictEqual(window.location.pathname, '/c/main/',
			'an Enter with nothing highlighted is not a commit');
		//THE STICKY STARTING SET (D4, and M6's single-sourcing of it). A
		//composition that begins at the app's own bare default view (`/c/main/`,
		//no conditions) starts from the user's sticky set, and the shipped default
		//for that is Everything — composing from `main` silently narrowed every
		//subsequent clause to the published sections before anybody had typed
		//anything. It is applied when the composer OPENS now, so the sentence has
		//said `Everything` from the first frame and this path is what it promised.
		await pressComposer('Enter', { metaKey: true });
		assert.strictEqual(window.location.pathname, '/c/everything/starred/',
			'the commit opens the draft the user composed');
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
		await settleRender(dialog);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		//THE COMMIT IS THE MODIFIER (round-3 tightness, B1).
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/everything/starred/');

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
		await settleRender(dialog);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await dialog.updateComplete;
		//THE COMMIT IS THE MODIFIER (round-3 tightness, B1). This used to be a
		//plain Enter, on the contract that an Enter with nothing highlighted
		//commits. It does nothing now; navigation is Cmd-Enter and the primary.
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		await bar.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/everything/starred/');
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

	//SUPERSEDED PIN (round-3 tightness, B1). This was 'Enter on an untouched draft
	//closes the composer without navigating' — an Enter into an empty composer
	//committed a draft equivalent to the collection on screen, which closed the
	//dialog and went nowhere. Enter never commits now. The property worth keeping
	//is the one underneath: the FIRST keystroke into a composer nobody has typed
	//into changes nothing at all, in the URL or in the draft.
	it('Enter on an untouched draft leaves the composer exactly as it found it', async () => {
		await seedRecents([['main/starred/', 4]]);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'nothing was aimed at, so nothing happened');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		//And the modifier still closes it, on the collection the sentence has been
		//showing since it opened (M6's seeded starting set).
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.strictEqual(store.getState().collection.snapshot, null);
	});

	it('only an explicit Arrow key makes a row the Enter target', async () => {
		await seedRecents([['main/starred/', 4]]);
		await pressComposer('ArrowDown');
		//Arrowing into a list with nothing highlighted lands on the first row
		//rather than skipping one.
		assert.strictEqual(highlightedRow().id, 'collection-palette-row-0');
		//SUPERSEDED PIN (round-3 tightness, M6). The seeded recent (`main/starred/`)
		//and the Starred refinement used to resolve to the IDENTICAL collection,
		//so the idle list's edit-keyed dedupe kept one of them. The draft is
		//seeded from the sticky starting set when the composer opens now, so the
		//refinement produces `everything/starred/` and the recent is genuinely a
		//different collection — two rows for two collections, which is what the
		//dedupe was always for. The property it protected is unchanged and is
		//asserted directly: no collection is offered twice.
		assert.match(rowText(highlightedRow()), /Starred/);
		//The two rows name two different collections now, which is why both are
		//offered; the dedupe still fires when they name one.
		assert.deepStrictEqual(
			dialog._paletteRows.filter((row) => row.description.serialize() === 'everything/starred/').length,
			1,
			'and the collection the refinement produces is still offered exactly once');
		//A DESTINATION MAY LEAD THE IDLE LIST — that is what an idle list is for
		//(M5 forbids it only as the answer to a typed token). So row 0 here is the
		//remembered collection, and Enter replaces the draft with it whole.
		const arrowed = dialog._paletteRows[0];
		assert.strictEqual(arrowed.kind, 'destination');
		await pressComposer('Enter');
		//SUPERSEDED PIN (round 3, D1). Enter on the arrowed row used to NAVIGATE
		//to it; it now executes it against the draft, and the commit modifier is
		//what opens. What the test is actually about is unchanged and is the
		//reason it survives: only an explicit Arrow (or typing) makes a row the
		//Enter target at all.
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(store.getState().collection.snapshot.setName, 'main',
			'the recent replaced the draft whole, its own set included');
		assert.strictEqual(window.location.pathname, '/c/main/');
		await pressComposer('Enter', { ctrlKey: true });
		assert.strictEqual(window.location.pathname, '/c/starred/',
			'and the commit opens exactly the collection the row promised');
	});

	//Recents are destinations, and the collection you are already standing in is
	//not one: replacing the draft with it changes nothing.
	it('never offers the collection already on screen as a recent destination', async () => {
		await seedRecents([['main/', 9], ['main/starred/sort/recent/', 2]]);
		//A recent renders as the miniature sentence it is, so it reads with the
		//quiet interpunct rather than a verb in front of it.
		const recentRows = () => suggestionLabels();
		assert.ok(recentRows().some((label) => label.includes('Main · Starred')),
			'an unrelated recent is still offered');
		assert.ok(!recentRows().some((label) => /^Main$/.test(label)),
			'the active collection is not offered even before the draft diverges');
		await typeComposer('star');
		await pressComposer('Tab');
		//Now the draft is Main · Starred, so deduping against the draft alone
		//would let the collection on screen reappear.
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.ok(!recentRows().some((label) => /^Main$/.test(label)),
			'the active collection stays suppressed once the draft diverges from it');
	});

	//THE "REMOVE X" ROW IS DELETED — `without this pill: N` in the pill row
	//answers its question, beside the clause it is about. So the destination that
	//is already open is reached the way a user actually reaches one: through a
	//SUPERSEDED PIN (round 3, D1). This was 'says so, in the dialog, when a
	//chosen destination is already open': choosing a recent NAVIGATED, so a
	//recent naming the collection already on screen navigated nowhere and the
	//dialog had to explain the silence. Nothing in the list navigates now —
	//"Navigation is only ever Cmd-Enter/primary" — so the state that needed
	//explaining cannot arise from a row. The ALREADY_ACTIVE guard itself survives
	//untouched on the one path that can still reach it, the commit; its pin is
	//'closes silently when Source names the collection already open, in any
	//spelling', further down this file.
	//
	//What replaces it is the property the round-3 model puts in its place: a
	//recent that happens to name the collection on screen is an ordinary
	//combinatorial action, and executing it simply makes the draft that
	//collection.
	it('makes the draft a recent collection without navigating, even when it is the one on screen', async () => {
		await seedRecents([['main/', 9]]);
		await typeComposer('star');
		await pressComposer('Enter');
		dialog._activeCollectionDescription = null;
		await typeComposer('main');
		const already = suggestionRows().find((button) => (button.dataset.rowId || '').startsWith('recent:'));
		assert.ok(already, 'the collection on screen is reachable as a typed recent');
		already.click();
		await settleRender(dialog);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'the composer stays open');
		assert.strictEqual(dialog.shadowRoot.querySelector('.activation-message'), null,
			'and has nothing to explain, because nothing tried to navigate');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [],
			'the draft became the recent, which is what executing a combinatorial row means');
		assert.strictEqual(window.location.pathname, '/c/main/');
	});

	//mouseenter fires whenever rows shift under a resting cursor, so a re-render
	//used to hand whatever row landed under the pointer the power to decide what
	//Enter does.
	it('a re-render under a resting cursor does not take the highlight', async () => {
		await seedRecents([['everything/', 5], ['main/sort/recent/', 4], ['reading-list/', 3]]);
		const rows = suggestionRows();
		assert.ok(rows.length > 3, `the list needs four rows to point at, got ${rows.length}`);
		rows[3].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow(), null,
			'mouseenter without a mousemove is not evidence the pointer moved');
		await pressComposer('ArrowDown');
		assert.strictEqual(highlightedRow().id, 'collection-palette-row-0');
		suggestionRows()[3].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-palette-row-0',
			'the keyboard keeps the highlight across a re-render the user did not point at');
		//Genuine hovering still works.
		suggestionRows()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-palette-row-3');
		//And once the pointer has proven it moves, mouseenter is honored again.
		suggestionRows()[1].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow().id, 'collection-palette-row-1');
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
		const hover = styles.match(/[^}]*\.palette-row button:hover[^{]*\{[^}]*\}/g) || [];
		assert.ok(hover.length, 'there must be a hover rule to check');
		for (const rule of hover) {
			assert.match(rule, /:host\(\[data-pointer-armed\]\)\s*\.palette-row button:hover/,
				'every hover rule for a row must be gated on the pointer owning the highlight');
		}
		//And the keyboard-owned row gets more than a hover tint: the fill and
		//the bar together.
		assert.match(styles, /\.palette-row button\[data-highlighted\][^{]*\{[^}]*border-left-color:\s*var\(--app-primary-color\)/);

		await seedRecents([['everything/', 5], ['main/sort/recent/', 4], ['reading-list/', 3]]);
		await pressComposer('ArrowDown');
		assert.ok(!dialog.hasAttribute('data-pointer-armed'),
			'a keystroke hands the highlight back to the keyboard, and hover stops painting');
		suggestionRows()[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
		await dialog.updateComplete;
		assert.ok(dialog.hasAttribute('data-pointer-armed'),
			'a real mousemove hands it to the pointer, and hover paints again');
		assert.strictEqual(highlightedRow().id, 'collection-palette-row-2',
			'and the row under the cursor is the highlighted one, so there is still only one');
	});

	//BROWSE ALL IS THE SAME LIST, so it is the same pointer rule — which is the
	//whole point of there being one list. The catalog used to be a second
	//surface with a second highlight index, and keeping those two in step is
	//exactly the kind of duplication the rebuild removed.
	it('moves the browse highlight to the row a moving pointer is over', async () => {
		browseAll().click();
		await settleRender(dialog);
		const rows = suggestionRows();
		assert.ok(rows.length > 2, 'browse all must have rows to check');
		assert.strictEqual(highlightedRow(), null);
		rows[2].dispatchEvent(new MouseEvent('mouseenter'));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow(), null,
			'mouseenter without a mousemove is not evidence the pointer moved, here either');
		rows[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
		await dialog.updateComplete;
		assert.strictEqual(highlightedRow(), suggestionRows()[2],
			'and it is the visibly highlighted one, which is what Enter takes');
	});

	it('Escape cancels the draft without changing the active collection', async () => {
		suggestionRows().find((button) => rowText(button).includes('Starred')).click();
		await settleRender(dialog);
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
		//The catalog is gone; the road to a card-valued clause is Browse all →
		//the family, which lands the clause in the draft with its own defaults
		//and opens its pill row on it.
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('similar');
		familyRow('similar').click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['similar/key-card-id']);
		assert.deepStrictEqual([...dialog._selectedPath], [0], 'the pill row opens on the clause that just landed');

		const keyCard = pillRow().shadowRoot.querySelector('configure-collection-key-card');
		await keyCard.updateComplete;
		keyCard.shadowRoot.querySelector('#choose-card').click();
		await keyCard.updateComplete;
		assert.strictEqual(store.getState().find.open, true);

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog, findDialog);
		assert.strictEqual(store.getState().find.open, false, 'Escape closes the picker');
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
			'and only the picker — the composer is still open');
		assert.deepStrictEqual([...dialog._selectedPath], [0], 'with the layer the user was in intact');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['similar/key-card-id'],
			'and the clause being configured not thrown away');

		//The picker still works after the detour, and the value still lands.
		pillRow().shadowRoot.querySelector('configure-collection-key-card')
			.shadowRoot.querySelector('#choose-card').click();
		await settleRender(dialog, findDialog);
		findDialog._handleThumbnailTapped({ detail: { card: 'card-1' } });
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['similar/card-1']);

		//And with the picker gone, Escape peels the composer's own layers again:
		//the pill row first, then the dialog.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.deepStrictEqual([...dialog._selectedPath], []);
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
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('similar');
		familyRow('similar').click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		const keyCard = pillRow().shadowRoot.querySelector('configure-collection-key-card');
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
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [`similar/${ids[0]}`], 'and the value lands');
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
		suggestionRows().find((button) => rowText(button).includes('Starred')).click();
		await settleRender(dialog);
		store.dispatch({ type: 'TEST_SET_EDITING', value: true });
		const primary = dialog.shadowRoot.querySelector('.composer-actions button.round.primary');
		primary.click();
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(window.location.pathname, '/c/main/');
		assert.match(dialog.shadowRoot.querySelector('.activation-message').textContent, /Finish or cancel/);
	});

	//A CLAUSE IS THE APP'S OWN CHIP NOW, and the chip's ✕ is the remove control —
	//"the most guessable gesture in software", which is why the design reached
	//for it. The boxed clause-cell with its internal divider and its separate
	//Edit button is deleted; selecting the pill is what edits it, and the
	//removing a pill is the pill's own ✕.
	it('renders accepted clauses as removable pills', async () => {
		suggestionRows().find((button) => rowText(button).includes('Starred')).click();
		await settleRender(dialog);
		const chip = sentencePills()[0];
		assert.ok(chip, 'the clause is a pill in the sentence');
		assert.match(deepText(chip), /Starred/);
		assert.strictEqual(chip.getAttribute('aria-label'), 'Starred');
		chip.shadowRoot.querySelector('a.delete').click();
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		//SUPERSEDED PIN (round 3, D1). The removal used to leave a receipt
		//('Removed Starred') with an Undo beside it, and this test pressed it.
		//Both are deleted: "if you make a mistake, esc/X resets to the previous
		//state" — the draft is a preview, so discarding it IS the undo, and a
		//second, weaker one standing beside it gave the user two histories to
		//keep track of instead of none.
		assert.strictEqual(dialog.shadowRoot.querySelector('.draft-receipt'), null);
		assert.ok(!Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.some((button) => button.textContent.includes('Undo')),
		'no in-dialog Undo: Escape is the undo, and it resets the whole draft');
	});

	//THE DRAFT READS AS A SENTENCE, AND THE SENTENCE IS THE APP'S OWN CHIPS.
	//
	//What the boxed clause-cell was replaced BY, pinned: the draft is rendered by
	//collection-sentence — the same component the recents rows and the why-here
	//panel use — so a clause cannot look like a chip in one place and a table
	//cell in another. (The drawer is not one of its hosts: the owner asked for
	//the quiet Configure Collection summary back there.) The
	//remove control is tag-chip's own ✕, the set name is a word at the sentence's
	//weight, and the help badge is a footnote at the end rather than the first
	//thing the sentence says.
	it('renders the draft as a sentence of the app’s own chips', async () => {
		await addRefineRow('Starred');

		const sentence = dialog.shadowRoot.querySelector('collection-sentence');
		assert.ok(sentence, 'one renderer, shared with the recents rows and the why-here panel');
		assert.strictEqual(sentence.interactive, true, 'the palette’s copy is editable');
		//EVERYTHING, not Main: see the sticky-start note above. The point of this
		//assertion is that the SET is the sentence's first word at all, and it
		//still is.
		assert.match(sentenceText(), /Everything/, 'the set is the sentence’s first word');
		assert.match(pillLabels().join(' '), /Starred/);

		//The remove control is the chip's own, and it is an icon rather than a
		//text glyph (§4.2's MUST).
		const remove = sentencePills()[0].shadowRoot.querySelector('a.delete');
		assert.ok(remove, 'every pill offers the ✕');
		assert.ok(remove.querySelector('svg'), 'the remove control is an icon, not a text glyph');
		assert.ok(!remove.textContent.includes('×'), 'the literal × is gone');

		//THE '?' BADGE IS CUT (round-3 tightness, C1). SUPERSEDED: this used to
		//pin the badge to the END of the sentence — a footnote rather than a
		//first element. The obligation it discharged (HOUSE-STYLE §1.3: define
		//the noun) is kept and moved off the surface entirely, onto the dialog
		//title, where hover and every screen reader reach it and nothing on
		//screen has to say it. A visible help affordance is a CONCEPT, on a
		//surface whose whole argument is that it has four of them.
		assert.strictEqual(dialog.shadowRoot.querySelector('.sentence .help'), null,
			'no help glyph rides the sentence');
		const heading = dialog.shadowRoot.querySelector('#dialog-title');
		assert.ok(heading, 'the dialog has its heading');
		assert.match(heading.getAttribute('title') || '', /A collection is a set of cards you can link to\./,
			'the definition is on the title, reachable by hover');
		assert.strictEqual(heading.getAttribute('aria-description'), heading.getAttribute('title'),
			'and read with the heading, so the obligation is kept for a screen reader too');

		//And the old chip-row CSS is gone with the markup: none of the boxed
		//clause-cell rules may survive into the palette's stylesheet.
		const styles = composerStyles();
		for (const dead of ['.expression-clause', '.expression-term', '.expression-set', '.catalog-list', '.anchored-editor', '.pending-filter-editor']) {
			assert.ok(!styles.includes(dead + ' '), `${dead} is deleted, and so is its CSS`);
		}
		//The input is find-dialog's #query treatment: borderless with a bottom
		//rule, full width, continuing the sentence above it.
		assert.match(styles, /\.composer-input\s*\{[^}]*border-bottom:\s*1px solid/);
		assert.match(styles, /\.composer-input\s*\{[^}]*width:\s*100%/);
	});

	//THE PALETTE IS A FIXED BOX (owner, F3).
	//
	//SUPERSEDED PIN: this was 'sizes itself as a light palette, with the width
	//still pinned', and it asserted `max-height: 80vh` over the base rule's
	//content-sizing — the palette holds four things rather than seven, so its
	//height was handed back to its content with a cap.
	//
	//A cap is not a size. The owner: "the dialog changes height as things filter
	//etc, which makes the part you're looking at jump around on screen
	//constantly; it should be fixed size." Every keystroke that filtered the
	//list, every pill row that opened and every count that dropped a row
	//re-measured the box, and .background centres it, so half of each change came
	//off the TOP and moved the sentence the user was reading. That is the width
	//defect, on the other axis, and it takes the width's answer: one value on all
	//three of height/min-height/max-height.
	//
	//JSDOM computes no layout, so what is pinned is the rule that makes the
	//resize impossible. The measured rects are in the live verification.
	it('pins the palette’s box on both axes, so nothing it holds can resize it', () => {
		const styles = composerStyles();
		const content = styles.match(/\.content\s*\{[^}]*--composer-width[^}]*\}/)[0];
		assert.match(content, /--composer-width:\s*min\(44em, 92vw\)/, 'the palette’s own measure');
		assert.match(content, /--composer-height:\s*min\(40em, 80vh\)/,
			'and its own window: ten rows of list at rest, capped so a short viewport still fits it');
		assert.ok(!/\bheight:\s*90%/.test(content), 'the pinned workspace height is gone');
		for (const property of ['width', 'min-width', 'max-width']) {
			assert.match(content, new RegExp(`[;{]\\s*${property}:\\s*var\\(--composer-width\\)`),
				`${property} is pinned so the base rule’s percentages cannot re-enter`);
		}
		for (const property of ['height', 'min-height', 'max-height']) {
			assert.match(content, new RegExp(`[;{]\\s*${property}:\\s*var\\(--composer-height\\)`),
				`${property} is pinned, or the box sizes to its content again and the sentence moves`);
		}
		//A CAP ALONE IS THE DEFECT, so the composer's own rule may not leave one
		//standing. (DialogElement's base .content rule is in the same
		//concatenated sheet and keeps its own 90% cap for every other dialog;
		//this is anchored on the custom property, like the width pin below.)
		assert.ok(!/max-height:\s*(80vh|90%)/.test(content),
			'no bare cap may survive on the composer’s own .content rule');
		//AND THE MOBILE FULL-SCREEN LAYOUT IS UNCHANGED: DialogElement's
		//`.mobile .content` is height:100%, and it only wins if our own MINIMA
		//get out of its way.
		//Anchored on min-width, because DialogElement's own `.mobile .content`
		//rule is in the same concatenated sheet and comes first.
		const mobile = styles.match(/\.mobile \.content\s*\{[^}]*min-width:\s*0[^}]*\}/)[0];
		assert.match(mobile, /min-height:\s*0/, 'a 40em floor must not outlive a phone screen shorter than that');

		//THE LIST IS WHAT FLEXES INSIDE IT. With the box definite, the 40vh cap
		//on the list is not merely unnecessary — it would hold the list short of
		//the region and park the difference as a dead band above the footer.
		const list = styles.match(/\.palette-list,\s*\n\s*\.suggestions\s*\{[^}]*\}/)[0];
		assert.match(list, /flex:\s*1 1 auto/, 'the list is the one payer and the one recipient');
		assert.ok(!/max-height/.test(list), 'and it is no longer capped, because the box cannot grow');
		assert.ok(!/\.mobile \.palette-list,\s*\n\s*\.mobile \.suggestions\s*\{[^}]*max-height:\s*none/.test(styles),
			'so the full-screen exception that used to undo the cap is gone too');
	});

	//AND THE PILL ROW TAKES ITS ROOM FROM THE LIST, NOT FROM THE BOX (owner, F3).
	//
	//It sits between the sentence and the input, so if it could grow the dialog
	//the sentence above it would move — which is the exact jump the fixed height
	//is for. The mechanism is the flex column: every child of the composer's
	//column is `flex: 0 0 auto` except the list, which is `flex: 1 1 auto`, so a
	//new fixed-size sibling is paid for out of the list's height and out of
	//nothing else.
	it('pays for the pill row out of the list, so the box and the sentence stay put', async () => {
		const styles = composerStyles();
		const reserved = styles.match(/\.sentence,[^{]*\{\s*flex:\s*0 0 auto;\s*\}/)[0];
		//('.preview-titles' was the fifth member until round 8 deleted the strip.
		//Its replacement, the matches peek, is deliberately NOT in this rule —
		//see the peek's own test for why it is 0 1 auto rather than 0 0 auto.)
		for (const part of ['.sentence', '.pill-row', '.composer-input', '.mode-links']) {
			assert.ok(reserved.includes(part + ',') || reserved.includes(part + ' '),
				`${part} must reserve its own room: ${reserved}`);
		}
		assert.match(styles, /\.buttons\.composer-actions\s*\{[^}]*flex:\s*0 0 auto/,
			'and so must the footer, or a growing pill row takes the commit button’s pixels');
		//The pill row really does open above the input, which is why this matters.
		await seedDraft('everything/starred/');
		sentencePills()[0].click();
		await settleRender(dialog);
		assert.ok(pillRow(), 'the row is open');
		const order = Array.from(dialog.shadowRoot.querySelectorAll('.sentence, .pill-row, .composer-input, .palette-list'))
			.map((node) => node.classList.contains('sentence') ? 'sentence' :
				node.classList.contains('pill-row') ? 'pill-row' :
					node.classList.contains('composer-input') ? 'input' : 'list');
		assert.deepStrictEqual(order, ['sentence', 'pill-row', 'input', 'list'],
			'the row is between the sentence and the input, and the list is below both');
	});

	//SUPERSEDED PIN (round 3, D1). This was 'gives the draft receipt a container
	//of its own' — a real fix, to a strip that floated between the input and the
	//list in a grey this file had already rejected once for text that has to be
	//read. The strip itself is now deleted, along with the concept: the owner's
	//constitution makes the un-committed draft a preview, and a receipt
	//narrating each edit to a preview reports something that has not happened.
	//What replaces it is asserted here — the composer renders NO such strip, in
	//any state.
	it('narrates no draft edits: the sentence is the record', async () => {
		await addRefineRow('Starred');
		assert.strictEqual(dialog.shadowRoot.querySelector('.draft-receipt'), null);
		assert.doesNotMatch(composerStyles(), /\.draft-receipt\s*\{/,
			'and the rules that painted it are gone too');
		assert.deepStrictEqual(sentencePills().map(pill => deepText(pill).trim()), ['Starred'],
			'the live sentence is what says what the draft is');
	});

	//THE TWO-STEP BACKSPACE SURVIVES THE REBUILD, now expressed against the
	//sentence: the first press SELECTS the last condition — which is what opens
	//its pill row — and only the second removes it.
	it('uses two-step Backspace to select and then remove the last clause', async () => {
		await addRefineRow('Starred');
		await pressComposer('Backspace');
		assert.deepStrictEqual([...dialog._selectedPath], [0], 'the last condition is selected');
		assert.ok(pillRow(), 'and its pill row is what shows the selection');
		assert.ok(sentencePills()[0].hasAttribute('data-selected'), 'the pill says so too');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		await pressComposer('Backspace');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
	});

	it('does not interpret composing keystrokes as clause commands', async () => {
		await addRefineRow('Starred');
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
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.deepStrictEqual([...dialog._selectedPath], []);
	});

	//SUPERSEDED PIN (round 3, D1). This was 'preserves draft Undo while
	//keyboard-selecting a clause': the first Backspace selects rather than
	//removes, and the Undo for the PREVIOUS edit had to survive that. There is no
	//in-dialog Undo any more, so what has to survive the select is the DRAFT
	//itself — which is the half of the old assertion that still means something.
	it('changes nothing when Backspace selects a clause', async () => {
		await addRefineRow('Starred');
		await pressComposer('Backspace');
		assert.ok(!Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.some((button) => button.textContent.includes('Undo')));
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'the first Backspace selects; it does not remove');
	});

	//CLICKING A PILL OPENS ITS ROW, AND ESCAPE PEELS THE ROW BEFORE THE DIALOG.
	//This replaces the "zoom into the builder control" flow: there is no panel to
	//zoom into any more, and no Done editing button to focus — the row is one
	//line under the sentence and Escape closes it.
	it('opens a pill row from the pill, and Escape peels it before the dialog', async () => {
		await addRefineRow('Starred');
		sentencePills()[0].click();
		await settleRender(dialog);
		assert.ok(pillRow(), 'the row opens at the place the clause is');
		assert.match(pillRowText(), /Starred/, 'and it names its scope');
		//A pill with no arguments still has real contents, so a dead Edit
		//affordance is structurally impossible.
		for (const verb of ['Also match…', 'Invert']) {
			assert.ok(pillRowVerb(verb), `every pill offers ${verb}`);
		}
		assert.ok(pillRowRemove(), 'and removal, which is the ✕ rather than a word (owner, F1)');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.strictEqual(pillRow(), null, 'the row is peeled first');
		assert.strictEqual(dialog.shadowRoot.activeElement?.id, 'collection-composer-input');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false,
			'and the next Escape closes the dialog');
	});

	//THE PILL ROW STATES ONE CONSEQUENCE, WITH BOTH ITS SIDES (owner, F2).
	//
	//SUPERSEDED PIN, twice over. It first asserted two separate lines — "draft
	//now matches N" and "without this pill: N" — and the round-3 tightness pass
	//deleted the first on the grounds that the footer already says it. What was
	//left was one number with nothing beside it, which is how the owner came to
	//read `without this pill: 34.4k cards` as the SIZE of the collection rather
	//than as a comparison against it. Both counts are wired to the same preview
	//machinery now and the row spells the transition between them, in the palette
	//list's own `current → after` grammar. The footer keeps its own copy of the
	//draft count: that is not a duplicate readout but the same fact answering a
	//different question, beside the button that acts on it.
	it('wires both sides of the pill row’s consequence to the preview machinery', async () => {
		await addRefineRow('Starred');
		sentencePills()[0].click();
		await settleRender(dialog);
		dialog._previewCounts = {
			'current-draft-preview': 184,
			'without-pill-preview': 1842,
		};
		await settleRender(dialog, pillRow());
		assert.match(pillRowText(), /removing this: 184 cards → 1842 cards/,
			'one phrase, both sides, the list rows’ own grammar');
		assert.match(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent, /184 cards/,
			'and the footer still states the draft beside the button that opens it');
		assert.doesNotMatch(pillRowText(), /without this pill/,
			'the one-sided phrasing, and its rendering vocabulary, are gone');
	});

	//A CLAUSE WITH ARGUMENTS EDITS THEM IN THE ROW, and the edit lands in the
	//draft immediately — the contract the anchored panel used to state in a
	//sentence and now simply keeps.
	it('edits a configurable clause’s value in the pill row', async () => {
		await typeComposer('inductively knowable');
		const querySuggestion = suggestionRows()
			.find((button) => rowText(button).includes('Text contains “inductively knowable”'));
		assert.ok(querySuggestion);
		querySuggestion.click();
		await settleRender(dialog);
		sentencePills()[0].click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		const queryInput = pillRow().shadowRoot.querySelector('.argument input');
		assert.ok(queryInput, 'the argument control is reparented into the row');
		queryInput.value = 'mechanistically knowable';
		queryInput.dispatchEvent(new Event('change', { bubbles: true }));
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['query/mechanistically knowable']);
		assert.ok(pillRow(), 'and the row stays open on the clause that was just edited');
	});

	//Removing the clause the row is open on used to leave an empty grey panel.
	//The row simply has nothing to be about, so it is not rendered.
	it('closes the pill row when the clause it is about is removed', async () => {
		await addRefineRow('Starred');
		sentencePills()[0].click();
		await settleRender(dialog);
		assert.ok(pillRow());
		pillRowRemove().click();
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.strictEqual(pillRow(), null, 'an empty editor must not stay on screen');
	});

	it('keeps the row on the same clause when a different one is removed', async () => {
		await addRefineRow('Starred');
		await addRefineRow('Unread');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred', 'unread']);
		//Open the row on the second clause, then remove the first: the address
		//the row holds has just been renumbered underneath it.
		sentencePills()[1].click();
		await settleRender(dialog);
		assert.match(pillRowText(), /Unread/);
		sentencePills()[0].shadowRoot.querySelector('a.delete').click();
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['unread']);
		//A REMOVAL CHANGES THE SHAPE, so the address means something else now and
		//the row closes rather than silently repointing at a clause nobody chose.
		assert.strictEqual(pillRow(), null,
			'a removal ends the selection rather than re-aiming it');
		assert.match(pillLabels().join(' '), /Unread/);
	});

	//BROWSE ALL IS A FEED OF THE ONE LIST, NOT A PLACE.
	//
	//THE LIST *IS* BROWSE-ALL (D1, superseding the seeded-feed contract).
	//
	//The catalog mode was deleted first — the setup dropdown strip, the category
	//walls with per-row examples, the Not toggles, the "Show N more" caps, the
	//"Already in this collection" line and the second highlight index. What
	//survived was a quiet `Browse all filters` link that seeded this same list
	//with the families under the catalog's category headings.
	//
	//Round 2 deletes the link too: the idle list now contains the whole
	//vocabulary already, ranked by personal likelihood, under ONE heading with a
	//quiet per-row annotation where the category walls used to be. So this test
	//asserts what replaced them — every family present and addable, no walls, no
	//setup strip, no chips.
	it('holds the whole vocabulary in one ranked run, and adds one without opening', async () => {
		dialog._composerCandidates = [{
			filter: 'inductively-knowable',
			category: 'tag',
			label: 'Tagged “Inductively Knowable”',
			detail: 'Keeps cards tagged Inductively Knowable',
			aliases: ['tag', 'inductively knowable'],
		}];
		browseAll().click();
		await settleRender(dialog);
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		assert.strictEqual(input.getAttribute('aria-controls'), 'collection-palette-list',
			'browse all is the SAME list, so the combobox still points at it');
		const headings = Array.from(dialog.shadowRoot.querySelectorAll('.suggestion-heading'))
			.map((heading) => heading.textContent.trim());
		//SUPERSEDED PIN: the catalog's category headings ('Dates', 'Tags and
		//sections') were the wall, and the wall is gone. One heading for the
		//vocabulary; the categories survive as quiet per-row annotations, which
		//is an attribute rather than a structure imposed on the ranking.
		assert.ok(headings.includes('Everything you can add'), `one heading for the vocabulary: ${headings.join(' | ')}`);
		assert.ok(!headings.includes('Dates'), 'the category walls are deleted');
		assert.ok(!headings.includes('Tags and sections'));
		await showAllRows();
		const annotations = suggestionRows()
			.map((button) => button.querySelector('.row-annotation')?.textContent.trim())
			.filter(Boolean);
		assert.ok(annotations.includes('tag'), `a row says what kind of thing it is: ${annotations.join(', ')}`);
		assert.ok(annotations.includes('family'),
			`and so does a family row: ${[...new Set(annotations)].join(', ')}`);
		//EVERY FILTER FAMILY, including the three the palette will not compose:
		//`combine`, `exclude` and `expand` default to placeholders, so they are
		//offered as the honest route into Source rather than as clauses. Before
		//this they lived only in the deleted Browse-all feed, which would have
		//meant deleting them from the product.
		for (const family of ['combine', 'exclude', 'expand']) {
			const row = dialog._paletteRows.find((row) => row.sourceFilter === family);
			assert.ok(row, `the engine's ${family} is still reachable, as Source`);
		}
		//The setup strip is gone: set, sort and view are words in the sentence.
		for (const label of ['Starting collection set', 'Card order', 'Collection view']) {
			assert.strictEqual(dialog.shadowRoot.querySelector(`[aria-label='${label}']`), null,
				`the ${label} dropdown is deleted`);
		}
		//No verb chips, no example lines, no polarity toggles.
		assert.strictEqual(dialog.shadowRoot.querySelector('.catalog-example'), null);
		assert.strictEqual(dialog.shadowRoot.querySelector('.catalog-polarity'), null);
		assert.strictEqual(dialog.shadowRoot.querySelector('.catalog-more'), null);
		//SUPERSEDED PIN: a vocabulary row is a name and a quiet category word,
		//not a name and a sentence. `alwaysDetail` was the old browse feed's one
		//exception to detail-on-highlight, and it existed because a wall of
		//identical-looking family names had no other way to distinguish itself.
		//Three hundred rows each carrying a sentence is a list nobody can scan,
		//so the annotation carries the distinction and the detail line stays on
		//the highlighted row where §2.1 puts it.
		//A filter that no contextual suggestion happens to be offering, so this
		//asserts the VOCABULARY run rather than the Refine run above it.
		const hasImages = suggestionRows().find((button) => button.dataset.filter === 'has-images');
		assert.ok(hasImages, 'every filter in the registry is in the list');
		assert.strictEqual(hasImages.querySelector('.row-detail'), null,
			'an unhighlighted row does not explain itself');
		assert.strictEqual(hasImages.querySelector('.suggestion-action'), null, 'and carries no verb chip');
		hasImages.click();
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['has-images']);
		assert.strictEqual(window.location.pathname, '/c/main/', 'adding does not navigate');
	});

	//THE EXPLICIT-CONFIRM GATE IS DELETED WITH THE PANEL IT GATED. A family
	//chosen by name lands in the draft with its own defaults and opens its pill
	//row on it, so the count beside the sentence is already the count of what was
	//chosen and Undo is one click away. The gate existed because the panel was a
	//six-control wall the draft could not show; a one-line row needs none.
	it('adds a configurable family with its defaults and opens its pill row', async () => {
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('text');
		const query = familyRow('query');
		assert.ok(query, 'the one list still finds a family by its alias');
		query.click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['query/foo']);
		assert.ok(pillRow(), 'and its controls open at the place the clause now is');
		const queryInput = pillRow().shadowRoot.querySelector('.argument input');
		assert.ok(queryInput, 'the argument control is in the row');
		queryInput.value = 'inductively knowable';
		queryInput.dispatchEvent(new Event('change', { bubbles: true }));
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['query/inductively knowable']);
	});

	it('lands focus inside the pill row a family row just opened', async () => {
		//Opening an editor and leaving focus in the field behind it puts the
		//control the user asked for a dozen Tabs away. focusPrimaryControl was
		//always wired; what it lacked was anything to find, because it ran before
		//the row it queries had rendered.
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('text');
		familyRow('query').click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		assert.notStrictEqual(dialog.shadowRoot.activeElement?.id, 'collection-composer-input',
			'focus must not stay in the field behind the row');
		assert.strictEqual(dialog.shadowRoot.activeElement, pillRow());
		assert.strictEqual(pillRow().shadowRoot.activeElement, pillRow().shadowRoot.querySelector('.argument input'));
		//And Escape still peels this layer rather than closing the composer.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
		assert.strictEqual(pillRow(), null);
	});

	//THIS LIST IS WHERE BOOLEANS ARE BORN (proposal B §3.1). One typed token
	//becomes as many rows as it has MEANINGS, each a plain sentence with a
	//number on it — and the user authors `a AND (b OR c) AND NOT d` by choosing
	//between English sentences rather than by meeting the words exclude and
	//combine.
	//THE WHOLE SENTENCE, TYPED, WITH NOTHING BUT KEYS (D6).
	//
	//Every other test in this file exercises one gesture. This one exercises the
	//claim the redesign actually makes — that a person can author a compound
	//collection by typing words and pressing Enter — and it does so with ZERO
	//mouse events, which is the part that cannot be asserted by looking at any
	//single gesture. If a row ever stops being reachable from the keyboard, or
	//the top row ever stops being the one the typed word meant, this is where it
	//shows up as a failing assertion rather than as an owner's complaint.
	//
	//It also walks the round-2 model end to end: a SINGLETON set switch that
	//replaces rather than stacks, a SYNONYM that reaches a family with no name of
	//its own, a NEGATION prefix, an OR fusion between siblings, a deterministic
	//DATE PHRASE, and a SORT — with the whole CollectionDescription asserted at
	//the end.
	it('composes a whole collection from the keyboard alone', async () => {
		//stateChanged recomputes the candidate list from the (empty) corpus on
		//every dispatch, and every accepted row dispatches — so this suite's
		//standing fiction has to be restated after each one, exactly as the
		//contributor test does.
		const seedTags = () => {
			dialog._composerCandidates = TAGS;
		};
		//ESCAPE PEELS ONE LAYER, and with no layer open it closes the dialog —
		//which would end the run rather than continue it. So the pill row is
		//closed only when there IS one, which is also exactly what a user does.
		const closePillRow = async () => {
			if (!pillRow()) return;
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
			await settleRender(dialog);
		};
		const TAGS = [
			{
				filter: 'tag-systems',
				category: 'tag',
				label: 'Tagged “Systems”',
				detail: 'Keeps cards tagged Systems',
				aliases: ['tag-systems', 'Systems', 'tag', 'tagged'],
				searchValues: ['tagged “systems”', 'tag-systems', 'tag', 'systems', 'tagged'],
			},
			{
				filter: 'tag-complexity',
				category: 'tag',
				label: 'Tagged “Complexity”',
				detail: 'Keeps cards tagged Complexity',
				aliases: ['tag-complexity', 'Complexity', 'tag', 'tagged'],
				searchValues: ['tagged “complexity”', 'tag-complexity', 'tag', 'complexity', 'tagged'],
			},
		];
		seedTags();
		await settleRender(dialog);

		//A guard, not a flourish: the whole point is that no pointer is used, so
		//the test refuses to pass if one sneaks in through a helper.
		let mouseEvents = 0;
		const countMouse = () => { mouseEvents++; };
		for (const type of ['click', 'mousedown', 'mouseup', 'mousemove', 'mouseenter']) {
			dialog.addEventListener(type, countMouse, true);
		}

		//THE TOP ROW IS THE ONE THE WORD MEANT, every time — that is the owner's
		//metric, so every step asserts it before pressing anything.
		//
		//AND ENTER IS WHAT TAKES IT (round 3, D1). This run used to press Tab at
		//every step, because Tab added and Enter navigated. The owner's
		//constitution collapses that: "ENTER EXECUTES THE TOP ACTION", and the
		//whole composition is now literally type-enter-type-enter-…-CmdEnter.
		//(The acceptTop helper went with step 1, whose set is now seeded at open;
		//every surviving step asserts its own top row inline, which is the same
		//check written where its reason is.)

		//1. THE SET IS ALREADY THERE (round-3 tightness, M6). SUPERSEDED: this
		//step used to type 'everything' and accept `set:everything`, because the
		//composer opened on bare `main/` and the sticky starting set was applied
		//at the first EDIT. It is applied when the composer OPENS now, so the
		//draft already starts from Everything and the set is not offered as a
		//change at all — choosing the set you are in is a no-op with a count
		//beside it. What the step was pinning is unchanged and is asserted here:
		//the sentence names where the draft starts, continuously, and the set is a
		//word in it rather than a control beside it.
		assert.strictEqual(store.getState().collection.snapshot.setName, 'everything');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.match(sentenceText(), /Everything/,
			'the sentence names the state; nothing narrates the act of changing it');
		assert.ok(!dialog._paletteRows.some((row) => row.id === 'set:everything'),
			'and the set already in force is not offered as a change');

		//2. A SYNONYM that reaches a family with no name of its own. 'stale' is
		//the design's own worked example for why curated metadata was worth
		//building; the family it reaches is `updated`, spelled with the rolling
		//default so it is a real collection the moment it lands.
		seedTags();
		await settleRender(dialog);
		await typeComposer('stale');
		const staleTop = dialog._paletteRows[0];
		assert.strictEqual((staleTop.filter || '').split('/')[0], 'updated',
			`“stale” must lead with the updated family: ${dialog._paletteRows.slice(0, 3).map((row) => row.id).join(' | ')}`);
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['updated/after/7-days-ago']);
		//A configurable clause opens its controls; Escape peels that layer without
		//touching the draft, and it is a KEY, so the run continues.
		await closePillRow();
		assert.strictEqual(pillRow(), null);

		//3. A NEGATION, by prefix. The negated row leads, so Enter takes it.
		seedTags();
		await settleRender(dialog);
		await typeComposer('not tag-complexity');
		assert.strictEqual(dialog._paletteRows[0].valenceKind, 'not',
			`a typed negation must lead: ${dialog._paletteRows.slice(0, 3).map((row) => `${row.id}:${row.valenceKind}`).join(' | ')}`);
		await pressComposer('Enter');
		//`exclude/…`, not `-…`: the draft layer picks the engine's own spelling
		//for the shape it is building, and the user never meets either word — the
		//row said "Tagged Complexity" with a Not on it.
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
			['updated/after/7-days-ago', 'exclude/tag-complexity']);

		//4. AN OR, FUSED WITH ITS SIBLING. The draft already has a negated tag, so
		//a second tag is family-compatible and its widening row is offered —
		//reached by arrow key, taken by Enter.
		seedTags();
		await settleRender(dialog);
		await typeComposer('systems');
		const widen = dialog._paletteRows.findIndex((row) => row.valenceKind === 'or');
		assert.ok(widen >= 0, `an or-row must be offered: ${dialog._paletteRows.map((row) => `${row.id}:${row.valenceKind}`).join(' | ')}`);
		//TYPING ALREADY POINTS AT THE TOP ROW, so reaching row N costs N
		//arrow-downs and not N+1. That is the owner's metric in its literal form,
		//and this is the one place the suite counts them.
		for (let step = 0; step < widen; step++) await pressComposer('ArrowDown');
		assert.strictEqual(highlightedRow().dataset.rowId, dialog._paletteRows[widen].id,
			'the arrow keys walk the list the ranking produced');
		await pressComposer('Enter');
		//ONE clause, not two: `combine/…` is the engine's spelling for a union
		//whose members are not both plain tokens (one of them is negated). The
		//user typed a tag and chose a row that read "Tagged Complexity or Tagged
		//Systems"; the word `combine` appears only in the URL.
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
			['updated/after/7-days-ago', 'combine/exclude/tag-complexity/tag-systems'],
			'the two tags fuse into ONE union clause rather than becoming a second condition');

		//5. A DATE PHRASE, parsed rather than guessed at. It leads the list — and
		//because the sentence ALREADY has an `updated` clause (step 2's rolling
		//week), the top action is the CHANGE (round-3 tightness, M3), not a
		//second date clause AND-ed onto the first.
		//
		//SUPERSEDED PIN: this used to expect three conditions, with
		//`updated/after/30-days-ago` appended beside `updated/after/7-days-ago`.
		//Their intersection is the narrower of the two windows, so the composer's
		//answer to "make it thirty days" was a draft that still matched seven —
		//silently, with two date pills to explain it. One clause, moved.
		seedTags();
		await settleRender(dialog);
		await typeComposer('last 30 days');
		assert.strictEqual(dialog._paletteRows[0].filter, 'updated/after/30-days-ago',
			`a parsed phrase leads: ${dialog._paletteRows.slice(0, 3).map((row) => row.id).join(' | ')}`);
		assert.strictEqual(dialog._paletteRows[0].valenceKind, 'change',
			`and its top action is the change: ${dialog._paletteRows.slice(0, 3).map((row) => `${row.id}:${row.valenceKind}`).join(' | ')}`);
		assert.strictEqual(dialog._paletteRows[0].annotation, 'change',
			'said in the one annotation slot, in one quiet word');
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
			['updated/after/30-days-ago', 'combine/exclude/tag-complexity/tag-systems'],
			'the date clause KEPT ITS PLACE in the sentence and changed its value');
		await closePillRow();

		//6. THE SORT, by alias, and it replaces the word rather than adding a
		//clause — the same Enter as every other step, which is the point.
		seedTags();
		await settleRender(dialog);
		await typeComposer('by stars');
		assert.strictEqual(dialog._paletteRows[0].id, 'sort:stars',
			`“by stars” must lead with the sort: ${dialog._paletteRows.slice(0, 3).map((row) => row.id).join(' | ')}`);
		await pressComposer('Enter');
		assert.strictEqual(store.getState().collection.snapshot.sortName, 'stars');

		//THE WHOLE DESCRIPTION, assembled without a single pointer event.
		const snapshot = store.getState().collection.snapshot;
		assert.strictEqual(snapshot.setName, 'everything');
		//TWO CONDITIONS, not three (round-3 tightness, M3): step 5's date phrase
		//MOVED the date clause step 2 put in the sentence rather than AND-ing a
		//second one beside it.
		assert.deepStrictEqual(snapshot.filterNames,
			['updated/after/30-days-ago', 'combine/exclude/tag-complexity/tag-systems']);
		assert.strictEqual(snapshot.sortName, 'stars');

		//7. AND THE COMMIT, which is the ONLY keystroke in the run that navigates.
		//Everything above changed a draft nobody had opened; this is where the
		//collection becomes real. 'type, enter, type, enter, … Cmd-Enter.'
		assert.strictEqual(window.location.pathname, '/c/main/',
			'nothing in the composition touched the real collection');
		await pressComposer('Enter', { metaKey: true });
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
		assert.strictEqual(window.location.pathname,
			'/c/everything/updated/after/30-days-ago/combine/exclude/tag-complexity/tag-systems/sort/stars/');
		assert.strictEqual(mouseEvents, 0, 'the whole composition used no pointer at all');

		for (const type of ['click', 'mousedown', 'mouseup', 'mousemove', 'mouseenter']) {
			dialog.removeEventListener(type, countMouse, true);
		}
	});

	it('offers a typed token’s meanings as rows, ranked and counted', async () => {
		await addRefineRow('Starred');
		await typeComposer('unread');
		const ids = suggestionRows().map((button) => button.dataset.rowId)
			.filter((id) => id.startsWith('filter:unread'));
		assert.deepStrictEqual(ids, ['filter:unread:add', 'filter:unread:or:0', 'filter:unread:not'],
			'add leads; the or is offered above the not because it widens a compatible clause');

		const row = (id) => suggestionRows().find((button) => button.dataset.rowId === id);
		//EACH ROW RENDERS AS THE PILL IT WOULD BECOME, through the same renderer
		//the sentence uses — and the `not` row shows the app's own inverse WORD
		//rather than an operator, because that is the pill the inversion will make.
		assert.match(rowText(row('filter:unread:add')), /Unread/);
		assert.match(rowText(row('filter:unread:not')), /Read/);
		assert.ok(!rowText(row('filter:unread:not')).includes('exclude'),
			'the engine’s boolean plumbing never reaches the user');
		//And the or row is labelled with what it widens — in its own label, which
		//already reads '<target> or <new>'.
		//
		//SUPERSEDED PIN (round 3, D3): a second '.row-widens' line under the
		//label ('widens Starred') is deleted. It was a fourth thing in the row
		//anatomy that exactly one species of row carried, restating the half of
		//the label that was already on screen — 'No row may have a unique visual
		//grammar'.
		assert.match(rowText(row('filter:unread:or:0')), /Starred or Unread/);
		assert.strictEqual(row('filter:unread:or:0').querySelector('.row-widens'), null);

		//A ROW COUNT IS A PREDICTION, written as the transition it predicts.
		dialog._previewCounts = {
			'current-draft-preview': 41,
			'filter:unread:add': 12,
			'filter:unread:or:0': 118,
			'filter:unread:not': 29,
		};
		await settleRender(dialog);
		assert.match(rowText(row('filter:unread:add')), /41 cards → 12 cards/);
		assert.match(rowText(row('filter:unread:or:0')), /41 cards → 118 cards/);
		assert.match(rowText(row('filter:unread:not')), /41 cards → 29 cards/);
	});

	//TYPING THE NAME OF A CLAUSE YOU ALREADY HAVE (round 3, D2).
	//
	//The owner's constitution enumerates the actions a top row may be: "'change
	//the sort' or 'change the set' or 'add a filter' or 'remove a filter' or
	//'change a filter's configuration'". Two of those five had no row at all, and
	//their absence produced the case the owner caught by hand: with `Exclude
	//common-tools` in the draft, typing 'common-tools' offered to fuse the clause
	//with its own negation — `(not common-tools OR common-tools)`, which is every
	//card in the corpus, ranked first.
	it('offers Remove and Edit for a clause the draft already has, in either valence', async () => {
		await seedDraft('everything/exclude/tag-systems/');
		dialog._composerCandidates = [{
			filter: 'tag-systems',
			category: 'tag',
			label: 'Tagged “Systems”',
			detail: 'Keeps cards tagged Systems',
			aliases: ['tag-systems', 'Systems', 'tag', 'tagged'],
			searchValues: ['tagged “systems”', 'tag-systems', 'tag', 'systems', 'tagged'],
		}];
		await settleRender(dialog);
		await typeComposer('systems');

		//THE REMOVAL LEADS, and it is a removal of the NEGATED clause — the one
		//that is actually in the sentence, named as it reads there.
		const top = dialog._paletteRows[0];
		assert.strictEqual(top.valenceKind, 'remove',
			`the top action must be the removal: ${dialog._paletteRows.slice(0, 3).map((row) => `${row.id}:${row.valenceKind}`).join(' | ')}`);
		assert.strictEqual(top.removes, true);
		assert.strictEqual(top.targetIndex, 0);
		assert.deepStrictEqual(top.description.filters, [],
			'and it produces the collection without that clause, which is what its count counts');

		//AND NO OR-ROW PAIRS A CLAUSE WITH ITS OWN NEGATION. The union of a
		//clause and its opposite is the whole corpus: a row promising a
		//refinement and delivering the universe.
		//Scoped to the clause in question: an unrelated candidate (the free-text
		//guess) is a legitimate alternative to widen the negated tag with, and
		//suppressing THAT would be a different bug.
		assert.ok(!dialog._paletteRows.some((row) => row.valenceKind === 'or' && row.id.includes('tag-systems')),
			`no or-row may pair a clause with its own negation: ${dialog._paletteRows.map((row) => `${row.id}:${row.valenceKind}`).join(' | ')}`);

		//EXECUTING IT TAKES THE CLAUSE OUT, by the same Enter every other row
		//answers to.
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
		assert.strictEqual(dialog._composerInput, '');
		assert.strictEqual(window.location.pathname, '/c/main/', 'and nothing navigated');
	});

	//EDIT-BY-TYPING: a CONFIGURABLE clause the draft already has ranks its own
	//controls above a duplicate of itself (D2). A date family is the case that
	//matters — nobody types 'updated', they type the phrase, and the clause they
	//get back is the one they want to adjust.
	it('ranks Edit above a duplicate for a configurable clause already in the draft', async () => {
		await seedDraft('everything/updated/after/7-days-ago/');
		await typeComposer('last 7 days');
		const kinds = dialog._paletteRows.map((row) => row.valenceKind);
		assert.deepStrictEqual(kinds.slice(0, 2), ['remove', 'edit'],
			`remove then edit lead: ${dialog._paletteRows.slice(0, 4).map((row) => `${row.id}:${row.valenceKind}`).join(' | ')}`);
		const edit = dialog._paletteRows[1];
		assert.strictEqual(edit.edits, true);
		assert.deepStrictEqual(edit.description.filters, ['updated/after/7-days-ago'],
			'an edit row changes nothing on its own: its collection is the draft');
		//AND IT SAYS WHICH OF THE TWO IT IS, in the annotation slot. Found by
		//looking at the live composer: the remove and the edit sat one above the
		//other showing the SAME pill, and only a line through the first told them
		//apart — which left the second reading as the add grammar every other row
		//in the list uses.
		assert.deepStrictEqual(dialog._paletteRows.slice(0, 2).map((row) => row.annotation),
			['remove', 'edit']);


		//AND A ROW WITH NO COUNT IS NOT SUNK BY ONE. Caught in live verification
		//on the owner's corpus: with the draft resolving to ZERO, the zero-sink
		//rule pushed `Edit …` — whose collection IS the draft, so its count is
		//the draft's — from second place to tenth, under eight rows offering to
		//add a SECOND date clause to a collection that already matched nothing.
		//The rule exists so a row reading `→ 0 cards` does not lead; a row that
		//never renders a number is not that row.
		const draftKey = dialog._previewCountKey(dialog._collectionDescription);
		dialog._retainedPreviewCounts.set(draftKey, 0);
		dialog.requestUpdate();
		await settleRender(dialog);
		assert.deepStrictEqual(dialog._paletteRows.map((row) => row.valenceKind).slice(0, 2), ['remove', 'edit'],
			`an empty draft must not sink the actions about its own clauses: ${dialog._paletteRows.slice(0, 5).map((row) => `${row.id}:${row.valenceKind}`).join(' | ')}`);
		dialog._retainedPreviewCounts.clear();
		dialog.requestUpdate();
		await settleRender(dialog);

		//AND IT HAS NO COUNT, because it predicts no change of collection. A
		//`41 cards → 41 cards` row is a column spent saying nothing.
		assert.strictEqual(dialog._rowCountMeaningful(edit), false);

		//EXECUTING IT OPENS THE CLAUSE'S OWN CONTROLS, on the clause it named.
		//One arrow-down, because the removal is the top action and this row is
		//the second: the contract is "the top one, or the highlighted one if the
		//user arrowed", and this is the arrowed half.
		await pressComposer('ArrowDown');
		assert.strictEqual(highlightedRow().dataset.rowId, edit.id);
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['updated/after/7-days-ago'],
			'the draft is untouched');
		assert.deepStrictEqual([...dialog._selectedPath], [0]);
		assert.ok(pillRow(), 'and the pill row is open on it');
	});

	//A PASTED COLLECTION URL CARRIES ITS CARD INTO THE DRAFT (round 3, D1/D3).
	//
	//The pasted-source row is one of the species D3 unifies, and it is the one
	//that carries a selected card: `/c/everything/starred/card-42` names a
	//collection AND a card. While the row NAVIGATED, the card travelled with the
	//navigation. Now that executing it replaces the draft instead, the card has
	//to travel into the draft — otherwise the commit at the end opens the
	//collection somewhere the row never named, which is the half-undo defect one
	//door over.
	it('carries a pasted link’s selected card into the draft it replaces', async () => {
		await typeComposer('/c/everything/starred/card-42');
		const pasted = dialog._paletteRows.find((row) => (row.id || '').startsWith('source:'));
		assert.ok(pasted, `the pasted link is read as the collection it names: ${dialog._paletteRows.slice(0, 3).map((row) => row.id).join(' | ')}`);
		assert.strictEqual(dialog._paletteRows[0].id, pasted.id, 'and it leads: a parse outranks every guess');
		await pressComposer('Enter');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		assert.strictEqual(store.getState().collection.snapshot.setName, 'everything');
		assert.strictEqual(dialog._draftSelectedCard, 'card-42',
			'the card the row named is the card the draft is now on');
		assert.strictEqual(window.location.pathname, '/c/main/',
			'and nothing navigated: a pasted link is an action on the draft like any other row');
		await pressComposer('Enter', { metaKey: true });
		assert.strictEqual(window.location.pathname, '/c/everything/starred/card-42',
			'so the commit opens exactly what the row promised');
	});

	//ONE ROW ANATOMY, ACROSS THE SPECIES THAT USED TO DIFFER MOST (D3).
	//
	//"All rows should look/feel like the same KIND of thing." A removal row shows
	//the pill it takes out, struck; a combinatorial row shows its mini-sentence
	//plus its whole diff in the SAME quiet annotation slot a one-word 'tag' uses.
	//Same shape, bigger payload.
	it('gives a removal and a combinatorial row the same anatomy as every other row', async () => {
		await seedRecents([['everything/unread/sort/recent/', 4]]);
		await seedDraft('everything/starred/');
		await typeComposer('starred');

		const removal = suggestionRows().find((button) => (button.dataset.rowId || '').includes(':remove:'));
		assert.ok(removal, 'the removal is a row in the one list');
		//The pill it takes out, rendered by the component that draws it in the
		//sentence — not a text label with a verb glued in front.
		assert.ok(removal.querySelector('.row-label collection-sentence'),
			'a removal shows the pill, through the sentence renderer');
		assert.match(rowText(removal), /Starred/);
		assert.ok(removal.querySelector('.row-label').classList.contains('row-removes'),
			'and wears the removal treatment');
		assert.match(composerStyles(), /\.row-removes\s*\{[^}]*text-decoration:\s*line-through/,
			'which is the outlined-not vocabulary one step further: struck');

		//SUPERSEDED PIN (round-3 tightness, S1). The combinatorial row's whole
		//DIFF used to ride in the annotation slot — 'Removes Starred · Adds
		//Unread · Sorts by Recent', a three-clause sentence in the element a
		//vocabulary row puts the word 'tag' in. It was defended as "same shape,
		//bigger payload"; on a real corpus the payload wrapped to three lines and
		//made one species of row twice the height of every other, which is the
		//same-KIND-of-thing rule broken by the mechanism meant to keep it. And it
		//was ALREADY on screen: the row's own detail line is that sentence.
		//
		//The slot carries one quiet word now, from a closed vocabulary, and the
		//diff stays where every other row's explanation lives.
		await typeComposer('unread');
		const recent = suggestionRows().find((button) => (button.dataset.rowId || '').startsWith('recent:'));
		assert.ok(recent, 'the recent is reachable by typing');
		const annotation = recent.querySelector('.row-label .row-annotation');
		assert.ok(annotation, 'it uses the annotation slot, not a slot of its own');
		assert.strictEqual(annotation.textContent.trim(), 'recent',
			'and puts ONE quiet word in it');
		assert.ok(!annotation.textContent.includes(' · '),
			'no row states a sentence in the annotation slot');
		assert.match(composerStyles(), /\.row-annotation\s*\{[^}]*white-space:\s*nowrap/,
			'and the rule enforces it: anything that would wrap does not belong there');
		//THE DIFF IS ON THE ROW'S OWN DETAIL LINE, where the reader can ask for it.
		const recentRow = dialog._paletteRows.find((row) => row.id.startsWith('recent:'));
		assert.match(recentRow.detail, /Removes Starred/);
		assert.match(recentRow.detail, /Adds Unread/);
		assert.match(recentRow.detail, /Sorts by Recent/);
	});

	//TAB MATERIALIZES THE VALENCE ITSELF, not a re-derivation of it: the row
	//carries the whole after-expression, so the edit the count described and the
	//edit that lands are the same object.
	it('Tab applies the highlighted valence, and only that valence', async () => {
		await addRefineRow('Starred');
		await typeComposer('unread');
		//The add row leads and is highlighted by the typing itself.
		assert.strictEqual(highlightedRow().dataset.rowId, 'filter:unread:add');
		await pressComposer('Tab');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred', 'unread'],
			'the add ANDs a second condition');
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-composer-input').value, '',
			'the input clears');
		assert.strictEqual(highlightedRow(), null, 'and the rebuilt list is pointed at by nobody');
		assert.strictEqual(dialog.shadowRoot.activeElement?.id, 'collection-composer-input',
			'focus stays where the user is typing');

		//The OR valence of the same token fuses instead, into one pill.
		await pressComposer('Backspace');
		await pressComposer('Backspace');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);
		await typeComposer('unread');
		//AN OR IS A GRAFT, SO IT IS NO LONGER THE SECOND ROW (round-3 tightness,
		//B2/M5): every literal reading of the token comes first, and the widening
		//of an existing clause sits under them. It is still reachable, and still
		//by arrow key — which is what this test is about. Arrow down until the
		//keyboard is on it, exactly as a user would.
		for (let step = 0; step < dialog._paletteRows.length; step++) {
			if (highlightedRow() && highlightedRow().dataset.rowId === 'filter:unread:or:0') break;
			await pressComposer('ArrowDown');
		}
		assert.strictEqual(highlightedRow().dataset.rowId, 'filter:unread:or:0');
		await pressComposer('Tab');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred+unread'],
			'the or fuses two pills into one condition');
		assert.strictEqual(sentencePills().length, 2, 'which the sentence draws as one group of two');
		assert.ok(dialog.shadowRoot.querySelector('collection-sentence').shadowRoot.querySelector('tag-chip-group'));
	});

	//SUPERSEDED PIN (round 3, D6). This was 'shows the compiled path the draft
	//would open, under the list' — a quiet monospace line that taught the URL
	//grammar by showing it, on the argument that it depended on nothing and asked
	//for nothing. The adversarial tightness pass cuts exactly that class of
	//thing: what survives in the composer is the sentence, the input, the one
	//list, the footer's count and commit, and the pill row on a selection. A URL
	//is none of those. Source mode still shows the path — editable, which teaches
	//better than a line you cannot touch — and the composer's own door to it is
	//one row down.
	it('shows no compiled path under the list', async () => {
		assert.strictEqual(dialog.shadowRoot.querySelector('.compiled-path'), null);
		await addRefineRow('Starred');
		assert.strictEqual(dialog.shadowRoot.querySelector('.compiled-path'), null);
		assert.doesNotMatch(composerStyles(), /\.compiled-path\s*\{/);
	});

	//"ONLY FOR YOU" DIES IN COMPOSITION (meta-proposal convergence 6). The note
	//rode every personal chip and every personal row — a caution repeated in the
	//one place where nothing is at stake, since nobody has shared anything yet.
	//Viewer-dependence speaks ONCE, where the consequence lands.
	it('says nothing about viewer-dependence while composing, and everything at the link', async () => {
		await addRefineRow('Starred');
		assert.ok(!/only for you/i.test(deepText(dialog.shadowRoot)),
			'no chip note and no row note anywhere in the composer');
		const source = await readFile(path.join(REPO_ROOT, 'src/components/configure-collection-dialog.ts'), 'utf8');
		assert.ok(!source.includes('VIEWER_DEPENDENT_CHIP_NOTE'),
			'and the composer does not import the note it no longer shows');
		//The two surfaces that DO say it are untouched.
		assert.match(source, /this link’s results depend on who views it/,
			'Source’s status still says so about the link it is showing');
		const copy = await readFile(path.join(REPO_ROOT, 'src/collection-link-copy.ts'), 'utf8');
		assert.match(copy, /Results depend on who views it/,
			'and so does the copy-link confirmation');
	});

	it('routes a typed configurable family through its own controls', async () => {
		await typeComposer('updated');
		const row = suggestionRows().find((button) => rowText(button).includes('Updated'));
		assert.ok(row);
		row.click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		//The rolling default answers a question rather than asking for an edit
		//before it means anything.
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['updated/after/7-days-ago']);
		assert.ok(pillRow(), 'and its date control is open on it');
		assert.ok(pillRow().shadowRoot.querySelector('configure-collection-date'));
	});

	it('routes nested collection expressions to discoverable Source mode without changing the draft', async () => {
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('exclude');
		const row = suggestionRows().find((button) => button.dataset.filter === 'exclude');
		assert.ok(row, 'a clause this layer cannot compose is still findable');
		row.click();
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [],
			'and opening it in Source does not touch the draft');
		assert.strictEqual(dialog._entryMode, 'source');
		//`/c/everything/exclude/`, not `/c/exclude/`: every collection path the
		//composer writes comes from collectionURLPath, whose whole point is that a
		//bare collection is never spelled as nothing. The set is `everything`
		//because the composer seeds the sticky starting set when it OPENS now
		//(round-3 tightness, M6) — this line used to read `/c/main/`, which was
		//the set the draft still had while the sentence above it was about to
		//commit a different one.
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-source-input').value, '/c/everything/exclude/');
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /needs 1 more value/);
		assert.match(dialog.shadowRoot.querySelector('#collection-source-completions').textContent, /Working Notes/);
		const source = dialog.shadowRoot.querySelector('#collection-source-input');
		source.value = '/c/exclude/working-n/';
		source.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
		assert.match(dialog.shadowRoot.querySelector('#collection-source-completions').textContent, /Working Notes/);
	});

	//THE LAYERS PEEL IN THE ORDER THEY WERE OPENED. Browse all is one layer and
	//the pill row it opens is another, so Escape from inside the row returns to
	//the sentence and Escape again closes the dialog — the same shape the catalog
	//and its Configure panel had, over the surfaces that replaced them.
	it('supports keyboard browse search and lets Escape back out one layer', async () => {
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('query');
		await pressComposer('ArrowDown');
		await pressComposer('Enter');
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		assert.ok(pillRow(), 'Enter on the highlighted family row opens its controls');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(pillRow(), null, 'the first Escape peels the row');
		assert.strictEqual(dialog.open, true);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false,
			'and the next one closes the dialog');
	});

	//ONE DEFAULT, IN ONE PLACE. A date family's own argument default is
	//`before/<today>`, which selects most of a corpus and means nothing until
	//somebody edits it — a clause that has to be edited before it does anything
	//is the deleted pending-add gate in another form. The rolling window is what
	//both routes into a date family now produce, because they call the same
	//function.
	it('offers a safe rolling date default without requiring a meaningless edit', async () => {
		browseAll().click();
		await settleRender(dialog);
		const updated = familyRow('updated');
		assert.ok(updated);
		updated.click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['updated/after/7-days-ago']);
		const dateControl = pillRow().shadowRoot.querySelector('configure-collection-date');
		await dateControl.updateComplete;
		assert.match(dateControl.shadowRoot.textContent, /Counted from today/);
		assert.match(dateControl.shadowRoot.textContent, /A time ago/);
	});

	//A readback test: assert what the control DISPLAYS, not what confirming it
	//produces. The comparison <select> rendered at selectedIndex 0 ("Before")
	//while the seeded filter said "after", and a 41-test suite that only ever
	//asserted the committed value never saw it.
	it('displays the comparison the seeded date filter actually names', async () => {
		browseAll().click();
		await settleRender(dialog);
		familyRow('updated').click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['updated/after/7-days-ago']);
		const dateControl = pillRow().shadowRoot.querySelector('configure-collection-date');
		await dateControl.updateComplete;
		const comparison = dateControl.shadowRoot.querySelector('[aria-label="Date comparison"]');
		assert.strictEqual(comparison.value, 'after');
		assert.strictEqual(comparison.selectedIndex, 1);
		assert.strictEqual(comparison.options[comparison.selectedIndex].textContent, 'After');
		assert.deepStrictEqual(
			Array.from(comparison.options).filter((option) => option.selected).map((option) => option.value),
			['after']
		);
		//And the same control, reopened from the pill rather than from the row
		//that added it, still reads back what the clause says.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(pillRow(), null);
		sentencePills()[0].click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		const appliedDate = pillRow().shadowRoot.querySelector('configure-collection-date');
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

	//ONE CENTERLINE INSIDE THE DATE EDITOR TOO (owner, F3).
	//
	//Each boundary used to be a <fieldset> stacking its <legend> above two
	//radios above a field, hosted in a container that bottom-aligned its items —
	//which is how 'When', 'Date', the radios and the fields ended up at four
	//different heights in one pill row.
	//
	//The legend had to GO, and for a layout reason rather than a taste one: the
	//HTML rendering rules place a fieldset's rendered legend above the anonymous
	//content box, so it can never be a flex item beside the controls no matter
	//what display the fieldset takes. What replaces it is a span inside a
	//role='group' carrying the same word as its aria-label — which is what the
	//fieldset and legend were buying in the accessibility tree, kept.
	it('labels each date boundary beside its controls, and still groups them', async () => {
		const dateControl = document.createElement('configure-collection-date');
		dateControl.value = 'between/2026-08-01/yesterday';
		document.body.append(dateControl);
		try {
			await dateControl.updateComplete;
			const boundaries = Array.from(dateControl.shadowRoot.querySelectorAll('.date-boundary'));
			assert.deepStrictEqual(
				boundaries.map((boundary) => boundary.getAttribute('aria-label')),
				['From', 'Until'],
				'the group still says which end of the range it is');
			assert.deepStrictEqual(boundaries.map((boundary) => boundary.getAttribute('role')), ['group', 'group']);
			assert.deepStrictEqual(
				boundaries.map((boundary) => boundary.querySelector('.boundary-label').textContent.trim()),
				['From', 'Until'],
				'and it is visible, not only announced');
			assert.strictEqual(dateControl.shadowRoot.querySelector('legend'), null,
				'a legend cannot sit beside its controls, which is the whole defect');
			const styles = dateControl.constructor.styles.map((style) => String(style.cssText || style)).join('\n');
			assert.match(styles.match(/\.date-boundary\s*\{[^}]*\}/)[0], /align-items:\s*center/);
			assert.match(styles.match(/\.date-boundary\s*\{[^}]*\}/)[0], /flex-direction:\s*row/);
			assert.match(styles.match(/\.container\s*\{[^}]*\}/)[0], /align-items:\s*center/,
				'and the container centres them rather than bottom-aligning them');
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
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('similar');
		familyRow('similar').click();
		await settleRender(dialog);
		await settleRender(dialog, pillRow());
		const keyCard = pillRow().shadowRoot.querySelector('configure-collection-key-card');
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
		await settleRender(dialog, pillRow(), keyCard);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['similar/card-1']);
		assert.strictEqual(store.getState().find.open, false, 'picking closes the picker');
		//stateChanged recomputes _cardTagInfos from the (empty) corpus on every
		//dispatch, so the fake has to be restated once they have all landed.
		//That is this suite's standing fiction, not something the pick disturbed.
		dialog._cardTagInfos = {
			'card-1': { id: 'card-1', title: 'Inductively Knowable' },
			'card-2': { id: 'card-2', title: 'Mechanistic Magic' },
		};
		await settleRender(dialog, pillRow(), keyCard);
		//The chosen card is shown by title, through the shared tag primitive.
		const shown = pillRow().shadowRoot.querySelector('configure-collection-key-card')
			.shadowRoot.querySelector('tag-list');
		assert.deepStrictEqual(shown.tags, ['card-1']);
		assert.strictEqual(shown.tagInfos['card-1'].title, 'Inductively Knowable');
	});

	//ONE EDITOR AT A TIME IS STRUCTURAL NOW, so two key-card controls can no
	//longer be on screen together inside the composer: the setup strip that held
	//the second one is deleted, and the pill row is about exactly one clause. The
	//addressed-answer machinery it needed is still real, and still worth pinning —
	//at the level where it lives, which is the control itself.
	it('delivers a picked card only to the control that asked for it', async () => {
		const asking = document.createElement('configure-collection-key-card');
		const bystander = document.createElement('configure-collection-key-card');
		asking.value = 'key-card-id';
		bystander.value = 'key-card-id';
		document.body.append(asking, bystander);
		try {
			await settleRender(asking, bystander);
			let askingValue = '';
			let bystanderValue = '';
			asking.addEventListener('filter-modified-complex', (event) => { askingValue = event.detail.value; });
			bystander.addEventListener('filter-modified-complex', (event) => { bystanderValue = event.detail.value; });

			asking.shadowRoot.querySelector('#choose-card').click();
			await settleRender(asking, bystander, findDialog);
			assert.strictEqual(store.getState().find.configuring, true);
			assert.ok(store.getState().find.configureRequestID, 'the picker is told which control asked');

			findDialog._handleThumbnailTapped({ detail: { card: 'card-2' } });
			await settleRender(asking, bystander, findDialog);
			assert.strictEqual(askingValue, 'card-2');
			assert.strictEqual(bystanderValue, '', 'the control that did not ask must not take the answer');
		} finally {
			asking.remove();
			bystander.remove();
		}
	});

	it('shows contributor names while preserving durable author IDs', async () => {
		dialog._userIDs = ['alex-uid', 'sam-uid'];
		dialog._userInfos = {
			'alex-uid': { id: 'alex-uid', title: 'Alex Komoroske' },
			'sam-uid': { id: 'sam-uid', title: 'Sam Example' },
		};
		browseAll().click();
		await settleRender(dialog);
		await typeComposer('author');
		familyRow('author').click();
		await settleRender(dialog);
		//stateChanged recomputes the contributor lists from the (empty) corpus on
		//every dispatch, so this suite's standing fiction has to be restated once
		//they have all landed.
		dialog._userIDs = ['alex-uid', 'sam-uid'];
		dialog._userInfos = {
			'alex-uid': { id: 'alex-uid', title: 'Alex Komoroske' },
			'sam-uid': { id: 'sam-uid', title: 'Sam Example' },
		};
		await settleRender(dialog, pillRow());
		const authorSelect = pillRow().shadowRoot.querySelector('.argument select');
		assert.ok(authorSelect, 'the contributor control is reparented into the row');
		assert.match(authorSelect.textContent, /Me/);
		assert.match(authorSelect.textContent, /Alex Komoroske/);
		assert.match(authorSelect.textContent, /Sam Example/);
		authorSelect.value = 'sam-uid';
		authorSelect.dispatchEvent(new Event('change', { bubbles: true }));
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['author/sam-uid']);
	});

	//SET, SORT AND VIEW ARE WORDS IN THE SENTENCE. The four-select setup strip is
	//deleted; clicking a word fills the ONE list with its alternatives, which is
	//the same list every other choice is made in and the same rows a typed set or
	//sort name reaches through the completion index.
	it('edits the sentence’s words from the same list, not from a setup strip', async () => {
		await addRefineRow('Starred');
		const sentence = dialog.shadowRoot.querySelector('collection-sentence');

		//The set is the sentence's first word, and it is a control.
		const setWord = sentence.shadowRoot.querySelector('button.word.set');
		assert.ok(setWord, 'the set is a word you can click');
		setWord.click();
		await settleRender(dialog);
		assert.strictEqual(dialog._wordScope, 'set');
		const setRows = suggestionLabels();
		assert.ok(setRows.some((label) => label.startsWith('Main')), `the alternatives are the sets: ${setRows.join(', ')}`);
		//The draft already starts from Everything (the sticky default), so the
		//CHANGE this pins is the one back to Main — the list marks the one in
		//force rather than deleting it, which is what makes it answerable.
		assert.ok(setRows.some((label) => label.includes('Everything') && label.includes('current')),
			`the list says which set you are in: ${setRows.join(', ')}`);
		//A WORD-SCOPE ROW WEARS THE STANDARD ANATOMY (round-3 tightness, S4).
		//This feed used to be the one carrying no annotation at all — bare
		//labels, in a list where every other row says what kind of thing it is —
		//and the option in force wore a FOURTH element, '✓ current', in a size of
		//its own beside the slot that was empty. One slot, one word; and on the
		//row you are already in, the more useful word.
		const setButtons = suggestionRows();
		const mainRow = setButtons.find((button) => rowText(button).startsWith('Main'));
		assert.strictEqual(mainRow.querySelector('.row-label .row-annotation').textContent.trim(), 'set');
		const currentRow = setButtons.find((button) => rowText(button).includes('Everything'));
		assert.strictEqual(currentRow.querySelector('.row-label .row-annotation').textContent.trim(), '✓ current');
		assert.strictEqual(dialog.shadowRoot.querySelector('.row-current'), null,
			'the fourth element is deleted');
		assert.doesNotMatch(composerStyles(), /\.row-current\s*\{/,
			'and so is its rule');
		//AND THE SCOPE STATES ITS OWN CONTRACT, as the or-scoped input does: a
		//footer describing the keys of a mode you are not in is a footer lying.
		//SUPERSEDED (owner, F4): the word scope used to state its own key
		//contract on the footer line. The line is deleted in every state, this
		//one included; what says the scope is in force is the list itself, whose
		//rows are the alternatives for that word.
		assert.strictEqual(dialog.shadowRoot.querySelector('.key-hints'), null);
		suggestionRows().find((button) => rowText(button).startsWith('Main')).click();
		await settleRender(dialog);
		assert.strictEqual(store.getState().collection.snapshot.setName, 'main');
		assert.strictEqual(dialog._wordScope, '', 'and choosing one leaves the feed');

		//And the sort tail, once there is one, opens the order alternatives —
		//reverse and the view modes with them, because they are all the same
		//kind of word.
		await pressComposer('ArrowDown');
		const sortRow = suggestionRows().find((button) => button.dataset.rowId === 'sort:recent');
		assert.ok(!sortRow, 'sorts are not offered until the word is reached for');
		dialog._openWordScope('sort');
		await settleRender(dialog);
		const sortLabels = suggestionLabels();
		//Each label carries its own quiet annotation now (S4), so these read
		//'Recentsort' when the text is run together.
		assert.ok(sortLabels.some((label) => label.startsWith('Recent')), `the alternatives are the orders: ${sortLabels.join(', ')}`);
		assert.ok(sortLabels.some((label) => label.startsWith('Reverse order')), 'reversing lives with the order it reverses');
		assert.ok(sortLabels.some((label) => label.includes('current')),
			`and the order in force says so, in the same slot: ${sortLabels.join(', ')}`);
		assert.ok(suggestionRows().some((button) => button.dataset.rowId === 'view:web'),
			'and the views are words too');
		suggestionRows().find((button) => button.dataset.rowId === 'view:web').click();
		await settleRender(dialog);
		assert.strictEqual(store.getState().collection.snapshot.viewMode, 'web');
		assert.strictEqual(store.getState().collection.snapshot.viewModeExtra, '_',
			'a view that takes a focus card gets the collection’s own first card');
	});

	//THE SENTENCE HAS NO WORD FOR ITS DEFAULTS, and the palette needs one.
	//
	//collection-sentence deliberately omits "sorted by default": that tells the
	//user about a field rather than about their collection, and the refusal is
	//right. But the four-select setup strip that used to carry sort and view is
	//deleted, so at the defaults — where most sessions start — there would be no
	//word to click and typing 'recent' would be the only route. The palette
	//supplies the missing word itself, and yields it back the moment the sentence
	//has a real tail of its own, so there is never two of them.
	it('offers an order word only while the sentence declines to say one', async () => {
		const orderWord = () => dialog.shadowRoot.querySelector('.order-word');
		const sentence = () => dialog.shadowRoot.querySelector('collection-sentence');
		assert.ok(orderWord(), 'at the defaults the palette supplies the word');
		assert.strictEqual(orderWord().textContent.trim(), 'order and view',
			'and it says what it opens rather than claiming the collection is "sorted by default"');
		assert.strictEqual(sentence().shadowRoot.querySelector('button.word.tail'), null,
			'because the sentence itself has no tail to offer');

		orderWord().click();
		await settleRender(dialog);
		assert.strictEqual(dialog._wordScope, 'sort');
		suggestionRows().find((button) => button.dataset.rowId === 'sort:recent').click();
		await settleRender(dialog);
		assert.strictEqual(store.getState().collection.snapshot.sortName, 'recent');

		//Now the sentence has a real tail, and it is the one control.
		assert.strictEqual(orderWord(), null, 'the palette yields its stand-in back');
		const tail = sentence().shadowRoot.querySelector('button.word.tail');
		assert.ok(tail, 'the sentence’s own word is the control now');
		assert.match(tail.textContent, /sorted by recent/);
		tail.click();
		await settleRender(dialog);
		assert.strictEqual(dialog._wordScope, 'sort', 'and it opens the same list');
	});

	//A COUNT ANSWERS "HOW MANY CARDS", so a row that only reorders has none —
	//"1,842 cards → 1,842 cards" is a prediction that takes a column to say
	//nothing, and the same rule keeps it from being asked of the worker.
	it('shows no count on a row that cannot change one', async () => {
		dialog._previewCounts = { 'current-draft-preview': 12 };
		dialog._openWordScope('sort');
		await settleRender(dialog);
		for (const button of suggestionRows()) {
			assert.strictEqual(button.querySelector('.row-count'), null,
				`${rowText(button)} reorders the same cards, so it promises no number`);
		}
		browseAll().click();
		await settleRender(dialog);
		for (const button of suggestionRows()) {
			assert.strictEqual(button.querySelector('.row-count'), null,
				'and a directory of families is not a list of predictions');
		}
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
		//Source now OPENS at the composer's own draft path, because '/c/' names no
		//collection at all — the old text handed the router an empty collection
		//portion. The set is `everything` because the sticky starting set is
		//seeded when the composer opens (M6). The add-next position is still the
		//end of that text, which is the property this test is about.
		assert.strictEqual(input.value, '/c/everything/upd/');
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
		await settleRender(dialog);
		assert.strictEqual(input.value, 'updated/before/');
		assert.strictEqual(open().disabled, true);
		assert.strictEqual(window.location.pathname, '/c/main/');

		input.value = '/c/everything/starred/card-9';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
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
		await settleRender(dialog);
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
		await settleRender(dialog);
		assert.strictEqual(input.getAttribute('role'), 'combobox');
		assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
		assert.ok(input.getAttribute('aria-activedescendant'));
		assert.match(dialog.shadowRoot.querySelector('#collection-source-completions').textContent, /Choose how cards are ordered/);

		input.value = 'sta/unread/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
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
		await settleRender(dialog);
		assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
		assert.match(dialog.shadowRoot.textContent, /Add another filter or modifier/);
		assert.match(dialog.shadowRoot.textContent, /Choose an order/);
		assert.match(dialog.shadowRoot.textContent, /Start with Main/);
		assert.match(dialog.shadowRoot.textContent, /Then Starred/);

		input.value = 'starred/induct';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
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
		await settleRender(dialog);
		assert.strictEqual(input.getAttribute('aria-expanded'), 'true');
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await dialog.updateComplete;
		//Source commits the collection the TEXT names. The composer's sticky
		//starting set is a default for a composition, and a typed path is not
		//one — the user has written the set they want, or written none.
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
		await settleRender(dialog);
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
		await settleRender(dialog);
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-source-destination'), null,
			'no heading claims a destination while there is none');
		assert.doesNotMatch(dialog.shadowRoot.textContent, /Will open as/);
		assert.strictEqual(input.getAttribute('aria-describedby'), 'collection-source-status');

		input.value = '/c/main/starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
		assert.match(dialog.shadowRoot.querySelector('#collection-source-destination').textContent, /\/c\/starred\/$/);
		assert.match(dialog.shadowRoot.textContent, /Will open as/);
		assert.match(dialog.shadowRoot.textContent, /Same collection, written in this app’s canonical form/);

		input.value = '/c/starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
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
		await settleRender(dialog);
		assert.match(dialog.shadowRoot.querySelector('.source-status').textContent, /Ready to open/,
			'the deployment’s own public address is still accepted');
		assert.match(dialog.shadowRoot.textContent, /From thecompendium\.cards, opened in this app/);
		assert.doesNotMatch(dialog.shadowRoot.textContent, /canonical form/);

		//A same-origin route keeps the copy it had.
		input.value = '';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
		input.value = '/c/main/starred/';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
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
			await settleRender(dialog);
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
		await settleRender(dialog);
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
		await settleRender(dialog);
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit visually')).click();
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.composer-actions .primary').click();
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/everything/starred/card-42');
	});

	//SUPERSEDED PIN (round 3, D1). This was 'undoes a Source collection and
	//selected-card suffix atomically': after Edit visually carried a Source route
	//into the draft, the in-dialog Undo had to restore BOTH halves — description
	//and selected card — or a half-undo would navigate to /c/card-42. That Undo
	//is deleted with the receipt strip; the reset that replaced it is Escape, and
	//it is atomic by construction because it discards the whole draft rather than
	//stepping one edit back.
	it('discards a Source collection and its selected-card suffix together', async () => {
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		window.history.replaceState({}, '', '/c/main/');
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: 'source' });
		await dialog.updateComplete;
		await dialog.updateComplete;
		const input = dialog.shadowRoot.querySelector('#collection-source-input');
		input.value = '/c/everything/starred/card-42';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
		Array.from(dialog.shadowRoot.querySelectorAll('button'))
			.find((button) => button.textContent.includes('Edit visually')).click();
		await dialog.updateComplete;
		//THE RESET IS THE UNDO. Escape at the top level closes without
		//committing, and the next open begins from the collection on screen —
		//both halves gone together, because there is only one thing to discard.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await dialog.updateComplete;
		await dialog.updateComplete;
		dialog.shadowRoot.querySelector('.composer-actions .primary').click();
		await dialog.updateComplete;
		//Undo restored both halves, so the draft is the bare default view — which
		//the composer seeds from the sticky starting set when it opens (round-3
		//tightness, M6), so the primary opens what the sentence has been saying
		//since the first frame. (This used to assert '/c/main/', on the old
		//contract where the rewrite waited for the first edit; before that it
		//asserted '/c/', the same collection spelled differently.) A half-undo --
		//description restored but card-42 still attached -- would still show up
		//here, as a navigation carrying /card-42.
		assert.strictEqual(window.location.pathname, '/c/everything/');
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
		await settleRender(dialog);
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

		//The completion index's world is assembled once per render rather than
		//once per call, and its identity is the memo key for both of the calls
		//that consume it.
		const context = dialog._completionContext;
		assert.strictEqual(dialog._completionContext, context);

		//The draft's expression is a VIEW of the description, memoized on the
		//description's identity — so the sentence, the pill row and the index are
		//handed the same array and Lit's dirty check can do its job.
		const expression = dialog._draftExpression;
		assert.strictEqual(dialog._draftExpression, expression);

		//A KEYSTROKE DOES NOT REBUILD THE WORLD. The context is derived from
		//STATE — the corpus's candidates, the recents, the tag prose — none of
		//which a keypress changes; only the token does, and the token is passed
		//separately. That is what keeps a per-character index affordable.
		const rowsBefore = dialog._paletteRows;
		await typeComposer('star');
		assert.strictEqual(dialog._completionContext, context,
			'typing does not rebuild the index’s whole world');
		assert.notStrictEqual(dialog._paletteRows, rowsBefore,
			'but the list it produces is a different list');
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
			await settleRender(dialog);
			assert.strictEqual(dialog._previewCounts[dialog._draftPreviewID], 1307,
				'typing must not blank the count of a collection that did not change');
			assert.strictEqual(dialog._draftCountPending, false);
			assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim(),
				'Matches 1307 cards');

			//Changing the DRAFT is a different collection, so the count is genuinely
			//unknown — and says so, rather than silently reading as "no data".
			const starredRow = suggestionRows().find((button) => rowText(button).includes('Starred'));
			assert.ok(starredRow, `no Starred row: ${suggestionLabels().join(' | ')}`);
			starredRow.click();
			await settleRender(dialog);
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
		const list = dialog.shadowRoot.querySelector('#collection-palette-list');
		assert.ok(list);
		assert.ok(list.querySelectorAll('[role="option"]').length);
		//THE HEADINGS ARE THE THING THIS RULE HAD TO SURVIVE. A run of rows under
		//one heading used to be wrapped in a role=group; the palette emits the
		//heading as a sibling instead, so nothing sits between the listbox and
		//its options at all.
		assertListboxOwnership(list);

		browseAll().click();
		await settleRender(dialog);
		const browse = dialog.shadowRoot.querySelector('#collection-palette-list');
		assert.ok(browse.querySelectorAll('[role="option"]').length);
		assertListboxOwnership(browse);
	});

	//aria-controls naming an element that is not in the document is a dangling
	//reference; the composer renders a plain empty-state line, not a listbox,
	//when nothing matches.
	it('only points aria-controls at a listbox that is rendered', async () => {
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		const controls = input.getAttribute('aria-controls');
		assert.ok(controls && dialog.shadowRoot.querySelector(`#${controls}`),
			`aria-controls names a missing #${controls}`);

		//The empty branch renders a plain line instead of a listbox. Real corpus
		//state always produces at least the literal reading of the token, so the
		//branch is driven directly rather than reached by typing something the
		//composer refuses to interpret.
		Object.defineProperty(dialog, '_paletteRows', { get: () => [], configurable: true });
		dialog.requestUpdate();
		await dialog.updateComplete;
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-palette-list'), null);
		assert.strictEqual(input.getAttribute('aria-controls'), null);
		delete dialog._paletteRows;
	});

	//NEGATION IS LANGUAGE, NOT A TOGGLE ON A ROW.
	//
	//The catalog's Not toggle is deleted with the catalog. What replaced it is
	//the pill's own Invert verb, and the app's own inverse NAMES: inverting
	//`starred` produces the filter `unstarred` — a word — rather than an
	//operator wrapped around the clause. The `-` key does the same thing from
	//the input, and it is deliberately the URL's own spelling for exclusion.
	//
	//The verb says INVERT (owner, F2). It said 'Flip', which named the gesture;
	//the title beside it was already naming the result, and now they agree.
	it('inverts a clause to the app’s own inverse word, from the row and from the key', async () => {
		await addRefineRow('Starred');
		sentencePills()[0].click();
		await settleRender(dialog);
		const invert = pillRowVerb('Invert');
		assert.ok(invert, 'every pill offers the inversion');
		assert.ok(!pillRowVerb('Flip'), 'and the gesture word is gone');
		assert.match(invert.getAttribute('title'), /Unstarred/,
			'and it promises which word the pill will read, before it is pressed');
		invert.click();
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['unstarred'],
			'the app’s own inverse name, not exclude/starred');
		assert.match(pillLabels().join(' '), /Unstarred/);

		//And back again, from the key the footer teaches.
		await pressComposer('-');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred'],
			'inverting is an involution');
		//SUPERSEDED (owner, F4): the footer used to name '-' from
		//PILL_ROW_KEY_HINTS. The key still inverts — which is what the two
		//assertions above just proved — but nothing narrates it.
	});

	//AND THE OTHER HALF OF THE KEYBOARD GRAMMAR: `+` asks for an alternative,
	//which scopes the input to one condition, and an accepted candidate fuses
	//into the group rather than being ANDed alongside it.
	it('widens a clause with an or, from the + key and through a scoped input', async () => {
		await addRefineRow('Starred');
		await pressComposer('Backspace');
		assert.deepStrictEqual([...dialog._selectedPath], [0]);
		await pressComposer('+');
		assert.ok(dialog._orTarget, 'the input is now scoped to that condition');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		assert.match(input.getAttribute('placeholder'), /Also match/,
			'and it says which question it is asking');
		//SUPERSEDED PIN (round 3, D1 → owner, F4). It said 'Tab widens the
		//clause', then 'Enter widens the clause'; now it says nothing, because
		//the or-scoped layer has no footer line either. The placeholder asserted
		//just above is what tells the user which question is being asked.
		await typeComposer('unread');
		const rows = suggestionRows();
		assert.ok(rows.length, 'the alternatives are the list');
		assert.ok(rows.every((button) => (button.dataset.rowId || '').includes(':or:')),
			'every row is an alternative joining that condition');
		//The row says what it widens in its LABEL ('<target> or <new>'), which is
		//the whole of it now that the second '.row-widens' line is cut (D3).
		assert.match(rowText(rows[0]), / or /, 'and each says what it widens, in its own label');
		rows.find((button) => rowText(button).includes('Unread')).click();
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred+unread'],
			'the two fuse into one condition rather than ANDing');
		assert.strictEqual(dialog._orTarget, null, 'and the scope is spent');
	});

	//THE SCOPED INPUT SAYS WHAT IT IS DOING, AND ESCAPE COSTS NOTHING.
	//
	//Two facts a scoped input has to keep, pinned because both are the kind that
	//rot silently. The placeholder has to name the TARGET, not just announce a
	//mode: "Also match…" alone describes an edit to a sentence with one clause
	//exactly as well as it describes an edit to a sentence with six, which is to
	//say not at all. And Escape peels the scope TOGETHER WITH the text that was
	//scoped to it: those characters were typed to mean "an alternative to this
	//clause", and a scope that closes while they stay makes the list re-read
	//them as a new AND condition — the same words, a different collection, and
	//nothing on screen to say so.
	it('names what an or would widen, and gives the scope back on Escape without re-reading the typing', async () => {
		await addRefineRow('Starred');
		await pressComposer('Backspace');
		await pressComposer('+');
		const input = () => dialog.shadowRoot.querySelector('#collection-composer-input');
		assert.strictEqual(input().getAttribute('placeholder'), 'Also match… (widens Starred)',
			'the placeholder names the clause the alternative would join');

		await typeComposer('unre');
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(dialog._orTarget, null, 'Escape peels the scope');
		//AND THE TYPED TEXT LEAVES WITH THE SCOPE. It was typed to mean "an
		//alternative to Starred"; kept, the very next render re-reads the same
		//four characters as a new AND condition — a different collection, offered
		//under words the user chose to mean something else. Escape peels a layer;
		//it must not silently re-interpret what is left behind.
		assert.strictEqual(dialog._composerInput, '', 'and the text scoped to the or leaves with it');
		assert.strictEqual(input().getAttribute('placeholder'), 'Type another condition…',
			'the input is back to continuing the sentence');
		assert.deepStrictEqual([...dialog._selectedPath], [0],
			'and the pill it was opened from is still the selected one');
	});

	//A SCOPE YOU CAN SEE, AND A DOOR YOU CAN PRESS (owner, F5).
	//
	//The placeholder pinned above was, until this fix, the ONLY thing on screen
	//that said the input was scoped — and a placeholder is visible for exactly as
	//long as the box is empty, which is to say until the moment the user starts
	//using the mode it describes. Type two characters into an or-scope and the
	//composer looked identical to top level while behaving nothing like it, with
	//the only exit being a key nothing advertised.
	//
	//Three things are pinned, because each fails differently: the indicator is
	//THERE, it SURVIVES typing (which is the whole defect), and its ✕ runs the
	//same routine Escape runs — including taking the scoped text with it.
	it('shows the or-scope as a dismissible context, and the ✕ is Escape', async () => {
		await addRefineRow('Starred');
		await pressComposer('Backspace');
		await pressComposer('+');
		const indicator = () => dialog.shadowRoot.querySelector('.scope-indicator');
		assert.ok(indicator(), 'the scope is visible, not merely implied by a placeholder');
		assert.match(indicator().textContent.replace(/\s+/g, ' '), /Also matching with Starred/,
			'and it names the clause, in the words of the verb that opened it');

		await typeComposer('unre');
		assert.ok(indicator(), 'and it is still there once the placeholder is gone — the whole point');

		const dismiss = dialog.shadowRoot.querySelector('.scope-dismiss');
		assert.ok(dismiss.getAttribute('title'), 'icon-only, so it carries a title');
		assert.ok(dismiss.getAttribute('aria-label'), 'and an accessible name (HS §2.5)');
		dismiss.click();
		await settleRender(dialog);
		assert.strictEqual(dialog._orTarget, null, 'pressing it leaves the scope');
		assert.strictEqual(dialog._composerInput, '',
			'and takes the scoped text with it, exactly as Escape does');
		assert.strictEqual(indicator(), null, 'and the context is gone with the scope');
		assert.strictEqual(
			dialog.shadowRoot.querySelector('#collection-composer-input').getAttribute('placeholder'),
			'Type another condition…',
			'and the input is back to continuing the sentence');
	});

	//THE WORD SCOPE TAKES THE SAME PATTERN, and for the same reason rather than
	//for symmetry: it is equally a mode, its only marker was a list heading that
	//scrolls, and it was equally exited by an invisible key. Its typed text
	//STAYS, because a word scope's characters filter a list of sorts and mean the
	//same thing outside it — which is exactly what Escape has always done, and
	//the ✕ must not have its own opinion.
	it('shows the word scope the same way, and its ✕ is Escape too', async () => {
		dialog.shadowRoot.querySelector('button.order-word').click();
		await settleRender(dialog);
		assert.strictEqual(dialog._wordScope, 'sort');
		const indicator = () => dialog.shadowRoot.querySelector('.scope-indicator');
		assert.ok(indicator(), 'the word scope says it is a scope');
		assert.match(indicator().textContent.replace(/\s+/g, ' '), /Choosing the order/);

		dialog.shadowRoot.querySelector('.scope-dismiss').click();
		await settleRender(dialog);
		assert.strictEqual(dialog._wordScope, '', 'and the ✕ leaves it');
		assert.strictEqual(indicator(), null);
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
		await settleRender(dialog);
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
		assert.match(snackbars[0].message, /Now showing Everything · Starred/,
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
		assert.ok(!/Everything · Starred/.test(snackbars[0].message),
			'a landing the user did not ask for must not be reported as the one they did');
		assert.match(snackbars[0].message, /^Now showing Main · Has any TODO\./,
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
		await settleRender(dialog);
		const row = suggestionRows().find((button) => rowText(button).includes('Starred'));
		assert.ok(row, 'the Starred row is what this test navigates with');
		row.click();
		await settleRender(dialog);
		await countingPushes(async (pushed) => {
			dialog.shadowRoot.querySelector('.composer-actions .primary').click();
			await dialog.updateComplete;
			assert.deepStrictEqual(pushed, ['/c/everything/starred/'],
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
		//SUPERSEDED PIN (round 3, D1). The note used to end 'Enter opens here.'
		//Plain Enter no longer opens — it executes the top action — so the
		//refusal names the key that does, and it names it from the canonical
		//combo table rather than spelling a Mac-only '⌘Enter' by hand.
		assert.match(note.textContent, /Opening in a new tab isn’t supported — (Cmd|Ctrl)-Enter opens here\./);
		//And the commit modifier still commits, so the note is about Shift, not a
		//new refusal of the key itself. Plain Enter first, which now EXECUTES the
		//top action rather than navigating; the commit is the second keystroke.
		pressEnter(input);
		await settleRender(dialog);
		assert.strictEqual(window.location.pathname, '/c/main/', 'plain Enter does not navigate');
		pressEnter(input, { ctrlKey: true });
		await dialog.updateComplete;
		assert.strictEqual(window.location.pathname, '/c/everything/starred/');
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
		await settleRender(dialog);
		assert.match(rowText(highlightedRow()), /Starred/);
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

	//THE PILL ROW IS ATTACHED TO THE SENTENCE, AND IT CANNOT SQUASH.
	//
	//REWRITTEN, not deleted. The property this test defended is unchanged — the
	//'Editing Updated between…' panel measured 262px inside a 720px dialog and
	//ran past its bottom, .composer-actions hit-tested ABOVE both date inputs,
	//and its own action row rendered where nothing paints — but the structure
	//that defends it has changed shape entirely. A one-line row has no height to
	//budget, no inner scroller to keep its action row out of, and no floor to
	//take from the list; it is one line under the sentence, and the whole class
	//of defect the anchored slot's cap existed for is gone with the panel.
	//
	//What still has to be true: the row renders directly under the sentence, the
	//footer is outside it and after it, and every verb the row offers is inside
	//the dialog.
	it('anchors the pill row under the sentence, with the footer out of its flow', async () => {
		await typeComposer('star');
		await pressComposer('Tab');
		sentencePills()[0].click();
		await settleRender(dialog);

		const row = dialog.shadowRoot.querySelector('.pill-row');
		assert.ok(row, 'the pill row must be on screen');

		//ATTACHED TO THE SENTENCE: its immediately preceding sibling is the
		//sentence itself, so no list, heading or message can come between a pill
		//and the row it opened.
		const sentence = dialog.shadowRoot.querySelector('.sentence');
		assert.ok(sentence);
		assert.strictEqual(row.previousElementSibling, sentence,
			'the row must render directly under the pill that opened it');

		const footer = dialog.shadowRoot.querySelector('.buttons.composer-actions');
		assert.ok(footer);
		assert.strictEqual(footer.closest('.pill-row'), null,
			'the footer must be outside the row, never a sibling it can paint over');
		assert.ok(footer.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING,
			'and it must come after it, so its room is reserved rather than borrowed');

		const styles = composerStyles();
		assert.match(styles, /\.buttons\.composer-actions\s*\{[^}]*flex:\s*0 0 auto/,
			'the footer never shrinks to make room for an editor');
		//THE BOUNDING MACHINERY IS GONE WITH THE PANELS IT BOUNDED. A one-row
		//editor cannot squash, so nothing has to negotiate a height with it.
		for (const dead of ['data-editor-open', 'clause-editor-body', 'pending-filter-body', 'builder-catalog']) {
			assert.ok(!styles.includes(dead), `${dead} is deleted, and so is its CSS`);
		}
		assert.ok(!dialog.hasAttribute('data-editor-open'),
			'and the attribute the deleted rules keyed off is not set either');
	});

	//Seeds a draft without going through the list, for the tests below whose
	//subject is the row rather than how the clause got there.
	const seedDraft = async (source) => {
		const { updateCollectionConfigurationSnapshot } = await import('../../lib/src/actions/collection.js');
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize(source)));
		await settleRender(dialog);
	};

	const openPillRow = async (index = 0) => {
		const pills = sentencePills();
		assert.ok(pills[index], `there is a pill ${index} to edit`);
		pills[index].click();
		await settleRender(dialog);
		const row = pillRow();
		assert.ok(row, 'the row opened');
		await settleRender(dialog, row);
		return row;
	};

	//The real date control, two shadow roots down, settled.
	const rowDateControl = async () => {
		const row = pillRow();
		assert.ok(row, 'the row holds the clause’s controls');
		await settleRender(dialog, row);
		const date = row.shadowRoot.querySelector('configure-collection-date');
		assert.ok(date, 'the row holds a date control');
		await settleRender(dialog, row, date);
		return date;
	};

	//ONE EDIT PER OPENING WAS THE WHOLE COST.
	//
	//_commitDraftEdit clears the selection, because for every other way the draft
	//changes the selected clause is no longer what the user is pointing at. A
	//clause edit is the one change that comes FROM the selected clause, so it
	//closed the editor on the field that had just been changed: the audited
	//session set the start of a date window, watched the panel vanish, and had to
	//re-open it to set the end.
	it('keeps the pill row open across field edits', async () => {
		await seedDraft('everything/updated/between/2026-01-01/2026-02-01/');
		await openPillRow();

		const setDate = async (label, value) => {
			const date = await rowDateControl();
			const input = date.shadowRoot.querySelector(`[aria-label="${label}"]`);
			assert.ok(input, `the ${label} field is on screen`);
			input.value = value;
			input.dispatchEvent(new Event('change', { bubbles: true }));
			await settleRender(dialog);
		};

		await setDate('First fixed date', '2026-01-15');
		assert.ok(pillRow(), 'changing one date must not close the row');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
			['updated/between/2026-01-15/2026-02-01'],
			'and the change reaches the draft immediately');
		assert.deepStrictEqual([...dialog._selectedPath], [0],
			'the row is still on the clause it was editing');

		//THE SECOND FIELD, without re-opening anything. This is the step the
		//audited session could not take.
		await setDate('Second fixed date', '2026-03-01');
		assert.ok(pillRow(), 'still open');
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
			['updated/between/2026-01-15/2026-03-01'],
			'both edits are in the draft');

		//The list is still on screen beside the open row — a one-line editor
		//takes nothing from it.
		assert.ok(dialog.shadowRoot.querySelector('.palette-list [role="option"]'),
			'the list stays readable while a row is open');

		//And it closes when the user says so, not before.
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		await settleRender(dialog);
		assert.strictEqual(pillRow(), null, 'Escape closes it');
		//The pill says what the clause now is.
		assert.match(pillLabels().join(' '), /2026-01-15/);
		assert.match(pillLabels().join(' '), /2026-03-01/);
	});

	//TEACH THROUGH CONSEQUENCE, AT THE MOMENT OF CHOICE (spec §8, §Count
	//preview). Choosing values with no idea what they yield is an act of faith;
	//the count that answers it belongs in the row, next to the values, and it has
	//to move when they do. Driven through the component's own retained-count
	//cache, the way the keystroke-retention test above drives it.
	it('runs a live count inside the pill row as its values change', async () => {
		window.localStorage.setItem('collection-composer-preview', 'on');
		try {
			await seedDraft('everything/updated/between/2026-01-01/2026-02-01/');
			const known = (count) => {
				dialog._retainedPreviewCounts.set(dialog._previewCountKey(dialog._collectionDescription), count);
				dialog._refreshPreviewCounts();
			};
			const footerCount = () => dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent;
			known(57);
			await openPillRow();
			//THE FOOTER STATES THE DRAFT BESIDE THE BUTTON THAT OPENS IT, and the
			//row states it as the WITH side of its own consequence (owner, F2 —
			//this pin previously asserted the row said nothing about it at all).
			//What this test is about is unchanged: the count is LIVE, it moves
			//when the values do, and it comes through the component's own retained
			//cache.
			assert.match(footerCount(), /57 cards/);
			assert.doesNotMatch(pillRowText(), /draft now matches/,
				'and never in the superseded one-sided phrasing');

			//Changing a value makes it a different collection, so the number is
			//genuinely unknown — and the row omits the WHOLE consequence rather
			//than showing a stale side, a zero, or half a transition.
			const date = await rowDateControl();
			const input = date.shadowRoot.querySelector('[aria-label="First fixed date"]');
			input.value = '2026-01-15';
			input.dispatchEvent(new Event('change', { bubbles: true }));
			await settleRender(dialog);
			assert.ok(pillRow(), 'the row is still open');
			assert.doesNotMatch(pillRowText(), /removing this/,
				'a number in this row is a promise about a collection, and there is nothing honest to say yet');

			//And the answer for the new values lands in the same place.
			known(12);
			await settleRender(dialog, pillRow());
			assert.match(footerCount(), /12 cards/);
		} finally {
			window.localStorage.removeItem('collection-composer-preview');
			dialog._retainedPreviewCounts.clear();
		}
	});

	//THE SECOND COUNT ROLE, AND WHAT IT REPLACED. "Remove X" was a whole class of
	//suggestion row whose only job was to answer "what would this collection be
	//without that clause?" — asked in a list, about a clause the user had to find
	//again. It is answered here, beside the pill, and it is a real preview of a
	//real different collection rather than a row that undoes a choice.
	it('previews the collection without the selected pill, from the row itself', async () => {
		window.localStorage.setItem('collection-composer-preview', 'on');
		try {
			await seedDraft('everything/starred/updated/after/7-days-ago/');
			await openPillRow(1);
			const { collectionDescriptionWithFilterRemoved } = await import('../../lib/src/collection_description.js');
			const without = collectionDescriptionWithFilterRemoved(dialog._collectionDescription, 1);
			dialog._retainedPreviewCounts.set(dialog._previewCountKey(dialog._collectionDescription), 57);
			dialog._retainedPreviewCounts.set(dialog._previewCountKey(without), 1842);
			dialog._refreshPreviewCounts();
			await settleRender(dialog, pillRow());
			//The fact is in the footer, beside the button that acts on it; the
			//prediction is here, stated AGAINST that fact (owner, F2) because a
			//prediction with nothing to compare it to is just a number.
			assert.match(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent, /57 cards/, 'the fact');
			assert.match(pillRowText(), /removing this: 57 cards → 1842 cards/, 'and the consequence, both sides');
			assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
				['starred', 'updated/after/7-days-ago'],
				'and asking the question has changed nothing');

			//Moving the selection asks a different question, about a different
			//collection.
			await openPillRow(0);
			const withoutFirst = collectionDescriptionWithFilterRemoved(dialog._collectionDescription, 0);
			dialog._retainedPreviewCounts.set(dialog._previewCountKey(withoutFirst), 96);
			dialog._refreshPreviewCounts();
			await settleRender(dialog, pillRow());
			assert.match(pillRowText(), /removing this: 57 cards → 96 cards/);
		} finally {
			window.localStorage.removeItem('collection-composer-preview');
			dialog._retainedPreviewCounts.clear();
		}
	});

	//THE KEYBOARD CLAUSE-SELECTION FLOW COULD NOT REACH WHAT IT SELECTED.
	//
	//Backspace selects the last clause and ←→ move between them, but Enter fell
	//through to the generic commit — with nothing highlighted that opens the
	//current draft, and selecting a clause does not change the draft, so 'open'
	//meant 'close the composer'. The one obvious key threw the session away.
	it('opens the pill row’s controls when Enter activates a selected clause', async () => {
		await seedDraft('everything/starred/updated/between/2026-01-01/2026-02-01/');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.focus();
		//Arrow into the list first: selecting a clause has to take the highlight
		//back from it, or two things read as selected and only one is what Enter
		//takes.
		await pressComposer('ArrowDown');
		assert.ok(highlightedRow(), 'a row is highlighted');
		await pressComposer('Backspace');
		assert.deepStrictEqual([...dialog._selectedPath], [1], 'the last clause is selected');
		assert.strictEqual(highlightedRow(), null,
			'and the list gives up its highlight, so Enter is unambiguous');
		//SUPERSEDED (owner, F4): the footer used to name this key before it was
		//pressed. What the key does is asserted below, which is the pin that
		//matters.

		await pressComposer('Enter');
		await settleRender(dialog, pillRow());
		assert.strictEqual(dialog.open, true,
			'Enter on a selected clause must not close the composer');
		assert.strictEqual(window.location.pathname, '/c/main/', 'and must not navigate');
		assert.match(pillRowText(), /Updated/, 'the row is about the clause it had selected');

		//FOCUS LANDS ON THE FIRST CONTROL, the same way it does when a family is
		//chosen by name — the same focusPrimaryControl path, reached from the
		//keyboard.
		assert.strictEqual(dialog.shadowRoot.activeElement, pillRow(),
			'focus is inside the row that just opened');
		assert.ok(pillRow().shadowRoot.activeElement?.closest('configure-collection-date'),
			'and specifically in the clause’s own first control');
	});

	//THE DIALOG'S BOX MUST NOT MOVE UNDER A KEYSTROKE.
	//
	//Live review measured the composer's content box at 512px, 896px and 567px
	//on three consecutive characters of one session: .content sizes to its
	//content horizontally between min-width:40% and max-width:70%, and
	//.background centres it, so every re-measure moved the left edge of the
	//input the user was typing into. The HEIGHT pin is gone with the workspace
	//it was for (see 'sizes itself as a light palette'); the width pin is not,
	//because the defect it prevents is unchanged. JSDOM computes no layout, so
	//what is pinned is the rule that makes the resize impossible.
	it('pins the composer dialog’s width, so typing cannot move it', async () => {
		const styles = composerStyles();
		//Anchored on the custom property, because DialogElement's own .content
		//rule is in the same concatenated sheet and comes first.
		const content = styles.match(/\.content\s*\{[^}]*--composer-width[^}]*\}/);
		assert.ok(content, 'the composer must have its own .content rule');
		for (const property of ['width', 'min-width', 'max-width']) {
			assert.match(content[0], new RegExp(`[;{]\\s*${property}:\\s*var\\(--composer-width\\)`),
				`${property} must take the pinned width, or the base rule's percentages re-enter and the box sizes to content again`);
		}
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
		assert.match(styles, /\.palette-row/, 'the last sheet must be the composer\'s own');
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
		assert.match(gate[0], /\.palette-row button,[\s\S]*?\{[^}]*transition:/);
		//The revealed layer is the PILL ROW: the anchored slot and both panels
		//that rendered into it are deleted, and the one-line row is what appears
		//in their place. Same moment, same keyframes.
		assert.match(gate[0], /\.builder,\s*\.pill-row\s*\{[^}]*animation:/);
		//And nothing animated is a layout property — the box and the row
		//columns were pinned precisely so nothing moves under a keystroke.
		for (const property of ['width', 'height', 'margin', 'padding', 'grid-template', 'flex']) {
			assert.ok(!new RegExp(`(transition|animation):[^;]*\\b${property}\\b`).test(gate[0]),
				`${property} is a layout property and must not be animated`);
		}
	});

	//THE COMPOSER RENDERS NO KEY-HINTS LINE, IN ANY STATE (owner, F4).
	//
	//SUPERSEDED PINS — THREE OF THEM, AND THIS ONE REPLACES ALL THREE:
	//
	//  1. 'states one contract, in the same words on every row'. It pinned the
	//     line /^Enter does the top thing · (Cmd|Ctrl)-Enter opens · Escape
	//     discards$/ across a destination, a refinement and a configurable
	//     family, and pinned that it said nothing else. (That pin had itself
	//     superseded a four-state one, from a list whose rows did different
	//     KINDS of thing.)
	//  2. 'states a contract the reader’s own input can actually keep'. It
	//     pinned the touch copy ('Tap a row to use it · tap the open button for
	//     this collection') behind a (hover: none) matchMedia stub, and pinned
	//     that a merely SMALL window kept the keyboard copy.
	//  3. 'names the pill row’s own keys, from the module that performs them'. It
	//     pinned '←→ choose clause' plus every entry of PILL_ROW_KEY_HINTS plus
	//     'closes the row', so the line that taught the keys and the row that
	//     performed them could not drift.
	//
	//The owner, of the line all three were about: "this text … is unnecessary."
	//So the element is gone in every state the composer has — idle, typed,
	//word-scoped, or-scoped, pill-row-open, armed Backspace, touch — and what is
	//pinned is its ABSENCE, because deleting only the main-state copy would leave
	//a line that appeared the moment you touched a pill.
	//
	//THE CONTRACT ITSELF IS STILL PUBLISHED. Both keys the line named are
	//declareShortcut entries — 'commit-collection-composer' in this dialog's own
	//module and 'dialog-escape' in dialog-element — so the shortcut sheet renders
	//them, with the same platform-correct spelling, for every dialog in the app.
	//That is asserted here too: the sheet is the survivor, and if it stopped
	//carrying them the deletion would have cost the user something.
	it('renders no key-hints line, in any state', async () => {
		const line = () => dialog.shadowRoot.querySelector('.key-hints');
		await seedRecents([['main/starred/sort/recent/', 2]]);
		assert.strictEqual(line(), null, 'idle');

		await pressComposer('ArrowDown');
		assert.ok(highlightedRow(), 'a row is highlighted');
		assert.strictEqual(line(), null, 'with a row highlighted');

		await typeComposer('star');
		assert.strictEqual(line(), null, 'while typing');
		await typeComposer('');

		//THE PILL ROW, and the armed Backspace that opens it: the two states that
		//used to grow their own line.
		const { updateCollectionConfigurationSnapshot } = await import('../../lib/src/actions/collection.js');
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize('everything/starred/')));
		await settleRender(dialog);
		await pressComposer('Backspace');
		assert.deepStrictEqual([...dialog._selectedPath], [0], 'a clause is selected');
		assert.ok(pillRow(), 'and its row is open');
		assert.strictEqual(line(), null, 'with the pill row open, and with Backspace armed');

		//THE OR SCOPE.
		await pressComposer('+');
		assert.ok(dialog._orTarget, 'the input is scoped to that condition');
		assert.strictEqual(line(), null, 'in the or scope');
		dialog._orTarget = null;
		await settleRender(dialog);

		//THE WORD SCOPE.
		dialog._wordScope = 'set';
		await settleRender(dialog);
		assert.strictEqual(line(), null, 'in the word scope');
		dialog._wordScope = '';
		await settleRender(dialog);

		//AND NO TOUCH VARIANT EITHER, because there is no line to have variants
		//of. Both the function that spelled the copy and the pointer read that
		//chose between its two versions are DELETED, not merely unrendered — an
		//unrendered string is a thing the next change can put back by accident.
		assert.strictEqual(typeof dialog._composerKeyHints, 'undefined',
			'the function that spelled the line is gone');
		assert.strictEqual(typeof dialog._touchInput, 'undefined',
			'and so is the pointer read that existed only to choose its copy');

		//THE KEYS ARE STILL PUBLISHED WHERE THE APP PUBLISHES KEYS.
		const { describeShortcuts } = await import('../../lib/src/shortcuts.js');
		const catalogued = describeShortcuts().map((entry) => entry.id);
		for (const id of ['commit-collection-composer', 'dialog-escape']) {
			assert.ok(catalogued.includes(id),
				`${id} must stay in the shortcut sheet: ${catalogued.join(', ')}`);
		}
	});

	//SUPERSEDED PIN (round 8). This was 'names the first few cards the draft
	//matches, beneath the count' — the `·`-joined titles strip and the two
	//refinements round 3 gave it (consecutive repeats collapse; a strip naming
	//fewer than two distinct titles is dropped). The owner has now rejected the
	//whole idea:
	//
	//  "The preview of cards at the bottom is confusing and not useful. I'd
	//   expect to see something like 'matches nn cards' and then some way to
	//   expand it and see a list of the first 100 or so with card-links so
	//   hovers work"
	//
	//Round 3's own critic had voted to cut the strip outright and was overruled
	//by the owner asking for it; this is the owner asking for something else.
	//The strip is DELETED, not merely unrendered — the renderer, the limit
	//constant and the CSS class all go, so the next change cannot put it back by
	//accident. What replaces it is pinned in the three tests below.
	it('renders no titles strip, in any state', async () => {
		const strip = () => dialog.shadowRoot.querySelector('.preview-titles');
		const draftKey = dialog._previewCountKey(dialog._collectionDescription);
		dialog._cardTagInfos = {
			'card-a': { id: 'card-a', title: 'Perf card 12' },
			'card-b': { id: 'card-b', title: 'What is this?' },
			'card-c': { id: 'card-c', title: 'Third one' },
		};
		dialog._previewCounts = { [dialog._draftPreviewID]: 121 };
		dialog._rememberPreviewIDs(draftKey, ['card-a', 'card-b', 'card-c', 'card-d']);
		await settleRender(dialog);
		assert.strictEqual(strip(), null, 'with names, a count and loaded titles, there is still no strip');
		assert.strictEqual(typeof dialog._previewTitlesRender, 'undefined',
			'the renderer that spelled the line is gone');
		const styles = composerStyles();
		assert.ok(!/\.preview-titles/.test(styles), 'and so is its CSS');
		dialog._retainedPreviewIDs.clear();
	});

	//THE COUNT LINE SAYS WHAT IT COUNTS (owner, round 8: "something like
	//'matches nn cards'").
	//
	//'Matches' is the app's own verb for this, not a phrasing invented here:
	//filters.ts spells the none filter's description 'Matches no cards', and the
	//number itself is still formatCollectionCardCount, so the compact threshold
	//and the singular are decided in one place for the whole app.
	//
	//AND IT IS THE ONLY COUNT ON THE SURFACE. The footer readout BECAME this
	//line; nothing was added beside it.
	it('counts the draft’s matches in the app’s own words, once', async () => {
		const count = () => dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim();
		dialog._previewCounts = { [dialog._draftPreviewID]: 792 };
		await settleRender(dialog);
		assert.strictEqual(count(), 'Matches 792 cards');

		dialog._previewCounts = { [dialog._draftPreviewID]: 1 };
		await settleRender(dialog);
		assert.strictEqual(count(), 'Matches 1 card', 'the singular comes from the shared formatter');

		//ONE COUNT PER SURFACE: exactly one readout in the footer, and no second
		//number smuggled in beside it.
		assert.strictEqual(dialog.shadowRoot.querySelectorAll('.composer-actions .action-count').length, 1);

		//AND THE UNRESOLVED CASES ARE UNCHANGED. 'Matches 0 cards' still carries
		//the sentence beside it, and a count that has not arrived claims nothing.
		dialog._previewCounts = { [dialog._draftPreviewID]: 0 };
		await settleRender(dialog);
		assert.strictEqual(count(), 'Matches 0 cards');
		assert.ok(dialog.shadowRoot.querySelector('.composer-actions .no-cards-note'));
		dialog._previewCounts = {};
		dialog._draftCountPending = false;
		await settleRender(dialog);
		assert.strictEqual(count(), '', 'a number that is not in yet is not a claim');
	});

	//THE ZIPPY IS THE APP'S ZIPPY (owner, round 8: "some way to expand it").
	//
	//card-drawer's disclosure, verbatim: a `button.small` carrying
	//ARROW_RIGHT_ICON collapsed and ARROW_DOWN_ICON expanded, with aria-expanded
	//and BOTH a title and an aria-label (HS-2.5 — a wrapper title names no
	//button). Not a new control, and not a <details>.
	//
	//AND IT IS ON THE LEFT OF THE WORDS (round 9). Round 8 shipped it after the
	//count and said so in a comment — "To the RIGHT of the number". The owner:
	//"The zippy for the whole collection is on the rgith but should be omn the
	//left the of the text." card-drawer, the precedent this control was copied
	//from, had the arrow FIRST in its count line all along, so this is the copy
	//being finished rather than a new arrangement. Pinned as DOM order, which is
	//also the reading order for assistive tech.
	it('offers the app’s own zippy on the count line, and flips both halves of it', async () => {
		const toggle = () => dialog.shadowRoot.querySelector('.composer-actions button.small');
		dialog._previewCounts = { [dialog._draftPreviewID]: 792 };
		await settleRender(dialog);

		assert.ok(toggle(), 'the count line carries a control');
		const line = dialog.shadowRoot.querySelector('.composer-actions');
		const order = [...line.children];
		assert.ok(order.indexOf(toggle()) < order.indexOf(line.querySelector('.action-count')),
			'the arrow comes before the words it discloses (owner, round 9)');
		//And nothing has been left behind that pulls the words away from it: the
		//reservation stays, its right-alignment does not.
		assert.match(composerStyles(), /\.composer-actions \.action-count\s*\{[^}]*min-width:\s*7em/,
			'the count still reserves its width, so the arrow does not jitter');
		assert.ok(!/\.composer-actions \.action-count\s*\{[^}]*text-align/.test(composerStyles()),
			'and it no longer pushes its words to the far side of that reservation');
		assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false', 'collapsed on open');
		assert.strictEqual(dialog._matchesExpanded, false);
		assert.strictEqual(toggle().getAttribute('title'), 'Show the matching cards');
		assert.strictEqual(toggle().getAttribute('aria-label'), 'Show the matching cards');
		//ARROW_RIGHT_ICON's path, so a swap to some other glyph fails here.
		assert.ok(toggle().innerHTML.includes('M10 17l5-5-5-5v10z'), 'the collapsed glyph points right');

		toggle().click();
		await settleRender(dialog);
		assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true');
		assert.strictEqual(toggle().getAttribute('title'), 'Hide the matching cards');
		assert.strictEqual(toggle().getAttribute('aria-label'), 'Hide the matching cards');
		assert.ok(toggle().innerHTML.includes('M7 10l5 5 5-5z'), 'and the expanded glyph points down');
		assert.strictEqual(toggle().getAttribute('aria-controls'), 'collection-match-list');

		toggle().click();
		await settleRender(dialog);
		assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');

		//NOTHING TO EXPAND, NO CONTROL. A draft that matches nothing already says
		//so beside the button; an arrow onto an empty list is an offer that lies.
		dialog._previewCounts = { [dialog._draftPreviewID]: 0 };
		await settleRender(dialog);
		assert.strictEqual(toggle(), null);
	});

	//WHAT THE EXPANSION SHOWS (owner, round 8: "a list of the first 100 or so
	//with card-links so hovers work").
	//
	//card-links, because HOVER IS THE POINT: card-link fires the app's card-hover
	//event and main-view's card-preview paints above dialogs, so these get the
	//same preview popup every other link in the app gets. multi-edit-dialog's
	//in-dialog list is the shipped precedent and this is the same line of it:
	//auto='title' (card-link reads the title from the store, and says nothing for
	//a card that has not loaded — an id never reaches a user, HS-1.4) and
	//.noNavigate, because a click must not navigate out from under an
	//uncommitted draft.
	//
	//WHERE IT LIVES, AND WHY. It grows UPWARD from the footer, inside the fixed
	//box: a `flex: 0 0 auto` reservation with its own scroll, paid for out of the
	//ranked list exactly like the pill row. The alternative — taking over the
	//list's region — would have left Enter and the arrow keys operating on a list
	//nobody could see, which is the one thing the spec's highlight MUST forbids.
	it('expands into a scrolling list of card-links, capped at a hundred', async () => {
		const toggle = () => dialog.shadowRoot.querySelector('.composer-actions button.small');
		const pane = () => dialog.shadowRoot.querySelector('.match-list');
		const links = () => Array.from(dialog.shadowRoot.querySelectorAll('.match-list card-link'));
		const draftKey = dialog._previewCountKey(dialog._collectionDescription);

		dialog._previewCounts = { [dialog._draftPreviewID]: 1236 };
		dialog._rememberPreviewIDs(draftKey, Array.from({ length: 250 }, (unused, index) => `card-${index}`));
		await settleRender(dialog);

		//COLLAPSED IS NOT MERELY HIDDEN. A hundred store-connected elements that
		//nobody asked to see is a hundred subscriptions per keystroke.
		assert.strictEqual(pane(), null, 'collapsed by default, and rendering nothing at all');
		assert.strictEqual(links().length, 0);

		toggle().click();
		await settleRender(dialog);
		assert.ok(pane(), 'the list appears');

		//THE OWNER'S HUNDRED, decided in ONE place: the retention slice. The
		//worker's own reply is the whole ordered set (corpus-worker sends
		//result.ids untruncated), so nothing upstream caps it lower.
		assert.strictEqual(dialog._retainedPreviewIDs.get(draftKey).length, 100,
			'the retained head is a hundred, not two hundred and fifty');
		assert.strictEqual(links().length, 100);
		assert.deepStrictEqual(links().slice(0, 3).map((link) => link.getAttribute('card')),
			['card-0', 'card-1', 'card-2'], 'in the collection’s own order');

		//HOVER IS THE POINT, AND A CLICK IS NOT.
		for (const link of links()) {
			assert.strictEqual(link.getAttribute('auto'), 'title',
				'card-link reads the title from the store, so an unloaded card is not named by its id');
			assert.strictEqual(link.noNavigate, true,
				'a click must not navigate out from under an uncommitted draft');
		}

		//THE COUNT STILL TELLS THE TRUTH ABOUT THE WHOLE COLLECTION, and the pane
		//says which part of it this is.
		//No separator under ten thousand: compactCardCount leaves anything a user
		//can hold in their head exact and unabbreviated, and this line takes the
		//app's formatter rather than spelling a number of its own.
		assert.strictEqual(dialog.shadowRoot.querySelector('.composer-actions .action-count').textContent.trim(),
			'Matches 1236 cards');
		assert.match(dialog.shadowRoot.querySelector('.match-list-note').textContent, /first 100/);

		//A COLLECTION SHORTER THAN THE CAP IS SHOWN WHOLE, and says nothing about
		//firsts.
		dialog._previewCounts = { [dialog._draftPreviewID]: 3 };
		dialog._rememberPreviewIDs(draftKey, ['card-a', 'card-b', 'card-c']);
		await settleRender(dialog);
		assert.strictEqual(links().length, 3);
		assert.strictEqual(dialog.shadowRoot.querySelector('.match-list-note'), null);

		//IT IS ABOVE THE FOOTER COUNT THAT DISCLOSES IT, growing upward into the
		//room the ranked list gives up.
		const actions = dialog.shadowRoot.querySelector('.buttons.composer-actions');
		assert.ok(pane().compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the list is above the line that counts it');

		//AND THE BOX DOES NOT GROW TO HOLD IT. JSDOM computes no layout, so this
		//is pinned on the rule: a capped reservation that SHRINKS.
		//
		//0 1 auto, not the column's usual 0 0 auto. The ranked list pays first —
		//a flex deficit goes in proportion to what each item asked for, and the
		//list asks for far more than the peek — but the list has a 5em floor, and
		//an unshrinkable peek would push whatever is left onto #inner and start
		//scrolling the input off the top of the dialog. Measured live at 1280x720
		//before this changed: #inner scrollHeight 553 against clientHeight 508.
		const styles = composerStyles();
		const bodies = [...styles.matchAll(/\.match-list\s*\{([^}]*)\}/g)].map((match) => match[1]);
		const capped = bodies.find((body) => /max-height/.test(body));
		assert.ok(capped, 'the peek is capped, so it cannot push the footer anywhere');
		assert.match(capped, /flex:\s*0 1 auto/, 'and it gives room back rather than overflowing the box');
		assert.match(capped, /min-height:\s*0/, 'which a flex item cannot do without this');
		//And the hundred scroll inside it through the SHARED scroller (#759): a
		//dialog subclass never declares its own overflow.
		assert.ok(pane().classList.contains('scroller'), 'the peek scrolls through the shared idiom');

		//AND THE ROWS ARE THE ROWS OF THE LIST THIS ONE COPIES (round 9). The
		//owner: "There's too much spacing between the card-links in teh expanded
		//zippy." Round 8 gave the `li` a `padding: 0.25em 0` — 8px per row on top
		//of the line box — which neither shipped card-link list has. The fix is
		//the DELETION, so this pins the absence: reference-block (card-info panel)
		//and multi-edit-dialog both style their `li` not at all and let the line
		//box set the pitch. Measured live: reference-block's rows are 24px, and
		//this pane's were 31.5px before this and are 24px after. JSDOM computes no
		//layout, so the pin is on the rule.
		const liBodies = [...composerStyles().matchAll(/\.match-list li\s*\{([^}]*)\}/g)].map((match) => match[1]);
		for (const body of liBodies) {
			assert.ok(!/padding|margin|line-height/.test(body),
				`.match-list li must not set its own row spacing; the shipped card-link lists set none: ${body}`);
		}
		//And the precedent is real on both sides, so this cannot pass by agreeing
		//with itself if those lists ever grow a row rule of their own.
		for (const name of ['reference-block.ts', 'multi-edit-dialog.ts']) {
			const source = await readFile(path.join(REPO_ROOT, 'src/components', name), 'utf8');
			assert.match(source, /<li><card-link auto='title'/, `${name} must still be a card-link list`);
			assert.ok(!/\bli\s*\{[^}]*(padding|margin-top|margin-bottom|line-height)/.test(source),
				`${name} sets no per-row spacing, which is why the composer's peek sets none either`);
		}

		//THE RANKED LIST IS STILL RENDERED UNDERNEATH, which is what keeps Enter,
		//Tab and the arrow keys operating on rows the user can see.
		assert.ok(dialog.shadowRoot.querySelector('.palette-list'), 'the one list is still there');

		//TYPING TAKES THE ROOM BACK. A keystroke is a new question asked of the
		//ranked list, and the peek is being paid for out of that list's height.
		await typeComposer('star');
		assert.strictEqual(dialog._matchesExpanded, false, 'typing collapses the peek');
		assert.strictEqual(pane(), null);
		await typeComposer('');

		//AND A FRESH SESSION OPENS COLLAPSED.
		dialog._previewCounts = { [dialog._draftPreviewID]: 1236 };
		await settleRender(dialog);
		dialog.shadowRoot.querySelector('.composer-actions button.small').click();
		await settleRender(dialog);
		assert.strictEqual(dialog._matchesExpanded, true);
		dialog.open = false;
		await settleRender(dialog);
		dialog.open = true;
		await settleRender(dialog);
		assert.strictEqual(dialog._matchesExpanded, false, 'collapsed on every open');
		dialog._retainedPreviewIDs.clear();
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

	//MOBILE READING ORDER: what it is, what it costs, why.
	//
	//The verb had a full-width row of its own between the label and the
	//description, so a row read "Add Starred / 18 cards / ADD / Adds Starred to
	//this collection" — the consequence interrupting the thing it is a
	//consequence of. The verb is deleted outright now, which retires the defect;
	//what is left to keep in order is the label, its count, and the detail
	//after both. On a 375px screen an 11em count column would leave the label
	//nothing, so the count drops to its own row under the label rather than
	//being cut off.
	it('keeps a mobile row’s count under its label, with the detail after both', () => {
		const styles = composerStyles();
		const mobileGrid = /\.mobile \.palette-row button\s*\{([^}]*grid-template-areas[^}]*)\}/.exec(styles);
		assert.ok(mobileGrid, 'the mobile row grid must exist');
		const areas = mobileGrid[1].replace(/\s+/g, ' ');
		//SUPERSEDED PIN (round 3, D3): the mobile grid used to reserve a `glyph`
		//track beside the label for the one row that navigated. Nothing in the
		//list navigates, so the track and the glyph are both gone and the label
		//has the full width.
		assert.match(areas, /'label'/, 'the label leads, and has the row to itself');
		assert.ok(!/glyph/.test(areas), 'there is no navigation glyph to place');
		assert.match(areas, /'count'/, 'and the count takes its own row rather than a narrow column');
		assert.ok(!/action/.test(areas), 'there is no verb chip to place');
		assert.ok(areas.indexOf('detail') > areas.indexOf('count'),
			'the detail stays after both, unbroken');
		assert.match(styles, /\.mobile \.row-count\s*\{[^}]*white-space:\s*normal/,
			'and it may wrap here rather than being cut off');
	});

	//(The touch-copy pin that stood here is superseded by 'renders no key-hints
	//line, in any state' — owner, F4.)

	//SUPERSEDED PIN (owner, F3). It was 'keeps the collection sentence out of
	//the card scroller': the drawer's header had been lifted out of the
	//scrolling card list so the always-visible collection summary could not be
	//scrolled off the top — "nothing that says persistent can be an item in a
	//scrolling region".
	//
	//The summary is deleted, so there is nothing persistent left up there to
	//protect, and the arrangement had become actively harmful: the expanded info
	//panel is a word cloud plus a dozen actions, and pinned outside the scroller
	//it pushes the card list off the bottom of the drawer the moment the zippy is
	//opened — which is precisely the entry point the owner asked to go back to.
	//So the header is inside the scroller again, exactly as at 752722bd, and
	//what is pinned is that arrangement.
	it('keeps the drawer header inside the scroller, the way it was before the summary', async () => {
		const drawer = document.createElement('card-drawer');
		drawer.showing = true;
		document.body.append(drawer);
		await drawer.updateComplete;
		const scroller = drawer.shadowRoot.querySelector('.scrolling.scroller');
		const count = drawer.shadowRoot.querySelector('#count');
		assert.ok(scroller, 'the card list still scrolls');
		assert.ok(count, 'the count line still exists');
		assert.ok(scroller.contains(count),
			'the header scrolls with the list again, so an opened zippy cannot squeeze it');
		assert.strictEqual(scroller.firstElementChild, count,
			'and it is the first thing in it, as it was before #498');
		//Both slots are still its children — the info zippy is where Configure
		//collection lives, and it must travel with the header.
		assert.ok(count.querySelector('slot[name="info"]'), 'the details slot');
		assert.ok(count.querySelector('slot[name="visible-info"]'), 'and the always-visible one');
		assert.ok(scroller.querySelector('card-thumbnail-list'), 'the thumbnails are still there too');
		//And the props that only existed to hold a sibling header in place are
		//gone with it, rather than left behind as inert rules.
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-drawer.ts'), 'utf8');
		assert.ok(!/#count\s*\{[^}]*flex:\s*0 0 auto/.test(source));
		assert.ok(!/grouped/.test(source),
			'and so are the grouped-count rules that lined it up with the summary');
		drawer.remove();
	});

	//SUPERSEDED PIN (round 3, D1). This was 'brings a closed draft back, pills
	//typed text and all, on the same collection': Escape preserved an
	//un-committed draft and its half-typed text, and the next open resumed both
	//with a receipt saying so.
	//
	//The owner's constitution: "if you make a mistake, esc/X resets to the
	//previous state." Preservation made Escape mean DEFER rather than reset — the
	//mistake came back on the next Ctrl-K, on a surface that had reopened on it
	//silently, and the user's second Escape was spent undoing the first one's
	//failure to undo. The reset IS the undo, so it has to be total.
	it('discards a closed draft, typed text and all, and begins from the collection on screen', async () => {
		await addRefineRow('Starred');
		const input = dialog.shadowRoot.querySelector('#collection-composer-input');
		input.value = 'work in progress';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ['starred']);

		dialog.cancel();
		await dialog.updateComplete;
		assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);

		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await dialog.updateComplete;
		await dialog.updateComplete;
		await settleRender(dialog);
		assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [],
			'the draft is gone; the composition begins from the collection on screen');
		assert.strictEqual(dialog.shadowRoot.querySelector('#collection-composer-input').value, '',
			'and so is the half-typed text');
		assert.strictEqual(dialog.shadowRoot.querySelector('.draft-receipt'), null,
			'with nothing to explain, because nothing came back');
	});

	//SUPERSEDED PIN (round 3, D6). This was 'names the row Enter would act on,
	//not every action the list has'. It was filed against a footer that read
	//'Enter opens Source, configures, or adds' — three claims of which exactly one
	//was in force, with nothing saying which — and it fixed that by giving each
	//row species its own line.
	//
	//The round-3 model removes the species, so it removes the problem the fix was
	//for: every row is an action on the draft, Enter executes it, and the footer
	//says so once. The property the old test protected — that the footer never
	//states a union of verbs — is stronger now and is pinned above, in 'states one
	//contract, in the same words on every row', including the list of phrases the
	//line may not contain.
	//
	//What still has to be true, and is pinned here, is that the ROWS themselves
	//keep their different consequences even though the footer no longer enumerates
	//them: a configurable family opens its controls, a structural family opens
	//Source, and a plain clause simply lands.
	it('keeps each row species\' own consequence, without a footer that enumerates them', async () => {
		await typeComposer('text');
		const configurable = familyRow('query');
		assert.ok(configurable, 'the configurable family is a row');
		configurable.click();
		await settleRender(dialog);
		assert.ok(pillRow(), 'a configurable family lands and opens its own controls');

		await typeComposer('exclude');
		const structural = familyRow('exclude');
		assert.ok(structural, 'the structural family is a row');
		structural.click();
		await settleRender(dialog);
		assert.strictEqual(dialog._entryMode, 'source',
			'a clause this layer will not compose opens Source instead');
	});

	//THE VERB CHIPS ARE DELETED, AND SO IS THE GLYPH THAT REPLACED THEM.
	//
	//SUPERSEDED PIN (round 3, D1/D3): this was 'carries no verb chips, and marks
	//the one row that navigates with a glyph'. Seven verbs in one register — Open
	/// Add / Remove / Replace / Configure / Edit / Source — were cut down to the
	//one bit that genuinely differed between rows: Open is the only verb that
	//LEAVES, so a destination under a typing list wore the app's OPEN_IN_BROWSER
	//glyph and nothing else did.
	//
	//The owner's constitution removes that last bit too. "Navigation is only ever
	//Cmd-Enter/primary", so executing a recent replaces the draft rather than
	//going anywhere — there is no difference left for a glyph to mark, and a
	//marker for a consequence that no longer happens is worse than none. 'All rows
	//should look/feel like the same KIND of thing.'
	it('carries no verb chips and no navigation glyph: one row species', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		assert.ok(suggestionRows().length, 'there are rows to check');
		assert.strictEqual(dialog.shadowRoot.querySelector('.palette-list .suggestion-action'), null,
			'no row in the palette carries a verb chip');
		assert.strictEqual(dialog.shadowRoot.querySelector('.palette-list .row-navigate'), null,
			'and none carries a navigation glyph');

		//Typing mixes recents and clause edits in one list, which is exactly where
		//a second species would show itself.
		await typeComposer('star');
		assert.strictEqual(dialog.shadowRoot.querySelector('.palette-list .row-navigate'), null,
			'including under a typing list, where the old build marked the recent');
		const recents = suggestionRows().filter((button) => (button.dataset.rowId || '').startsWith('recent:'));
		assert.ok(recents.length, 'a recent really is in this list');
		for (const button of recents) {
			assert.ok(button.querySelector('.row-label'),
				'a recent has the same label slot as every other row');
		}
		//And the glyph's own rules are gone from the stylesheet with it.
		const styles = composerStyles();
		assert.doesNotMatch(styles, /\.row-navigate\s*\{/);
		for (const rule of (styles.match(/[^}\n][^}]*\.suggestion-action[^{]*\{[^}]*\}/g) || [])) {
			assert.ok(!/\.palette-row[^,{]*\.suggestion-action/.test(rule),
				`the chip treatment must not reach the palette's own rows: ${rule.split('{')[0].trim()}`);
		}
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
		//TWO RUNS (round-3 tightness, S2). SUPERSEDED: there were three, and the
		//middle one was headed 'Refine'. The rows under it are the same species
		//as the rows under the third — a pill, a count, one quiet word — doing
		//the same thing, in the order the ranking already put them in. A heading
		//between two runs of one species is a wall that says only "the ranking
		//stops here and starts again", and the constitution's model is ONE ranked
		//list. The contextual rows keep their rank and lose the label.
		//
		//It is ONE heading for everything you can do to the draft, not one per
		//category. The category is an annotation on each row instead, because a
		//wall of headings would outrank the ranking — which is exactly the defect
		//that made 'Suggested for this card' beat an exact name match in the feed
		//this replaced.
		assert.deepStrictEqual(headings, ['Recent', 'Everything you can add'],
			`the idle list is recents, then one ranked run: ${headings.join(' | ')}`);
		for (const heading of headings) {
			assert.notStrictEqual(heading, heading.toUpperCase(), `heading is ALL CAPS: ${heading}`);
		}
		const styles = composerStyles();
		assert.ok(!/\.suggestion-heading\s*\{[^}]*text-transform/.test(styles));
		assert.ok(!/\.source-interpretation-label\s*\{[^}]*text-transform/.test(styles));
		//'normal', not 400 (owner, F4): the same weight, in the spelling the
		//other nineteen font-weight declarations in this app use.
		assert.match(styles, /\.suggestion-heading\s*\{[^}]*font-weight:\s*normal/);
		assert.ok(!/\.suggestion-heading\s*\{[^}]*font-weight:\s*400/.test(styles),
			'400 is a spelling this app uses nowhere else');
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
		const pane = styles.match(/\.palette-list,\s*\.suggestions\s*\{[^}]*mask-image[^}]*\}/);
		assert.ok(pane, 'both scroll panes must take one boundary rule');
		assert.match(pane[0], /mask-image:\s*linear-gradient\(to bottom,[^)]*currentColor[^}]*transparent 100%\)/,
			'a bottom fade is the affordance that says there is more below');
		assert.ok(!/mask-image:[^;]*#[0-9a-f]{3}/i.test(pane[0]),
			'a mask reads the alpha channel, so it must not name a colour (HS-4.1)');
		assert.match(pane[0], /scroll-padding-block:\s*2\.2em var\(--composer-edge-fade\)/,
			'the top value keeps the group heading on screen; the bottom value is the fade, so a row never lands under it');
		//And the reservation lives in ONE place: the row's own scroll-margin
		//would add to the container's padding rather than replace it.
		assert.ok(!/\.palette-row button\s*\{[^}]*scroll-margin/.test(styles),
			'the row must not carry a second, additive reservation');
		//The heading really is above row 0 inside the same scroller, which is
		//what the top value exists for.
		await seedRecents([['everything/starred/', 3]]);
		const list = dialog.shadowRoot.querySelector('#collection-palette-list');
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
	//measured per row: the live review found adjacent count columns starting at
	//634px and 739px. There is ONE list to keep honest now instead of three,
	//and one fewer column in it — the verb chips are deleted — but the rule is
	//the same: the count track is FIXED so its left edge cannot wander between
	//rows. JSDOM computes no layout, so the rule is what is pinned, plus the DOM
	//fact that every option really does use it.
	it('gives every row in the list the same column grid', async () => {
		const styles = composerStyles();
		const row = styles.match(/\.palette-row button\s*\{[^}]*grid-template-columns[^}]*\}/);
		assert.ok(row, 'the row button carries the grid');
		//SUPERSEDED PIN (round 3, D3): the third `auto` track held the navigation
		//glyph, which is deleted with the navigating row. Two tracks now — what
		//the row does, and what it costs — which is the whole anatomy.
		assert.match(row[0], /grid-template-columns:\s*minmax\(0, 1fr\) 11em/,
			'label flexes; the count is FIXED, so its left edge cannot wander between rows');
		assert.ok(!/grid-template-columns:\s*minmax\(0, 1fr\) auto\s*;/.test(row[0]),
			'a content-sized count track is the defect itself');
		assert.match(styles, /\.row-count\s*\{[^}]*text-align:\s*right/,
			'the numbers line up with each other, not with the words after them');

		//The count cell's width is reserved by the track, so it exists before
		//any count arrives — which is what stops the reflow when one lands.
		await seedRecents([['everything/starred/', 6], ['main/updated/after/3-days-ago/', 3]]);
		const rows = suggestionRows();
		assert.ok(rows.length >= 2, 'the list must actually have rows to check');
		assert.ok(rows.every((button) => button.closest('.palette-row')),
			'every option is a .palette-row, so every option takes the shared grid');
		assert.ok(rows.some((button) => !button.querySelector('.row-count')),
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
		const chip = sentencePills()[0];
		assert.ok(chip);
		assert.strictEqual(deepText(chip).replace(/\s+/g, ' ').trim(), 'Nothing (placeholder)');
		assert.notStrictEqual(deepText(chip).trim(), 'None');
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

	//THREE SUPERSEDED PINS, ONE REPLACEMENT (owner, F3).
	//
	//They were 'renders the drawer collection sentence with quiet operators,
	//beside its count', 'offers no live pills and no removal from the drawer
	//summary', and 'leaves the drawer's actions centred while the count follows
	//the sentence'. All three described the shape of the always-visible drawer
	//summary — its quiet operators, its plain-text (rather than live-pill)
	//rendering, and the alignment it shared with the card count.
	//
	//The owner: "the configure collection visible always at the top of the card
	//drawer is weird / bad styling and I want to remove it. The two ways to get
	//this: Ctrl-K, and clicking Configure Collection in the zipped-up menu in
	//card-drawer, exactly as before." A summary with no shape has no shape to
	//pin, so the ABSENCE is what is pinned — which is also what the middle one
	//of the three was already for, one revert earlier. The absence-of-live-pills
	//pin becomes the absence-of-the-summary pin.
	it('renders no collection summary in the drawer at all', async () => {
		const source = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');

		//The whole block: the sentence text, the Refine line, the copy-link
		//glyph, and every style that painted them.
		for (const trace of [
			'collection-summary',
			'collection-summary-main',
			'collection-summary-expression',
			'collection-summary-operator',
			'collection-summary-clause',
			'collection-summary-action',
			'copy-collection-link',
			'collectionExpressionParts',
			'_collectionSummaryName',
			'_unresolvedClauses',
			'UNRESOLVED_CLAUSE_NOTE',
		]) {
			assert.ok(!source.includes(trace), `${trace} is a trace of the deleted summary`);
		}
		//The renderer never came back either — that was the earlier revert's pin,
		//and it still holds one level further out.
		assert.ok(!/<collection-sentence|collection-sentence\.js/.test(source),
			'and card-view is not a host of the sentence renderer');

		//The visible-info slot survives, because the drawer's own actions live in
		//it (Clear selection, Show only selected, Randomize). It simply no longer
		//opens with a block about the collection.
		assert.match(source, /<div slot='visible-info'>/);
		assert.match(source, /id='clear-selection'/);

		//And the drawer's count is the centred 12em line it has always been.
		const drawer = await readFile(path.join(REPO_ROOT, 'src/components/card-drawer.ts'), 'utf8');
		assert.match(drawer, /#count\s*\{[^}]*text-align:\s*center/,
			'the drawer column centres its contents, as it did before #498');
		assert.ok(!/grouped/.test(drawer),
			'nothing groups the count with a sentence that no longer exists');

		//The shared lost-card helper stays: the composer's own commit path is its
		//other caller, and that path is not being reverted.
		const dialog = await readFile(path.join(REPO_ROOT, 'src/components/configure-collection-dialog.ts'), 'utf8');
		assert.match(dialog, /commitPathDroppingLostCard/,
			'the composer keeps its copy of the lost-card question');
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

	//SUPERSEDED PIN (owner, F3). It was 'marks a clause the URL parser could not
	//resolve in the collection sentence', over card-view's drawer summary: an
	//unresolvable clause was struck there so the sentence and the count could not
	//contradict each other.
	//
	//The summary is deleted, so card-view draws no sentence to strike. THE RULE
	//IS NOT REPEALED — it moved back to its one owner. collection-sentence still
	//strikes [data-unresolved] and still says so in its accessible name (its own
	//suite pins both), and the drawer still shows the notice that explains what
	//the app did instead. What is pinned here is that the notice survived the
	//deletion and that the strike still exists where the sentence now is.
	it('keeps the unresolved-clause notice and the strike where the sentence still lives', async () => {
		const view = await readFile(path.join(REPO_ROOT, 'src/components/card-view.ts'), 'utf8');
		assert.ok(!/data-unresolved/.test(view),
			'card-view draws no sentence, so it draws no strike');
		//The notice itself is untouched, in the drawer, where it always was.
		const drawer = await readFile(path.join(REPO_ROOT, 'src/components/card-drawer.ts'), 'utf8');
		assert.match(drawer, /Didn’t understand/, 'the notice is still shown');
		assert.match(drawer, /this\.urlDiagnostics && this\.urlDiagnostics\.length/,
			'off the same arrivals it always read');
		assert.match(view, /\.urlDiagnostics=\$\{this\._urlDiagnostics\}/,
			'and card-view still supplies them');
		//And the STRIKE is still the signal, not a colour (§4.1), in the renderer
		//that now owns every sentence in the app.
		const sentence = await readFile(path.join(REPO_ROOT, 'src/components/collection-sentence.ts'), 'utf8');
		assert.match(sentence, /\[data-unresolved\]\s*\{[^}]*text-decoration:\s*line-through/);
	});

	//THE NO-NEW-STYLES SWEEP (owner, F4: "do one more scrub and make sure we're
	//not making new styles (font, font-size, etc.) for the dialog — only
	//idiomatic styles defined somewhere else in the UI as much as possible").
	//
	//A style auditor diffing the composer against the rest of the app must find
	//no typographic value that lacks a shipped precedent. This is that auditor,
	//and it is written against the REAL FILES on both sides — the composer's
	//components, and every other component in the app — rather than against a
	//list of blessed values, so it cannot go stale by agreeing with itself: if a
	//value's only precedent is later deleted (which is exactly what happened to
	//0.82em when F3 deleted the drawer summary), this fails.
	//
	//font-size, font-weight and font-family, which is the set the owner named.
	//line-height is audited in the report rather than pinned here: one value —
	//the mobile sentence's 44px — is §4.2's hit-target floor expressed in the
	//units the floor is stated in, and is deliberately a number about touch
	//targets rather than about type.
	it('introduces no font value the rest of the app does not already use', async () => {
		const COMPOSER = [
			'configure-collection-dialog.ts',
			'collection-sentence.ts',
			'collection-pill-row.ts',
			'collection-why-here.ts',
			'tag-chip-group.ts',
			'tag-chip.ts',
		];
		const PROPERTIES = ['font-size', 'font-weight', 'font-family'];

		const dir = path.join(REPO_ROOT, 'src/components');
		const files = (await readdir(dir)).filter(name => name.endsWith('.ts'));
		assert.ok(files.length > 40, 'the sweep must be reading the real component directory');
		for (const name of COMPOSER) {
			assert.ok(files.includes(name), `${name} must exist for this sweep to mean anything`);
		}

		//Declarations only: one per line, terminated, and with block comments
		//stripped first so prose that happens to say "font-size:" is not data.
		const declarations = (source, property) => {
			const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
			return Array.from(stripped.matchAll(new RegExp(`${property}\\s*:\\s*([^;}\\n]+);`, 'g')))
				.map(match => match[1].trim());
		};

		const composer = {};
		const elsewhere = {};
		for (const property of PROPERTIES) {
			composer[property] = new Map();
			elsewhere[property] = new Map();
		}
		for (const name of files) {
			const source = await readFile(path.join(dir, name), 'utf8');
			const bucket = COMPOSER.includes(name) ? composer : elsewhere;
			for (const property of PROPERTIES) {
				for (const value of declarations(source, property)) {
					if (!bucket[property].has(value)) bucket[property].set(value, []);
					bucket[property].get(value).push(name);
				}
			}
		}

		//Sanity: the sweep must actually be seeing values on both sides, or a
		//broken regex would make it pass by finding nothing.
		assert.ok(composer['font-size'].size >= 5, 'the composer sets several sizes');
		assert.ok(elsewhere['font-size'].size >= 15, 'and the rest of the app sets many');

		const novel = [];
		for (const property of PROPERTIES) {
			for (const [value, where] of composer[property]) {
				if (elsewhere[property].has(value)) continue;
				novel.push(`${property}: ${value} (only in ${[...new Set(where)].join(', ')})`);
			}
		}
		assert.deepStrictEqual(novel, [],
			`the composer invents typographic values the app uses nowhere else:\n  ${novel.join('\n  ')}`);

		//AND NO ELEMENT SMUGGLES IN A FAMILY THE STYLESHEET NEVER NAMES.
		//The sweep above reads CSS declarations, and a <code> (or <pre>, <kbd>,
		//<tt>) gets monospace from the UA stylesheet with no declaration to
		//find. Source mode's completion rows had one, printing the raw filter
		//spelling — the app's only monospace on screen, in a component that had
		//just had its two `font-family: monospace` rules removed for the same
		//reason. It is a plain span now.
		for (const name of COMPOSER) {
			const source = await readFile(path.join(dir, name), 'utf8');
			for (const tag of ['code', 'pre', 'kbd', 'tt', 'samp']) {
				assert.ok(!new RegExp(`<${tag}[ >]`).test(source),
					`${name} renders <${tag}>, whose UA default is a family §4.3 does not name`);
			}
		}

		//AND THE ITALIC IS NOT A NOVEL REGISTER EITHER. The row annotation grew
		//one in round 6; the owner asked whether italics exist anywhere else in
		//the app's UI. They do — nine other components — so it stays.
		const dialog = await readFile(path.join(dir, 'configure-collection-dialog.ts'), 'utf8');
		assert.match(dialog, /\.row-annotation\s*\{[^}]*font-style:\s*italic/);
		const italicElsewhere = files.filter(name => !COMPOSER.includes(name))
			.length && (await Promise.all(files
			.filter(name => !COMPOSER.includes(name))
			.map(async name => declarations(await readFile(path.join(dir, name), 'utf8'), 'font-style'))))
			.flat().filter(value => value === 'italic');
		assert.ok(italicElsewhere.length >= 5,
			'italic is an established metadata treatment here, not something the composer invented');
	});

	//SPEC §Narrow: an unsolicited clause whose RESOLVED count is zero proposes a
	//refinement that refines the collection out of existence.
	//
	//AND THE RULE REACHES THE WHOLE IDLE LIST NOW (round-3 tightness, minor).
	//The suppression covered only the three contextual rows, so the vocabulary
	//run beneath them was never touched: signed out, the idle list opened with
	//`Starred → 0` in the first screenful — a row leading with a promise to empty
	//the collection, which is the defect the rule exists to prevent, one run
	//down. Zero SINKS across the whole idle list; a contradictory contextual row
	//is still suppressed outright, because it was an offer nobody asked for.
	it('keeps a contradictory refinement from leading the idle list, and never hides it', async () => {
		await seedRecents([['main/starred/sort/recent/', 2]]);
		//A resolved, non-zero draft, and a resolved zero for one contextual row.
		const draftKey = dialog._previewCountKey(dialog._collectionDescription);
		dialog._retainedPreviewCounts.set(draftKey, 42);
		const addRow = dialog._paletteRows.find(row => row.kind !== 'destination' && row.description.filters.length);
		assert.ok(addRow, 'there is a refinement to suppress');
		const addedFilter = addRow.description.filters.slice(-1)[0];
		dialog._retainedPreviewCounts.set(dialog._previewCountKey(addRow.description), 0);
		dialog.requestUpdate();
		await settleRender(dialog);
		//AMENDED (owner, F2): the counts now decide the list at BUILD time, so a
		//count landing into an open list neither sinks nor suppresses anything —
		//that was the reshuffle. A keystroke is a build, and this round trip is
		//the cheapest one; the rule below is otherwise unchanged.
		assert.ok(dialog._paletteRows.some(row => row.id === addRow.id),
			'the row does not move or vanish while the reader is looking at it');
		await typeComposer('x');
		await typeComposer('');
		const rows = dialog._paletteRows;
		const zeroIndex = rows.findIndex(row => row.id === addRow.id);
		if (zeroIndex >= 0) {
			//It survived as a vocabulary row: then it must not LEAD its run.
			const run = rows.filter(row => row.section === rows[zeroIndex].section);
			assert.ok(run.slice(0, run.indexOf(rows[zeroIndex])).some(row =>
				dialog._countForDescription(dialog._appliedDescription(row)) !== 0),
			'a zero-count row sinks within its run rather than leading it');
		}
		//And once the user NAMES it, it comes back at the top — the rows are then
		//interpretations of what they typed, not unsolicited offers.
		await typeComposer(dialog._composerFilterLabels[addedFilter] || addedFilter);
		assert.ok(dialog._paletteRows.some(row => row.description.serialize() === addRow.description.serialize()),
			'a filter the user asked for by name is never hidden from them');
		await typeComposer('');
	});

	//A NOTE IS NOT A RECOVERY.
	//
	//"No cards currently match" states the fact and offers nothing. The question
	//the user actually has is "which of these clauses emptied it?", and it is
	//answered by the per-clause removals with their counts beside them — the one
	//whose removal brings the collection back is visible at a glance. The rows
	//come from the SAME expression the sentence renders, so a recovery row and
	//pressing Remove on the pill compile the same edit and neither can omit a
	//clause the other shows.
	it('offers the per-clause removals when the draft matches nothing', async () => {
		//Previews ON, because the point of this section is its NUMBERS: the rows
		//come into existence when the draft's own count arrives, and the defect
		//M4 fixed was that nothing then asked for theirs.
		window.localStorage.setItem('collection-composer-preview', 'on');
		await seedDraft('everything/starred/has-todo/');
		try {
			//SUPERSEDED PIN (round 3, D3). The section was headed 'Nothing
			//matches — try removing': a sentence, where every other heading in
			//the list is a two-word rank label, which made the run under it look
			//like a different KIND of list rather than the same list ranked
			//differently. The fact it carried — that the draft resolves to
			//nothing — is stated once, beside the commit control, where it always
			//was. The heading is 'Try removing'.
			//No recovery while the count is unknown: `undefined` is "not in yet",
			//which is a different fact from zero.
			assert.ok(!dialog._paletteRows.some(row => row.section === 'Try removing'),
				'a collection nobody has counted yet is not a collection to recover from');

			const draftKey = dialog._previewCountKey(dialog._collectionDescription);
			const withoutStarred = 'starred-removed';
			const withoutTodo = 'todo-removed';
			void withoutStarred; void withoutTodo;
			dialog._retainedPreviewCounts.set(draftKey, 0);
			//THE ROWS COME INTO EXISTENCE BECAUSE A COUNT ARRIVED, so the request
			//for THEIR counts has to be re-made — which is the M4 root cause and
			//is why this drives the refresh rather than a bare requestUpdate.
			dialog._refreshPreviewCounts();
			await settleRender(dialog);
			const recovery = dialog._paletteRows.filter(row => row.section === 'Try removing');
			assert.strictEqual(recovery.length, 2, 'one row per clause the draft has');
			//AND IT LEADS. It used to sit at the END of a list of recents plus
			//three refinements, where it was the last few rows on screen. The
			//idle list is the whole vocabulary now — 275 rows on the owner's
			//corpus — so appended it is two hundred scroll-lines away from the
			//question it answers. Observed live before this: a 0-card draft
			//showed the "No cards currently match" note with nothing to act on.
			assert.deepStrictEqual(dialog._paletteRows.slice(0, 2).map(row => row.id), recovery.map(row => row.id),
				`recovery leads the idle list: ${dialog._paletteRows.slice(0, 4).map(row => `${row.section}/${row.id}`).join(' | ')}`);
			assert.deepStrictEqual(
				recovery.map(row => row.description.filters).sort(),
				[['has-todo'], ['starred']].sort(),
				'each row is the collection without exactly one clause, which is what its count counts'
			);

			//SAME SPECIES AS A TYPED REMOVE ROW (round-3 tightness, M4).
			//SUPERSEDED: these came through the suggestion module's removal
			//generator and wore its verb label — 'Remove Tagged Ecosystems' — with
			//no pill, in the one place a user is already confused. Every removal
			//in this product is a struck pill plus the word `remove`.
			await settleRender(dialog);
			for (const row of recovery) {
				assert.strictEqual(row.removes, true);
				assert.strictEqual(row.valenceKind, 'remove');
				assert.strictEqual(row.annotation, 'remove', 'one quiet word, the same one a typed remove uses');
				assert.ok(row.pillExpression && row.pillExpression.length === 1,
					'and it shows the pill it takes out');
				assert.ok(!/^Remove /.test(row.label), `no verb label: ${row.label}`);
			}
			const rendered = suggestionRows().slice(0, 2);
			for (const button of rendered) {
				assert.ok(button.querySelector('.row-label collection-sentence'),
					'rendered through the sentence renderer, like every other pill row');
				assert.ok(button.querySelector('.row-label').classList.contains('row-removes'),
					'wearing the removal treatment');
			}

			//THE COUNTS ARE ASKED FOR, AND THEY ORDER THE SECTION (M4) — AT THE
			//NEXT BUILD (owner, F2).
			//
			//SUPERSEDED PIN: this set the two removals' counts and asserted the
			//re-ordering on the very next render, which is a re-rank under a
			//reader's eyes. The section's own rule is unchanged — "which of these
			//emptied it?" is answered by the removal that brings back the most —
			//but it is applied when the list is BUILT, from the counts the build
			//had. On the first build (the one this count created) the removals
			//have no counts yet, so the section is in the sentence's own order,
			//which is a defensible order for a list of the user's own clauses.
			//The rank lands on the next build, which any keystroke is.
			const byFilter = (filters) => recovery.find(row =>
				row.description.filters.join('/') === filters);
			dialog._retainedPreviewCounts.set(dialog._previewCountKey(byFilter('starred').description), 900);
			dialog._retainedPreviewCounts.set(dialog._previewCountKey(byFilter('has-todo').description), 4);
			dialog._refreshPreviewCounts();
			await settleRender(dialog);
			assert.deepStrictEqual(
				dialog._paletteRows.filter(row => row.section === 'Try removing').map(row => row.id),
				recovery.map(row => row.id),
				'a count arriving into the open section does not re-sort it');
			//The next build applies it.
			await typeComposer('x');
			await typeComposer('');
			const ordered = dialog._paletteRows.filter(row => row.section === 'Try removing');
			assert.deepStrictEqual(ordered.map(row => row.description.filters.join('/')), ['starred', 'has-todo'],
				'the removal that recovers the most leads');
			//AND THEIR COUNTS WERE ACTUALLY ASKED FOR. This is M4's root cause
			//pinned directly: the recovery rows exist only because a count
			//arrived, and a count arriving did not used to re-ask for the rows it
			//had just created — so the section whose entire job is to answer
			//"which of these emptied it?" rendered with no numbers in it at all.
			for (const row of ordered) {
				assert.ok(dialog._rowCountMeaningful(row), 'a removal has a count to state');
				assert.ok(row.id in dialog._previewCounts,
					`the row's count was requested and delivered: ${Object.keys(dialog._previewCounts).join(', ')}`);
			}
			assert.strictEqual(dialog._rowCountText(ordered[0]), '0 cards → 900 cards',
				'and every row states what it would recover, honestly');
			assert.strictEqual(dialog._rowCountText(ordered[1]), '0 cards → 4 cards');

			//And a non-empty draft has nothing to recover from.
			dialog._retainedPreviewCounts.set(draftKey, 9);
			dialog._refreshPreviewCounts();
			await settleRender(dialog);
			assert.ok(!dialog._paletteRows.some(row => row.section === 'Try removing'));
		} finally {
			window.localStorage.removeItem('collection-composer-preview');
			dialog._retainedPreviewCounts.clear();
		}
	});

	//A WIDENING THAT WIDENS NOTHING, AND A ZERO THAT LEADS.
	//
	//Two count-driven ranking rules, and they are deliberately different: a
	//widen whose result is the collection it started from is a consequence row
	//with no consequence and is SUPPRESSED, while a clause the user named that
	//resolves to nothing is the honest warning and is only RANKED DOWN. Hiding
	//the filter somebody just typed is the worse defect.
	it('suppresses a no-op widen and sinks a zero-count row without hiding it', async () => {
		await seedDraft('everything/starred/');
		try {
			const draftKey = dialog._previewCountKey(dialog._collectionDescription);
			dialog._retainedPreviewCounts.set(draftKey, 158);
			await typeComposer('unread');
			await settleRender(dialog);
			const widen = dialog._paletteRows.find(row => row.valenceKind === 'or');
			const add = dialog._paletteRows.find(row => row.valenceKind === 'add');
			assert.ok(widen && add, 'the typed token produces both a widen and an add');

			//The widen resolves to exactly what the draft already was.
			dialog._retainedPreviewCounts.set(dialog._previewCountKey(widen.description), 158);
			dialog._retainedPreviewCounts.set(dialog._previewCountKey(add.description), 0);
			dialog.requestUpdate();
			await settleRender(dialog);
			//AND IT IS SUPPRESSED AT THE NEXT BUILD, NOT MID-READ (owner, F2).
			//SUPERSEDED: this asserted the suppression on the next render after
			//the counts landed. A row LEAVING is the harshest of the count-driven
			//movements — everything below it slides up — so it now waits for a
			//build, exactly as the re-ranks do. The rule itself is untouched.
			assert.ok(dialog._paletteRows.some(row => row.id === widen.id),
				'the row a reader is looking at does not vanish under them');
			await typeComposer('unrea');
			await typeComposer('unread');
			assert.ok(!dialog._paletteRows.some(row => row.id === widen.id),
				'a widen that adds no cards is a row promising a consequence it does not deliver');
			const rows = dialog._paletteRows;
			const zeroIndex = rows.findIndex(row => row.description.serialize() === add.description.serialize());
			assert.ok(zeroIndex >= 0, 'the zero-count row is still offered — the count is the warning');
			//SUPERSEDED PIN (round-3 tightness, B2). It used to assert that the
			//zero-count row 'no longer leads the list'. That is right for a row
			//nobody named and wrong for THIS one: 'unread' is exactly what the
			//user typed, and the row is the plain add of it. The critique's own
			//repro — a fresh date phrase against a two-tag draft — put the parsed
			//phrase's own pill SEVENTH, under two or-grafts containing it and
			//three readings of the raw words, because its count had come back
			//zero. The honest zero on the literal row, plus the recovery section
			//it triggers, IS the design's answer to "that selects nothing".
			//
			//The zero-sink survives WITHIN the secondary rows, which is where it
			//was always useful: among several readings of an ambiguous token, the
			//ones that select nothing go last.
			assert.strictEqual(zeroIndex, 0,
				`the row that IS the typed thing leads, zero or not: ${rows.slice(0, 4).map(row => `${row.id}:${dialog._countForDescription(dialog._appliedDescription(row))}`).join(' | ')}`);
			const secondary = rows.slice(1);
			const firstZero = secondary.findIndex(row => dialog._rowCountMeaningful(row) &&
				dialog._countForDescription(dialog._appliedDescription(row)) === 0);
			const lastKnown = secondary.map(row => dialog._rowCountMeaningful(row) &&
				dialog._countForDescription(dialog._appliedDescription(row))).lastIndexOf(0);
			void lastKnown;
			if (firstZero >= 0) {
				assert.ok(secondary.slice(0, firstZero).every(row =>
					dialog._countForDescription(dialog._appliedDescription(row)) !== 0),
				'and among the secondary rows a zero still goes last');
			}
		} finally {
			await typeComposer('');
			dialog._retainedPreviewCounts.clear();
		}
	});

	//SUPERSEDED (owner, F4). This was 'names the pill row’s own keys, from the
	//module that performs them' — the line, plus every entry of
	//PILL_ROW_KEY_HINTS, plus 'closes the row'. Both the line and the table are
	//deleted; see 'renders no key-hints line, in any state'. What the keys DO is
	//still pinned, in the tests that press them: '-' inverts a clause to the app's
	//inverse word, '+' scopes the input to an or, Enter edits the selected pill,
	//and Escape peels the row before the dialog.
	it('walks between clauses with the arrow keys, and says so to a screen reader', async () => {
		const { updateCollectionConfigurationSnapshot } = await import('../../lib/src/actions/collection.js');
		store.dispatch(updateCollectionConfigurationSnapshot(CollectionDescription.deserialize('everything/starred/unread/')));
		await settleRender(dialog);

		await pressComposer('Backspace');
		assert.deepStrictEqual([...dialog._selectedPath], [1], 'the last clause is selected');
		assert.ok(pillRow(), 'and the row is open on it — which is the visible half');
		await pressComposer('ArrowLeft');
		assert.deepStrictEqual([...dialog._selectedPath], [0],
			'←→ walk the sentence while the caret stays in the input');
		//The audible half. Focus never leaves the input, so this live region is
		//the only thing that tells a screen-reader user the selection moved — and
		//it is what the deleted line used to duplicate.
		const status = dialog.shadowRoot.querySelector('[role="status"].visually-hidden, .visually-hidden[role="status"]');
		assert.ok(status && /selected/.test(status.textContent),
			`the selection is announced: ${status ? status.textContent : 'no status region'}`);
	});

	//A LIST OPENS AT ITS TOP.
	//
	//The panes are not recreated between sessions, so their scrollTop survived
	//close-and-reopen: a session that had arrowed down the suggestions reopened
	//HEADERLESS in the middle of the list, with the CONTINUE heading and the
	//0-card Remove diagnostics scrolled away and no sign anything was above.
	it('reopens its lists at the top, and starts every transition there', async () => {
		await seedRecents([['main/starred/sort/recent/', 2], ['everything/unread/', 3]]);
		const pane = () => dialog.shadowRoot.querySelector('.palette-list');
		assert.ok(pane(), 'there is a list to scroll');
		pane().scrollTop = 120;
		//Close and reopen, the way a user does.
		store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
		await settleRender(dialog);
		store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
		await settleRender(dialog);
		assert.strictEqual(pane().scrollTop, 0, 'a reopened list starts at its top');
		//And so does every transition that REPLACES what the pane holds. The
		//`Browse all` feed was one such transition and is deleted (the list is
		//the vocabulary now); the sentence-word scope is another, and it is the
		//one that survived, so it is what this pins.
		pane().scrollTop = 90;
		dialog._openWordScope('sort');
		await settleRender(dialog);
		assert.strictEqual(pane().scrollTop, 0, 'opening a sentence word’s list starts at the top');
		pane().scrollTop = 140;
		dialog._wordScope = '';
		await settleRender(dialog);
		assert.strictEqual(pane().scrollTop, 0, 'and so does leaving it');
	});

	//A ROW THAT OPENS BELOW THE FOLD HAS NOT OPENED. The pill row is the second
	//element of the column, so this is a backstop rather than the whole defence
	//— but #inner is still a scroll container, and a session scrolled down
	//inside Browse all that chooses a family would open the row above its
	//scroll position.
	it('scrolls the pill row into view when it opens', async () => {
		const scrolled = [];
		const original = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function (options) {
			scrolled.push({ element: this, options });
		};
		try {
			const { updateCollectionConfigurationSnapshot } = await import('../../lib/src/actions/collection.js');
			store.dispatch(updateCollectionConfigurationSnapshot(
				CollectionDescription.deserialize('everything/starred/updated/between/2026-01-01/2026-02-01/')));
			await settleRender(dialog);
			scrolled.length = 0;
			sentencePills()[1].click();
			await settleRender(dialog);
			assert.ok(pillRow(), 'the row is rendered');
			const rowScroll = scrolled.find(entry => entry.element.classList?.contains('pill-row'));
			assert.ok(rowScroll, 'the row that just opened must be scrolled into view');
			//'nearest' scrolls the least that makes it visible, so a row already
			//on screen does not jump.
			assert.deepStrictEqual(rowScroll.options, { block: 'nearest' });

			//AND IT DOES NOT SCROLL AGAIN ON EVERY FIELD EDIT. The selected path
			//leaves and re-enters its own value on each edit (that is what keeps
			//the row open), which Lit reports as a change; scrolling on that
			//would yank the port under someone typing a date. The ADDRESS is what
			//has to move.
			scrolled.length = 0;
			await settleRender(dialog, pillRow());
			const date = pillRow().shadowRoot.querySelector('configure-collection-date');
			await settleRender(dialog, pillRow(), date);
			const input = date.shadowRoot.querySelector('[aria-label="First fixed date"]');
			input.value = '2026-01-15';
			input.dispatchEvent(new Event('change', { bubbles: true }));
			await settleRender(dialog);
			assert.deepStrictEqual(store.getState().collection.snapshot.filterNames,
				['starred', 'updated/between/2026-01-15/2026-02-01'], 'the edit landed');
			assert.ok(!scrolled.some(entry => entry.element.classList?.contains('pill-row')),
				'an edit inside the open row must not re-scroll the dialog');
		} finally {
			Element.prototype.scrollIntoView = original;
		}
	});

	//THE FOOTER'S ROOM IS RESERVED, NOT BORROWED. The bounded-panel machinery
	//this replaces — .anchored-editor's cap, the two panels' inner scrollers,
	//the lists' [data-editor-open] floor — is deleted with the panels it
	//existed for: a one-line row cannot squash, so nothing has to negotiate a
	//height with it. What survives is the one property that was never about the
	//panels: the footer is the last thing in a scrolling column, so its room has
	//to be reserved out of the port rather than taken from it.
	it('keeps the footer reachable at the bottom of a scrolling column', async () => {
		const styles = composerStyles();
		assert.match(styles, /\.buttons\.composer-actions\s*\{[^}]*flex:\s*0 0 auto/,
			'the footer never shrinks to make room for anything above it');
		assert.match(styles, /#inner\s*\{[^}]*scroll-padding-block-end/,
			'and scrolling the list to the port’s bottom edge cannot push it out of view');
		//The scroller idiom is declared in markup, per #759 — the module owns
		//`overflow: auto` and no component restates it.
		const source = await readFile(path.join(REPO_ROOT, 'src/components/configure-collection-dialog.ts'), 'utf8');
		assert.match(source, /class='palette-list scroller'/,
			'the one list is a deliberate inner pane');
		assert.ok(!/scroller/.test(styles.match(/\.pill-row\s*\{[^}]*\}/)?.[0] || ''),
			'the pill row is one line and needs no scroller of its own');
	});

	//A CLOSED DIALOG BUILDS NOTHING (perf blocker, round 10).
	//
	//DialogElement renders unconditionally — closed is a class, not an absence —
	//so the composer's whole build ran behind display:none. And it ran OFTEN:
	//_contextualComposerCandidates embeds the active card id, so every card the
	//user arrowed to changed the candidate set's identity, missed the vocabulary
	//and idle-row memos, and paid for a full completion pass plus a ~300-row
	//ranked sort plus a Lit commit — on the app's hottest path, for a dialog
	//nobody had opened.
	//
	//Driven through the component's own reactive property rather than through a
	//store round-trip, because that is precisely the update the store would
	//schedule, and the counter is the app's own perf instrumentation.
	describe('a closed composer', () => {

		const paletteBuilds = () => window.DEBUG_PERF.data().counters['composer-palette:build'] || 0;

		const whileCounting = async (body) => {
			window.DEBUG_PERF.reset();
			window.DEBUG_PERF.enable();
			try {
				await body();
				return paletteBuilds();
			} finally {
				window.DEBUG_PERF.disable();
				window.DEBUG_PERF.reset();
			}
		};

		it('builds no palette when the active card changes', async () => {
			store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
			await settleRender(dialog);
			assert.strictEqual(dialog.open, false, 'the dialog must actually be closed');
			const builds = await whileCounting(async () => {
				for (const id of ['card-one', 'card-two', 'card-three']) {
					dialog._activeCardID = id;
					await settleRender(dialog);
				}
			});
			assert.strictEqual(builds, 0,
				'navigating cards with the composer closed rebuilt the palette');
		});

		it('renders nothing into its own subtree', async () => {
			store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
			await settleRender(dialog);
			assert.strictEqual(dialog.shadowRoot.querySelector('#collection-palette-list'), null);
			assert.strictEqual(dialog.shadowRoot.querySelector('#collection-composer-input'), null);
		});

		//THE GUARD MUST NOT COST THE FIRST OPEN ITS LIST. Everything the open
		//cycle sets up happens in updated() on the `open` transition, which runs
		//before the render that transition schedules — so the very first render
		//after opening still has a correct, fully built list.
		it('builds a complete list on the next open', async () => {
			store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
			await settleRender(dialog);
			store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
			await settleRender(dialog);
			assert.ok(dialog.shadowRoot.querySelector('#collection-composer-input'),
				'the composer input is back');
			assert.ok(suggestionRows().length, 'and so is the one list');
		});
	});

});
