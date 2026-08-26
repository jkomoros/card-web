/*eslint-env node*/

import { JSDOM } from "jsdom";
import assert from "assert";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const dom = new JSDOM("", { url: "https://example.com/c/main/" });
for (const name of [
  "window", "document", "Document", "HTMLElement", "Element", "Node",
  "customElements", "CSSStyleSheet", "Event", "CustomEvent", "MouseEvent",
  "InputEvent", "KeyboardEvent", "ShadowRoot", "HTMLInputElement",
  "HTMLButtonElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLSlotElement",
]) globalThis[name] = name === "window" ? dom.window : name === "document" ? dom.window.document : dom.window[name];
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.BroadcastChannel = class {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  close() {}
};

window.localStorage.setItem("collection-composer", "on");

//The scope is the signed-in uid, which is empty in these tests.
const HISTORY_KEY = "collection-composer-history:public";

describe("Collection Composer interactions", () => {
  let store;
  let dialog;
  let CollectionDescription;
  let OPEN_CONFIGURE_COLLECTION_DIALOG;
  let CANCEL_CONFIGURE_COLLECTION_DIALOG;

  before(async () => {
    ({ store } = await import("../../lib/src/store.js"));
    const collection = (await import("../../lib/src/reducers/collection.js")).default;
    const editor = (state = { editing: false }, action) =>
      action.type === "TEST_SET_EDITING" ? { ...state, editing: action.value } : state;
    store.addReducers({ collection, editor });
    ({
      OPEN_CONFIGURE_COLLECTION_DIALOG,
      CANCEL_CONFIGURE_COLLECTION_DIALOG,
    } = await import("../../lib/src/actions.js"));
    ({ CollectionDescription } = await import("../../lib/src/collection_description.js"));
    await import("../../lib/src/components/configure-collection-dialog.js");
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

  const suggestionRows = () =>
    Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));

  const suggestionLabels = () =>
    suggestionRows().map((button) => button.textContent.replace(/\s+/g, " ").trim());

  const highlightedRow = () =>
    dialog.shadowRoot.querySelector('[role="option"][data-highlighted]');

  beforeEach(async () => {
    window.history.replaceState({}, "", "/c/main/");
    store.dispatch({ type: "TEST_SET_EDITING", value: false });
    dialog = document.createElement("configure-collection-dialog");
    document.body.append(dialog);
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
    await dialog.updateComplete;
    await dialog.updateComplete;
  });

  afterEach(() => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    dialog.remove();
    window.localStorage.removeItem(HISTORY_KEY);
  });

  //Same guarantee, master's mechanism. This used to pin the ordering inside
  //card-view's own document-level _handleKeyDown ("the gate must run before
  //Ctrl-K"). #740 replaced that handler with declarative bindings dispatched
  //by the shortcut registry, which applies each binding's `when` before its
  //handler — so the property to pin is that BOTH composer entry points
  //declare the shared gate, and that they draw their combos from the
  //canonical table rather than inlining them.
  it("routes global composer shortcuts through the shared modal and ownership gate", async () => {
    const source = await readFile(path.join(REPO_ROOT, "src/components/card-view.ts"), "utf8");
    const binding = (id) => {
      const start = source.indexOf(`id: '${id}',`);
      assert.ok(start >= 0, `card-view must declare the '${id}' binding`);
      const end = source.indexOf("\n\t},", start);
      return source.slice(start, end === -1 ? undefined : end);
    };
    const open = binding("open-collection-composer");
    assert.match(open, /keys: SHORTCUT_COMBOS\['open-collection-composer'\]/,
      "Ctrl-K must come from the canonical combo table");
    //Ctrl-K takes the shared gate minus one term: its own dialog. The spec's
    //keyboard table defines what Ctrl-K does when the composer is already open,
    //and the full gate made that unreachable. Every OTHER modal still refuses
    //it — which is what the selector assertion below actually checks.
    assert.match(open, /when:[^\n]*whenKeyboardNavigatesIgnoringCollectionComposer/,
      "the shared keyboard gate must guard Ctrl-K opening the composer");
    assert.match(open, /collectionComposerEnabled\(\)/);

    const navigate = binding("navigate-to-path");
    assert.match(navigate, /keys: SHORTCUT_COMBOS\['navigate-to-path'\]/,
      "Ctrl-Shift-L must come from the canonical combo table");
    assert.match(navigate, /when: whenKeyboardNavigates/,
      "the shared keyboard gate must guard Ctrl-Shift-L opening Source");
    assert.match(navigate, /openConfigureCollectionDialog\('source'\)/,
      "Ctrl-Shift-L must open the composer in Source mode when it is enabled");
  });

  //A source pin, for the same reason the gate pin above is one: card-view
  //cannot be mounted in this harness (its dependency graph reaches an
  //extensionless import that only the bundler resolves), and the property is
  //structural. An empty collection collapses the card drawer to zero width,
  //taking the collection summary — the composer's only visible entry point —
  //with it, exactly when refining is the only useful thing left to do.
  it("offers the composer from the card view when the collection is empty", async () => {
    const source = await readFile(path.join(REPO_ROOT, "src/components/card-view.ts"), "utf8");
    const start = source.indexOf("get _showCollectionEmptyState()");
    assert.ok(start >= 0, "card-view must decide when the collection reads as empty");
    const predicate = source.slice(start, source.indexOf("\n\t}", start));
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
      "the empty state must not gate on isFallback — that flag IS the empty-collection signal");
    assert.match(predicate, /collectionComposerEnabled\(\)/);
    assert.match(predicate, /finalSortedCards\.length === 0/);

    const emptyStart = source.indexOf("class='collection-empty'");
    assert.ok(emptyStart >= 0, "the card view area must render an empty state");
    const block = source.slice(emptyStart, source.indexOf("</div>", emptyStart));
    //HS-2.6: one sentence-case fragment, no terminal period, no exclamation.
    assert.match(block, /No cards match this collection/);
    assert.ok(!/No cards match this collection[.!]/.test(block), "an empty state takes no terminal period");
    //And the affordance is the same dialog, named with its shortcut.
    assert.match(block, /_handleConfigureCollectionClicked/);
    assert.match(block, /shortcutKeys\('open-collection-composer'\)/);
    assert.match(block, /aria-label=/, "the affordance needs an accessible name (HS-2.5)");
  });

  //The summary is ~133px wide with a two-line clamp, so a draft of more than
  //two clauses is visibly truncated. The spec requires the complete expression
  //to be reachable from it.
  it("exposes the whole collection expression from the truncated summary", async () => {
    const source = await readFile(path.join(REPO_ROOT, "src/components/card-view.ts"), "utf8");
    const start = source.indexOf("class='collection-summary-main'");
    assert.ok(start >= 0);
    const block = source.slice(start, source.indexOf("</button>", start));
    //The tooltip still carries the whole expression, but as a COMMAND rather
    //than a bare state readout (HS-2.5) — same shape as the aria-label below.
    assert.match(block, /title=\$\{`Refine collection: \$\{readableCollectionExpression\(this\._collection\.description\)\}`\}/,
      "hover must reveal the complete expression, in the command form");
    assert.match(block, /aria-label=\$\{`Refine collection: \$\{readableCollectionExpression/,
      "assistive tech must hear the complete expression");
    assert.match(source, /\.collection-summary-main:focus-visible \.collection-summary-expression\s*\{[^}]*line-clamp: unset/,
      "keyboard focus, which gets neither a tooltip nor a label readout, must unfold it");
  });

  //A deployment's own domain is configuration, not a literal (HS-1.4 for
  //APP_TITLE, same reasoning). It was hardcoded in two component literals, so
  //every other deployment of this app trusted somebody else's site.
  it("takes its trusted origins from configuration, not a literal", async () => {
    const source = await readFile(path.join(REPO_ROOT, "src/components/configure-collection-dialog.ts"), "utf8");
    assert.ok(!/'https:\/\/thecompendium\.cards'/.test(source),
      "a deployment domain must not be a literal in a component");
    assert.match(source, /import \{ SITE_DOMAIN \} from '\.\.\/config\.GENERATED\.SECRET\.js'/);
    assert.match(source, /allowedOrigins: COMPOSER_ALLOWED_ORIGINS/);
    assert.match(source, /sourceAllowedOrigins: COMPOSER_ALLOWED_ORIGINS/);
    const start = source.indexOf("const COMPOSER_ALLOWED_ORIGINS");
    const block = source.slice(start, source.indexOf("]);", start));
    assert.match(block, /window\.location\.origin/, "same-origin is always trusted");
    assert.match(block, /SITE_DOMAIN \?/, "the configured domain is the only other one");
  });

  it("drops only the composer's own dialog from the keyboard gate", async () => {
    const { selectKeyboardNavigates, selectKeyboardNavigatesIgnoringCollectionComposer } =
      await import("../../lib/src/selectors.js");
    const { UPDATE_PAGE } = await import("../../lib/src/actions.js");
    const { PAGE_DEFAULT } = await import("../../lib/src/actions/app.js");
    //The gate also requires being on the collection page, which nothing in this
    //harness sets.
    store.dispatch({ type: UPDATE_PAGE, page: PAGE_DEFAULT, location: "/c/main/", pageExtra: "main/" });
    //The composer is open (beforeEach). The general gate refuses; Ctrl-K's
    //does not, which is the whole difference between the two.
    assert.strictEqual(selectKeyboardNavigates(store.getState()), false);
    assert.strictEqual(selectKeyboardNavigatesIgnoringCollectionComposer(store.getState()), true);
    //Everything else the gate guards still refuses it.
    store.dispatch({ type: "TEST_SET_EDITING", value: true });
    assert.strictEqual(selectKeyboardNavigatesIgnoringCollectionComposer(store.getState()), false);
    store.dispatch({ type: "TEST_SET_EDITING", value: false });
    store.dispatch({ type: UPDATE_PAGE, page: "", location: "/c/main/", pageExtra: "main/" });
  });

  //Spec keyboard table: Ctrl-K with the composer already open focuses the
  //input. It used to do nothing at all — the binding was gated out, so the
  //reducer never saw the second open.
  it("refocuses the composer input when asked to open while already open", async () => {
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    const elsewhere = dialog.shadowRoot.querySelector('[role="option"]') ||
      dialog.shadowRoot.querySelector(".composer-actions .primary");
    elsewhere.focus();
    assert.notStrictEqual(dialog.shadowRoot.activeElement, input);
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG });
    await dialog.updateComplete;
    await dialog.updateComplete;
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
    assert.strictEqual(dialog.shadowRoot.activeElement, input);
  });

  it("clicking an Add suggestion updates only the draft", async () => {
    const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    const starred = buttons.find((button) => button.textContent.includes("Add Starred"));
    assert.ok(starred);
    const beforePath = window.location.pathname;
    starred.click();
    await dialog.updateComplete;
    const state = store.getState();
    assert.deepStrictEqual(state.collection.snapshot.filterNames, ["starred"]);
    assert.deepStrictEqual(state.collection.active.filterNames, []);
    assert.strictEqual(window.location.pathname, beforePath);
    assert.match(dialog.shadowRoot.querySelector(".expression").textContent, /Starred/);
    assert.strictEqual(dialog.open, true);
  });

  it("adds a discovered concrete value as its exact URL-native filter", async () => {
    dialog._composerCandidates = [{
      filter: "inductively-knowable",
      category: "tag",
      label: "Tagged “Inductively Knowable”",
      detail: "Keeps cards tagged Inductively Knowable",
      aliases: ["tag", "inductively knowable"],
    }];
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "tag inductively";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Tagged “Inductively Knowable”"));
    assert.ok(suggestion);
    assert.match(suggestion.textContent, /inductively-knowable/);
    suggestion.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["inductively-knowable"]);
  });

  it("surfaces a diversified, durable context from the active card", async () => {
    dialog._composerCandidates = [
      { filter: "systems", category: "tag", label: "Tagged “Systems”", detail: "", valueLabel: "Systems", clauseLabel: "Tagged Systems" },
      { filter: "half-baked", category: "section", label: "In section “Half Baked”", detail: "", valueLabel: "Half Baked", clauseLabel: "Section Half Baked" },
      { filter: "working-notes", category: "card type", label: "Card type: Working Notes", detail: "", valueLabel: "Working Notes", clauseLabel: "Card Type Working Notes" },
    ];
    dialog._activeCardID = "card-123";
    dialog._activeCard = {
      section: "half-baked",
      tags: ["systems"],
      card_type: "working-notes",
      author: "",
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

  it("explains preview counts as consequences without changing row order", async () => {
    const before = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .map((button) => button.id);
    dialog._previewCounts = {
      "current-draft-preview": 12,
      "add:starred": 5,
      "add:unread": 19,
    };
    await dialog.updateComplete;
    const after = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    assert.deepStrictEqual(after.map((button) => button.id), before);
    assert.match(dialog.shadowRoot.querySelector(".expression").textContent, /12 cards/);
    assert.match(after.find((button) => button.textContent.includes("Add Starred")).textContent, /5 cards · 7 fewer/);
    assert.match(after.find((button) => button.textContent.includes("Add Unread")).textContent, /19 cards · 7 more/);
    assert.strictEqual(
      Array.from(dialog.shadowRoot.querySelectorAll("button"))
        .find((button) => button.classList.contains("primary")).textContent,
      "Open 12 cards"
    );
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    assert.doesNotMatch(dialog.shadowRoot.querySelector(".expression").textContent, /12 cards/);
  });

  //Tab in the empty state used to do nothing at all: it was gated on the input
  //having text, so the keyboard could not reach a list of destinations without
  //first typing something to make them go away.
  it("Tab reaches the empty-state list, then materializes the row it landed on", async () => {
    assert.strictEqual(highlightedRow(), null);
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(highlightedRow().id, "collection-suggestion-0",
      "the first Tab makes the list keyboard-enterable without typing");
    assert.match(highlightedRow().textContent, /Add Starred/);
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, [],
      "and changes nothing on its own");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"],
      "the second Tab materializes that row into the draft");
    assert.strictEqual(window.location.pathname, "/c/main/");
    assert.match(dialog.shadowRoot.querySelector(".draft-receipt").textContent, /Added Starred/);
  });

  //A destination is not a transformation, so Tab on one is the spec's labeled
  //secondary action: it copies the destination's expression into the draft
  //instead of leaving for it.
  it("Tab on a destination copies its expression into the draft, and says so", async () => {
    await seedRecents([["main/starred/sort/recent/", 2]]);
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.match(highlightedRow().textContent, /Main AND Starred/);
    assert.match(dialog.shadowRoot.querySelector(".key-hints").textContent, /Tab copies it into the draft/);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.strictEqual(store.getState().collection.snapshot.sortName, "recent");
    assert.strictEqual(window.location.pathname, "/c/main/", "Tab does not navigate");
    assert.match(dialog.shadowRoot.querySelector(".draft-receipt").textContent,
      /Replaced the draft with Main AND Starred/);
  });

  //Counts rank the list when it is built. They may keep updating a row the user
  //is pointing at, but they may not move it out from under them.
  it("ranks empty rows down when the list is built, and never once it is focused", async () => {
    const indexOf = (text) => suggestionLabels().findIndex((label) => label.includes(text));
    assert.strictEqual(indexOf("Add Starred"), 0);
    dialog._previewCounts = { "current-draft-preview": 12, "add:starred": 0, "add:unread": 5 };
    await dialog.updateComplete;
    assert.ok(indexOf("Add Unread") < indexOf("Add Starred"),
      "a row that yields no cards never sits above one that yields some");
    assert.notStrictEqual(indexOf("Add Starred"), 0);
    const withoutCounts = () => suggestionLabels().map((label) => label.replace(/\d+ (cards?|fewer|more)/g, ""));
    const focusedOrder = withoutCounts();
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    const highlighted = highlightedRow().textContent;
    dialog._previewCounts = { ...dialog._previewCounts, "add:unread": 0, "add:starred": 9 };
    await dialog.updateComplete;
    assert.deepStrictEqual(
      withoutCounts(),
      focusedOrder,
      "the focused list does not reorder when late counts arrive"
    );
    assert.strictEqual(
      highlightedRow().textContent.replace(/\d+ (cards?|fewer|more)/g, ""),
      highlighted.replace(/\d+ (cards?|fewer|more)/g, ""),
      "and the row the user is pointing at is still the same row"
    );
  });

  it("opens the edited draft only from the explicit primary action", async () => {
    const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    buttons.find((button) => button.textContent.includes("Add Starred")).click();
    await dialog.updateComplete;
    const primary = Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Open this collection"));
    primary.click();
    await dialog.updateComplete;
    assert.match(window.location.pathname, /starred/);
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
    assert.strictEqual(store.getState().collection.snapshot, null);
  });

  it("keeps the selected card when Enter adds and opens a suggestion", async () => {
    dialog._draftSelectedCard = "card-123";
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    const highlighted = dialog.shadowRoot.querySelector('[role="option"][data-highlighted]');
    assert.match(highlighted.textContent, /Starred/);
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/starred/card-123");
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
  });

  //The state every user is in after their first Tab. The Enter test above types
  //"star" first, so the row that happens to be highlighted is also the row the
  //user wanted; that coincidence hid a flow where Ctrl-K → type → Tab → Enter
  //closed the dialog, left the URL alone, and discarded the clause in silence.
  it("commits the composed draft when Enter follows Tab, with recents on offer", async () => {
    await seedRecents([["main/", 9], ["main/starred/sort/recent/", 2]]);
    assert.strictEqual(highlightedRow(), null,
      "nothing is highlighted before the user points at a row, so no row looks primary");
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.match(highlightedRow().textContent, /Starred/,
      "typing makes the list interpretations of what was typed, and the top one is highlighted");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.strictEqual(highlightedRow(), null,
      "Tab rebuilt the list, and nothing in the new list is what the user was pointing at");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/starred/",
      "Enter with no highlighted suggestion opens the draft the user just composed");
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
    await import("../../lib/src/components/snack-bar.js");
    const bar = document.createElement("snack-bar");
    document.body.append(bar);
    await bar.updateComplete;
    return bar;
  };

  const visibleToasts = (bar) =>
    Array.from(bar.shadowRoot.querySelectorAll(".toast"));

  it("shows the navigation receipt on screen, with a working Undo", async () => {
    for (const entry of [...store.getState().app.snackbars]) {
      store.dispatch({ type: "DISMISS_SNACKBAR", snackbarID: entry.id });
    }
    const bar = await mountSnackBar();
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/starred/");

    await bar.updateComplete;
    const toasts = visibleToasts(bar);
    assert.strictEqual(toasts.length, 1, "the receipt must be on screen, not merely in the store");
    assert.match(toasts[0].textContent, /Now showing/,
      "the toast must carry the receipt's own words");
    //'info' is the honest kind: nothing was written to a server, so it gets no
    //status dot. 'committed'/'queued' are write-outcome words (snackbar-copy).
    assert.strictEqual(toasts[0].dataset.kind, "info");
    assert.strictEqual(toasts[0].querySelector(".dot"), null);
    const undo = Array.from(toasts[0].querySelectorAll("button"))
      .find((button) => button.textContent.trim() === "Undo");
    assert.ok(undo, "a receipt with nothing to press is not a receipt");

    undo.click();
    await bar.updateComplete;
    //Pressing it retires the receipt and says nothing further: the guard
    //agreed the user was still where the receipt described.
    assert.deepStrictEqual(store.getState().app.snackbars, []);
    bar.remove();
  });

  it("refuses the receipt's Undo out loud once the user has moved on", async () => {
    for (const entry of [...store.getState().app.snackbars]) {
      store.dispatch({ type: "DISMISS_SNACKBAR", snackbarID: entry.id });
    }
    const bar = await mountSnackBar();
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await bar.updateComplete;

    //The user wanders off somewhere the receipt never described.
    window.history.replaceState({}, "", "/c/everything/reads/");
    const undo = Array.from(bar.shadowRoot.querySelectorAll(".toast button"))
      .find((button) => button.textContent.trim() === "Undo");
    undo.click();
    await bar.updateComplete;
    //A refusal is never silent (HOUSE-STYLE §3.5): the receipt is replaced by
    //a plain message rather than quietly doing nothing.
    const snackbars = store.getState().app.snackbars;
    assert.strictEqual(snackbars.length, 1);
    assert.match(snackbars[0].message, /nothing to undo/);
    assert.strictEqual(snackbars[0].action, undefined,
      "the refusal has nothing to press; offering Undo again would be a lie");
    bar.remove();
    window.history.replaceState({}, "", "/c/main/");
  });

  it("Enter on an untouched draft closes the composer without navigating", async () => {
    await seedRecents([["main/starred/", 4]]);
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/main/");
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
    assert.strictEqual(store.getState().collection.snapshot, null);
  });

  it("only an explicit Arrow key makes a suggestion the Enter target", async () => {
    await seedRecents([["main/starred/", 4]]);
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    //Arrowing into a list with nothing highlighted lands on the first row
    //rather than skipping one.
    assert.strictEqual(highlightedRow().id, "collection-suggestion-0");
    //The seeded recent (Main AND Starred) and the "Add Starred" refinement
    //resolve to the identical collection, so only one row offers it — the
    //refinement, which teaches the transformation. Either way Enter lands on
    //the same collection.
    assert.match(highlightedRow().textContent, /Add Starred/);
    assert.ok(!suggestionLabels().some((label) => label.includes("Main AND Starred")),
      "the recent that duplicates a refinement's destination is not offered twice");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/starred/");
  });

  //Recents are destinations, and the collection you are already standing in is
  //not one: opening it throws the draft away and changes nothing.
  it("never offers the collection already on screen as a recent destination", async () => {
    await seedRecents([["main/", 9], ["main/starred/sort/recent/", 2]]);
    //This one IS the collection visited before the active one, which is the
    //only recent allowed to claim a direction.
    assert.ok(suggestionLabels().some((label) => label.includes("Back to Main AND Starred")),
      "an unrelated recent is still offered");
    assert.ok(!suggestionLabels().some((label) => /(Open|Back to) Main(?! AND)/.test(label)),
      "the active collection is not offered even before the draft diverges");
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    //Now the draft is Main AND Starred, so deduping against the draft alone
    //would let "Back to Main" — the collection on screen — reappear.
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.ok(!suggestionLabels().some((label) => /(Open|Back to) Main(?! AND)/.test(label)),
      "the active collection stays suppressed once the draft diverges from it");
    assert.ok(suggestionLabels().some((label) => label.includes("Back to Main AND Starred")),
      "and the recent that is genuinely a different collection survives");
  });

  it("says so, in the dialog, when a chosen destination is already open", async () => {
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    //"Remove Starred" rebuilds exactly the collection already on screen.
    assert.match(highlightedRow().textContent, /Remove Starred/);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true,
      "the composer stays open rather than vanishing with no explanation");
    assert.match(dialog.shadowRoot.querySelector(".activation-message").textContent,
      /This collection is already open\./);
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"],
      "the draft survives");
    assert.strictEqual(window.location.pathname, "/c/main/");
  });

  //mouseenter fires whenever rows shift under a resting cursor, so a re-render
  //used to hand whatever row landed under the pointer the power to decide what
  //Enter does.
  it("a re-render under a resting cursor does not take the highlight", async () => {
    await seedRecents([["main/starred/", 4]]);
    const rows = suggestionRows();
    assert.ok(rows.length > 3);
    rows[3].dispatchEvent(new MouseEvent("mouseenter"));
    await dialog.updateComplete;
    assert.strictEqual(highlightedRow(), null,
      "mouseenter without a mousemove is not evidence the pointer moved");
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(highlightedRow().id, "collection-suggestion-0");
    suggestionRows()[3].dispatchEvent(new MouseEvent("mouseenter"));
    await dialog.updateComplete;
    assert.strictEqual(highlightedRow().id, "collection-suggestion-0",
      "the keyboard keeps the highlight across a re-render the user did not point at");
    //Genuine hovering still works.
    suggestionRows()[3].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(highlightedRow().id, "collection-suggestion-3");
    //And once the pointer has proven it moves, mouseenter is honored again.
    suggestionRows()[1].dispatchEvent(new MouseEvent("mouseenter"));
    await dialog.updateComplete;
    assert.strictEqual(highlightedRow().id, "collection-suggestion-1");
  });

  it("Escape cancels the draft without changing the active collection", async () => {
    const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    buttons.find((button) => button.textContent.includes("Add Starred")).click();
    await dialog.updateComplete;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
    assert.strictEqual(store.getState().collection.snapshot, null);
    assert.deepStrictEqual(store.getState().collection.active.filterNames, []);
    assert.strictEqual(window.location.pathname, "/c/main/");
  });

  it("keeps the draft open and explains when editing blocks navigation", async () => {
    const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    buttons.find((button) => button.textContent.includes("Add Starred")).click();
    await dialog.updateComplete;
    store.dispatch({ type: "TEST_SET_EDITING", value: true });
    const primary = Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Open this collection"));
    primary.click();
    await dialog.updateComplete;
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.strictEqual(window.location.pathname, "/c/main/");
    assert.match(dialog.shadowRoot.querySelector(".activation-message").textContent, /Finish or cancel/);
  });

  it("renders accepted clauses with explicit edit, remove, and Undo controls", async () => {
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Add Starred"));
    suggestion.click();
    await dialog.updateComplete;
    const clause = dialog.shadowRoot.querySelector(".expression-clause");
    assert.match(clause.textContent, /Starred/);
    assert.strictEqual(clause.querySelector(".expression-clause-label").getAttribute("aria-label"), "Edit Starred filter");
    clause.querySelector(".expression-clause-remove").click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
    assert.match(dialog.shadowRoot.querySelector(".draft-receipt").textContent, /Removed Starred/);
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Undo")).click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
  });

  it("uses two-step Backspace to select and then remove the last clause", async () => {
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Add Starred"));
    suggestion.click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.ok(dialog.shadowRoot.querySelector(".expression-clause").hasAttribute("data-selected"));
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
  });

  it("does not interpret composing keystrokes as clause commands", async () => {
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Add Starred"));
    suggestion.click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Backspace",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Backspace",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    }));
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.strictEqual(dialog.shadowRoot.querySelector(".expression-clause").hasAttribute("data-selected"), false);
  });

  it("preserves draft Undo while keyboard-selecting a clause", async () => {
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Add Starred"));
    suggestion.click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    const undo = Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Undo"));
    assert.ok(undo);
    undo.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
  });

  it("zooms from a clause into its builder control and Escape returns", async () => {
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Add Starred"));
    suggestion.click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    const filter = dialog.shadowRoot.querySelector("configure-collection-filter");
    assert.strictEqual(filter.shadowRoot.querySelector("select"), null);
    assert.strictEqual(dialog.shadowRoot.activeElement?.textContent, "Done editing");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, true);
    assert.strictEqual(dialog.shadowRoot.querySelector("configure-collection-filter"), null);
    assert.strictEqual(dialog.shadowRoot.activeElement?.id, "collection-composer-input");

    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.ok(dialog.shadowRoot.querySelector(".expression-clause").hasAttribute("data-selected"));
  });

  it("focuses a configurable clause value and saves direct edits", async () => {
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "inductively knowable";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    const querySuggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes('Text contains “inductively knowable”'));
    assert.ok(querySuggestion);
    querySuggestion.click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    const filter = dialog.shadowRoot.querySelector("configure-collection-filter");
    const queryInput = filter.shadowRoot.querySelector(".pieces input");
    assert.strictEqual(filter.shadowRoot.activeElement, queryInput);
    queryInput.value = "mechanistically knowable";
    queryInput.dispatchEvent(new Event("change", { bubbles: true }));
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["query/mechanistically knowable"]);
  });

  it("manual builder collapse disarms the edited clause", async () => {
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Add Starred"));
    suggestion.click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Done editing")).click();
    await dialog.updateComplete;
    assert.strictEqual(dialog.shadowRoot.querySelector("configure-collection-filter"), null);
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    assert.strictEqual(dialog.shadowRoot.activeElement, input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.ok(dialog.shadowRoot.querySelector(".expression-clause").hasAttribute("data-selected"));
  });

  //Removing the clause the editor is open on used to leave the panel expanded
  //with nothing in it: _selectedClauseIndex went to -1 while _builderExpanded
  //stayed true, so '' rendered into a still-visible .builder container.
  it("collapses the clause editor when the clause being edited is removed", async () => {
    const add = (label) => {
      const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
        .find((button) => button.textContent.includes(label));
      assert.ok(suggestion, `no suggestion labeled ${label}`);
      suggestion.click();
      return dialog.updateComplete;
    };
    await add("Add Starred");
    dialog.shadowRoot.querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    assert.ok(dialog.shadowRoot.querySelector(".clause-editor"));
    dialog.shadowRoot.querySelector(".expression-clause-remove").click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
    assert.strictEqual(dialog.shadowRoot.querySelector(".clause-editor"), null);
    assert.strictEqual(dialog.shadowRoot.querySelector(".builder"), null,
      "an empty builder container must not stay on screen");
  });

  it("keeps editing the same clause when a different one is removed", async () => {
    const add = (label) => {
      const suggestion = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
        .find((button) => button.textContent.includes(label));
      assert.ok(suggestion, `no suggestion labeled ${label}`);
      suggestion.click();
      return dialog.updateComplete;
    };
    await add("Add Starred");
    await add("Add Unread");
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred", "unread"]);
    const clauses = () => Array.from(dialog.shadowRoot.querySelectorAll(".expression-clause"));
    //Edit the second clause, then remove the first: the editor must follow the
    //clause, which has just been renumbered from index 1 to index 0.
    clauses()[1].querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    assert.ok(dialog.shadowRoot.querySelector(".clause-editor"));
    clauses()[0].querySelector(".expression-clause-remove").click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["unread"]);
    const editor = dialog.shadowRoot.querySelector(".clause-editor");
    assert.ok(editor, "the editor must stay open on the clause it was editing");
    assert.match(editor.textContent, /Unread/);
  });

  it("browses a categorized catalog and adds an ordinary filter without opening", async () => {
    dialog._composerCandidates = [{
      filter: "inductively-knowable",
      category: "tag",
      label: "Tagged “Inductively Knowable”",
      detail: "Keeps cards tagged Inductively Knowable",
      aliases: ["tag", "inductively knowable"],
    }];
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    assert.strictEqual(input.getAttribute("aria-controls"), "collection-filter-catalog");
    assert.match(dialog.shadowRoot.textContent, /Dates/);
    assert.match(dialog.shadowRoot.textContent, /Tags and sections/);
    assert.ok(dialog.shadowRoot.querySelector("[aria-label='Starting collection set']"));
    assert.ok(dialog.shadowRoot.querySelector("[aria-label='Card order']"));
    assert.ok(dialog.shadowRoot.querySelector("[aria-label='Collection view']"));
    const starred = Array.from(dialog.shadowRoot.querySelectorAll("#collection-filter-catalog [role=option]"))
      .find((button) => button.textContent.includes("Starred"));
    assert.ok(starred);
    starred.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.strictEqual(window.location.pathname, "/c/main/");
    assert.match(dialog.shadowRoot.querySelector("#collection-filter-catalog").textContent, /Already in this collection/);
  });

  it("makes capped catalog categories explicit and expandable", async () => {
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const catalog = dialog.shadowRoot.querySelector("#collection-filter-catalog");
    const before = catalog.querySelectorAll("[data-filter]").length;
    //The visible label is a grammatical fragment for every category; the
    //category lives in the accessible name, where it can be a phrase.
    const more = Array.from(catalog.querySelectorAll(".catalog-more"))
      .find((button) => button.getAttribute("aria-label").includes("filters in card properties"));
    assert.ok(more);
    assert.match(more.textContent, /^\s*Show \d+ more\s*$/);
    assert.match(more.getAttribute("aria-label"), /^Show \d+ more filters in card properties$/);
    more.click();
    await dialog.updateComplete;
    const after = dialog.shadowRoot.querySelectorAll("#collection-filter-catalog [data-filter]").length;
    assert.ok(after > before);
    const fewer = Array.from(dialog.shadowRoot.querySelectorAll("#collection-filter-catalog .catalog-more"))
      .find((button) => button.getAttribute("aria-label") === "Show fewer filters in card properties");
    assert.ok(fewer);
    assert.match(fewer.textContent, /^\s*Show fewer\s*$/);
  });

  it("searches catalog aliases and configures a filter before committing it", async () => {
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "text";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    const query = Array.from(dialog.shadowRoot.querySelectorAll("#collection-filter-catalog [role=option]"))
      .find((button) => button.textContent.includes("Query"));
    assert.ok(query);
    assert.match(query.textContent, /configure/i);
    query.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
    const pending = dialog.shadowRoot.querySelector(".pending-filter-editor configure-collection-filter");
    assert.ok(pending);
    assert.strictEqual(pending.shadowRoot.querySelector("select"), null);
    const add = Array.from(dialog.shadowRoot.querySelectorAll(".pending-filter-actions button"))
      .find((button) => button.textContent.includes("Add configured filter"));
    assert.strictEqual(add.disabled, true);
    const queryInput = pending.shadowRoot.querySelector(".pieces input");
    queryInput.value = "inductively knowable";
    queryInput.dispatchEvent(new Event("change", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(add.disabled, false);
    add.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["query/inductively knowable"]);
    assert.match(dialog.shadowRoot.textContent, /Added Text contains “inductively knowable”/);
  });

  it("routes typed configurable families through guided controls before changing the draft", async () => {
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "updated";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll("[role=option]"))
      .find((button) => button.textContent.includes("Configure Updated"));
    assert.ok(suggestion);
    assert.match(suggestion.textContent, /configure/i);
    suggestion.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
    assert.ok(dialog.shadowRoot.querySelector(".pending-filter-editor"));
    assert.strictEqual(dialog.shadowRoot.querySelector(".pending-filter-editor configure-collection-filter").value, "updated/after/7-days-ago");
  });

  it("routes nested collection expressions to discoverable Source mode without changing the draft", async () => {
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "exclude";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    const suggestion = Array.from(dialog.shadowRoot.querySelectorAll("[role=option]"))
      .find((button) => button.textContent.includes("Edit Exclude in Source"));
    assert.ok(suggestion);
    assert.match(suggestion.textContent, /source/i);
    assert.strictEqual(suggestion.querySelector(".suggestion-action").textContent, "edit");
    suggestion.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
    assert.strictEqual(dialog._entryMode, "source");
    assert.strictEqual(dialog.shadowRoot.querySelector("#collection-source-input").value, "/c/exclude/");
    assert.match(dialog.shadowRoot.querySelector(".source-status").textContent, /needs 1 more value/);
    assert.match(dialog.shadowRoot.querySelector("#collection-source-completions").textContent, /Working Notes/);
    const source = dialog.shadowRoot.querySelector("#collection-source-input");
    source.value = "/c/exclude/working-n/";
    source.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.match(dialog.shadowRoot.querySelector("#collection-source-completions").textContent, /Working Notes/);
  });

  it("supports keyboard catalog search and lets Escape back out one layer", async () => {
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "query";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await dialog.updateComplete;
    assert.ok(dialog.shadowRoot.querySelector(".pending-filter-editor"));
    const pendingInput = dialog.shadowRoot.querySelector(".pending-filter-editor configure-collection-filter").shadowRoot.querySelector("input");
    pendingInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    await dialog.updateComplete;
    assert.strictEqual(dialog.shadowRoot.querySelector(".pending-filter-editor"), null);
    assert.ok(dialog.shadowRoot.querySelector("#collection-filter-catalog"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(dialog.shadowRoot.querySelector("#collection-filter-catalog"), null);
    assert.strictEqual(dialog.open, true);
  });

  it("offers a safe rolling date default without requiring a meaningless edit", async () => {
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const updated = Array.from(dialog.shadowRoot.querySelectorAll("#collection-filter-catalog [role=option]"))
      .find((button) => button.textContent.includes("Updated"));
    assert.ok(updated);
    updated.click();
    await dialog.updateComplete;
    const add = Array.from(dialog.shadowRoot.querySelectorAll(".pending-filter-actions button"))
      .find((button) => button.textContent.includes("Add configured filter"));
    assert.strictEqual(add.disabled, false);
    const pending = dialog.shadowRoot.querySelector(".pending-filter-editor configure-collection-filter");
    assert.strictEqual(pending.value, "updated/after/7-days-ago");
    const dateControl = pending.shadowRoot.querySelector("configure-collection-date");
    await dateControl.updateComplete;
    assert.match(dateControl.shadowRoot.textContent, /Rolling date/);
    assert.match(dateControl.shadowRoot.textContent, /A time ago/);
    add.click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["updated/after/7-days-ago"]);
  });

  //A readback test: assert what the control DISPLAYS, not what confirming it
  //produces. The comparison <select> rendered at selectedIndex 0 ("Before")
  //while the seeded filter said "after", and a 41-test suite that only ever
  //asserted the committed value never saw it.
  it("displays the comparison the seeded date filter actually names", async () => {
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("#collection-filter-catalog [role=option]"))
      .find((button) => button.textContent.includes("Updated")).click();
    await dialog.updateComplete;
    const pending = dialog.shadowRoot.querySelector(".pending-filter-editor configure-collection-filter");
    assert.strictEqual(pending.value, "updated/after/7-days-ago");
    const dateControl = pending.shadowRoot.querySelector("configure-collection-date");
    await dateControl.updateComplete;
    const comparison = dateControl.shadowRoot.querySelector('[aria-label="Date comparison"]');
    assert.strictEqual(comparison.value, "after");
    assert.strictEqual(comparison.selectedIndex, 1);
    assert.strictEqual(comparison.options[comparison.selectedIndex].textContent, "After");
    assert.deepStrictEqual(
      Array.from(comparison.options).filter((option) => option.selected).map((option) => option.value),
      ["after"]
    );
    //And the same control, reopened on an applied clause, still reads back what
    //the clause says rather than the first option.
    Array.from(dialog.shadowRoot.querySelectorAll(".pending-filter-actions button"))
      .find((button) => button.textContent.includes("Add configured filter")).click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    const appliedDate = dialog.shadowRoot
      .querySelector("configure-collection-filter").shadowRoot
      .querySelector("configure-collection-date");
    await appliedDate.updateComplete;
    assert.strictEqual(
      appliedDate.shadowRoot.querySelector('[aria-label="Date comparison"]').value,
      "after"
    );
  });

  it("reads back every date sub-control rather than its first option", async () => {
    const dateControl = document.createElement("configure-collection-date");
    dateControl.value = "between/last-thursday/yesterday";
    document.body.append(dateControl);
    try {
      await dateControl.updateComplete;
      const displayed = (label) => {
        const select = dateControl.shadowRoot.querySelector(`[aria-label="${label}"]`);
        return select.options[select.selectedIndex].value;
      };
      assert.strictEqual(displayed("Date comparison"), "between");
      assert.strictEqual(displayed("First rolling date kind"), "weekday");
      assert.strictEqual(displayed("First rolling weekday"), "thursday");
      assert.strictEqual(displayed("Second rolling date kind"), "special");
      assert.strictEqual(displayed("Second rolling special date"), "yesterday");
    } finally {
      dateControl.remove();
    }
  });

  it("configures each boundary of a rolling date range independently", async () => {
    const dateControl = document.createElement("configure-collection-date");
    dateControl.value = "between/3-days-ago/yesterday";
    dateControl.addEventListener("filter-modified-complex", (event) => {
      dateControl.value = event.detail.value;
    });
    document.body.append(dateControl);
    try {
      await dateControl.updateComplete;
      assert.strictEqual(
        dateControl.shadowRoot.querySelector('[aria-label="First rolling date kind"]').value,
        "offset"
      );
      assert.strictEqual(
        dateControl.shadowRoot.querySelector('[aria-label="First rolling date amount"]').value,
        "3"
      );
      const secondSpecial = dateControl.shadowRoot.querySelector('[aria-label="Second rolling special date"]');
      assert.strictEqual(secondSpecial.value, "yesterday");
      secondSpecial.value = "today";
      secondSpecial.dispatchEvent(new Event("change", { bubbles: true }));
      await dateControl.updateComplete;
      assert.strictEqual(dateControl.value, "between/3-days-ago/today");
      assert.strictEqual(
        dateControl.shadowRoot.querySelector('[aria-label="First rolling date amount"]').value,
        "3"
      );
    } finally {
      dateControl.remove();
    }
  });

  it("supports fixed and rolling dates in the same range", async () => {
    const dateControl = document.createElement("configure-collection-date");
    dateControl.value = "between/2026-08-01/yesterday";
    document.body.append(dateControl);
    try {
      await dateControl.updateComplete;
      const boundaries = dateControl.shadowRoot.querySelectorAll(".date-boundary");
      assert.strictEqual(boundaries.length, 2);
      assert.strictEqual(boundaries[0].querySelector('input[value="absolute"]').checked, true);
      assert.strictEqual(boundaries[0].querySelector('input[type="date"]').value, "2026-08-01");
      assert.strictEqual(boundaries[1].querySelector('input[value="relative"]').checked, true);
      assert.strictEqual(
        boundaries[1].querySelector('[aria-label="Second rolling special date"]').value,
        "yesterday"
      );
    } finally {
      dateControl.remove();
    }
  });

  it("configures card-valued filters from titled choices instead of raw IDs", async () => {
    dialog._cardTagInfos = {
      "card-1": { id: "card-1", title: "Inductively Knowable" },
      "card-2": { id: "card-2", title: "Mechanistic Magic" },
    };
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "similar";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector("[data-filter='similar']").click();
    await dialog.updateComplete;
    const pending = dialog.shadowRoot.querySelector(".pending-filter-editor configure-collection-filter");
    const keyCard = pending.shadowRoot.querySelector("configure-collection-key-card");
    await keyCard.updateComplete;
    const cardSelect = keyCard.shadowRoot.querySelector("select");
    assert.match(cardSelect.textContent, /Inductively Knowable/);
    assert.strictEqual(keyCard.shadowRoot.querySelector("button"), null);
    cardSelect.value = "card-1";
    cardSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(pending.value, "similar/card-1");
    const add = Array.from(dialog.shadowRoot.querySelectorAll(".pending-filter-actions button"))
      .find((button) => button.textContent.includes("Add configured filter"));
    assert.strictEqual(add.disabled, false);
  });

  it("shows contributor names while preserving durable author IDs", async () => {
    dialog._userIDs = ["alex-uid", "sam-uid"];
    dialog._userInfos = {
      "alex-uid": { id: "alex-uid", title: "Alex Komoroske" },
      "sam-uid": { id: "sam-uid", title: "Sam Example" },
    };
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "author";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector("[data-filter='author']").click();
    await dialog.updateComplete;
    const pending = dialog.shadowRoot.querySelector(".pending-filter-editor configure-collection-filter");
    const authorSelect = pending.shadowRoot.querySelector(".pieces select");
    assert.match(authorSelect.textContent, /Me/);
    assert.match(authorSelect.textContent, /Alex Komoroske/);
    assert.match(authorSelect.textContent, /Sam Example/);
    authorSelect.value = "sam-uid";
    authorSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(pending.value, "author/sam-uid");
  });

  it("edits setup and applied catalog items through the same visual surface", async () => {
    const starred = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
      .find((button) => button.textContent.includes("Add Starred"));
    starred.click();
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const view = dialog.shadowRoot.querySelector("[aria-label='Collection view']");
    view.value = "web";
    view.dispatchEvent(new Event("change", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(store.getState().collection.snapshot.viewMode, "web");
    assert.ok(store.getState().collection.snapshot.viewModeExtra);
    dialog._cardTagInfos = { "card-2": { id: "card-2", title: "Mechanistic Magic" } };
    await dialog.updateComplete;
    const focusCard = dialog.shadowRoot.querySelector(".catalog-setup configure-collection-key-card");
    await focusCard.updateComplete;
    const focusCardSelect = focusCard.shadowRoot.querySelector("select");
    assert.match(focusCardSelect.textContent, /First card in the collection/);
    assert.match(focusCardSelect.textContent, /Mechanistic Magic/);
    focusCardSelect.value = "card-2";
    focusCardSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(store.getState().collection.snapshot.viewModeExtra, "card-2");
    const appliedStarred = Array.from(dialog.shadowRoot.querySelectorAll("#collection-filter-catalog [role=option]"))
      .find((button) => button.textContent.includes("Starred"));
    appliedStarred.click();
    await dialog.updateComplete;
    assert.strictEqual(dialog.shadowRoot.querySelector("#collection-filter-catalog"), null);
    const editor = dialog.shadowRoot.querySelector("configure-collection-filter");
    assert.ok(editor);
    assert.strictEqual(editor.shadowRoot.querySelector("select"), null);
    assert.match(editor.shadowRoot.textContent, /Remove filter/);
    assert.match(dialog.shadowRoot.textContent, /Done editing/);
    editor.shadowRoot.querySelector(".remove-filter").click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, []);
    assert.strictEqual(dialog.shadowRoot.querySelector("configure-collection-filter"), null);
  });

  it("opens Source mode from the current route with the exact text selected", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    window.history.replaceState({}, "", "/c/everything/starred/card-7");
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    assert.ok(input);
    assert.strictEqual(input.value, "/c/everything/starred/card-7");
    assert.strictEqual(input.selectionStart, 0);
    assert.strictEqual(input.selectionEnd, input.value.length);
    assert.match(dialog.shadowRoot.querySelector(".source-status").textContent, /Ready to open/);
    assert.match(dialog.shadowRoot.textContent, /Opens on/);
  });

  it("hands visual composers into Source at the add-next position", async () => {
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Edit source")).click();
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    assert.strictEqual(input.selectionStart, input.value.length);
    assert.strictEqual(input.selectionEnd, input.value.length);
    input.value = `${input.value}upd`;
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "upd" }));
    await dialog.updateComplete;
    assert.strictEqual(input.value, "/c/upd/");
    assert.match(dialog.shadowRoot.textContent, /Updated/);
  });

  it("preserves invalid source and opens a valid route with its selected card", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    const open = () => dialog.shadowRoot.querySelector(".composer-actions .primary");
    input.value = "updated/before/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(input.value, "updated/before/");
    assert.strictEqual(open().disabled, true);
    assert.strictEqual(window.location.pathname, "/c/main/");

    input.value = "/c/everything/starred/card-9";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(open().disabled, false);
    open().click();
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/everything/starred/card-9");
    assert.strictEqual(dialog.open, false);
  });

  it("keeps source intact when editing blocks navigation", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "/c/everything/starred/card-9";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    store.dispatch({ type: "TEST_SET_EDITING", value: true });
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".composer-actions .primary").click();
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/main/");
    assert.strictEqual(dialog.open, true);
    assert.strictEqual(input.value, "/c/everything/starred/card-9");
    assert.match(dialog.shadowRoot.querySelector(".activation-message").textContent, /Finish or cancel/);
  });

  it("makes incomplete date grammar discoverable through completion", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "updated/before/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.match(dialog.shadowRoot.textContent, /today/);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(input.value, "updated/before/today/");
    assert.strictEqual(dialog.shadowRoot.querySelector(".composer-actions .primary").disabled, false);
  });

  it("exposes completions as an announced combobox and replaces the caret segment", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(input.getAttribute("role"), "combobox");
    assert.strictEqual(input.getAttribute("aria-expanded"), "true");
    assert.ok(input.getAttribute("aria-activedescendant"));
    assert.match(dialog.shadowRoot.querySelector("#collection-source-completions").textContent, /Choose how cards are ordered/);

    input.value = "sta/unread/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(input.value, "starred/unread/");
  });

  it("keeps valid Source approachable with searchable add-next choices", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    dialog._filterDescriptions = {
      ...dialog._filterDescriptions,
      "inductively-knowable": "Cards tagged Inductively Knowable",
    };
    dialog._composerCandidates = [{
      filter: "inductively-knowable",
      category: "tag",
      label: "Tagged “Inductively Knowable”",
      detail: "Keeps cards tagged Inductively Knowable",
      aliases: ["tag", "inductively knowable"],
    }];
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.select();
    Array.from(dialog.shadowRoot.querySelectorAll("#collection-source-completions [role=option]"))
      .find((button) => button.textContent.includes("Starred")).click();
    await dialog.updateComplete;
    assert.strictEqual(input.value, "/c/main/starred/");

    input.value = "starred/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(input.getAttribute("aria-expanded"), "true");
    assert.match(dialog.shadowRoot.textContent, /Add another filter or modifier/);
    assert.match(dialog.shadowRoot.textContent, /Choose an order/);
    assert.match(dialog.shadowRoot.textContent, /Start with Main/);
    assert.match(dialog.shadowRoot.textContent, /Then Starred/);

    input.value = "starred/induct";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    const tag = Array.from(dialog.shadowRoot.querySelectorAll("#collection-source-completions [role=option]"))
      .find((button) => button.textContent.includes("Tagged “Inductively Knowable”"));
    assert.ok(tag);
    assert.match(tag.textContent, /tag/i);
    tag.click();
    await dialog.updateComplete;
    assert.strictEqual(input.value, "starred/inductively-knowable/");
    assert.strictEqual(dialog.shadowRoot.querySelector(".composer-actions .primary").disabled, false);
  });

  it("keeps Enter as the fast open action while valid add-next choices are visible", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "starred/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(input.getAttribute("aria-expanded"), "true");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/starred/");
  });

  it("interprets typing after a route delimiter as filter search, not a card suffix", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.setSelectionRange(input.value.length, input.value.length);
    input.value = `${input.value}upd`;
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "upd" }));
    await dialog.updateComplete;
    assert.strictEqual(input.value, "/c/main/upd/");
    assert.match(dialog.shadowRoot.textContent, /Updated/);
    assert.doesNotMatch(dialog.shadowRoot.textContent, /Opens on/);
  });

  it("requires an explicit recovery before leaving nonvalid Source", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    let input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "updated/before/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Edit visually")).click();
    await dialog.updateComplete;
    assert.ok(dialog.shadowRoot.querySelector("#collection-source-input"));
    assert.match(dialog.shadowRoot.textContent, /do not form an openable collection/);
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Return to last valid collection")).click();
    await dialog.updateComplete;
    assert.ok(dialog.shadowRoot.querySelector("#collection-composer-input"));
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Edit source")).click();
    await dialog.updateComplete;
    input = dialog.shadowRoot.querySelector("#collection-source-input");
    assert.strictEqual(dialog.shadowRoot.querySelector(".composer-actions .primary").disabled, false);
  });

  //"WILL OPEN AS" sitting above "Open is unavailable until the current source
  //is valid" was a heading contradicting its own value; and a canonical path
  //that silently drops the default set reads as the app rewriting what was
  //typed unless something says otherwise.
  it("shows a destination heading only when there is a destination, and names canonicalization", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "updated/before/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.strictEqual(dialog.shadowRoot.querySelector("#collection-source-destination"), null,
      "no heading claims a destination while there is none");
    assert.doesNotMatch(dialog.shadowRoot.textContent, /Will open as/);
    assert.strictEqual(input.getAttribute("aria-describedby"), "collection-source-status");

    input.value = "/c/main/starred/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.match(dialog.shadowRoot.querySelector("#collection-source-destination").textContent, /\/c\/starred\/$/);
    assert.match(dialog.shadowRoot.textContent, /Will open as/);
    assert.match(dialog.shadowRoot.textContent, /Same collection, written in this app’s canonical form/);

    input.value = "/c/starred/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.doesNotMatch(dialog.shadowRoot.textContent, /Will open as/);
    assert.doesNotMatch(dialog.shadowRoot.textContent, /canonical form/);
    assert.match(dialog.shadowRoot.textContent, /Link/);
  });

  it("preserves a Source selected card through Compose activation", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "/c/everything/starred/card-42";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Edit visually")).click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".composer-actions .primary").click();
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/everything/starred/card-42");
  });

  it("undoes a Source collection and selected-card suffix atomically", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    window.history.replaceState({}, "", "/c/main/");
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "/c/everything/starred/card-42";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Edit visually")).click();
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Undo")).click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".composer-actions .primary").click();
    await dialog.updateComplete;
    //Undo restored both halves, so the draft is the collection already on
    //screen and, per the spec, opening it just closes the composer instead of
    //adding a duplicate history entry. (This used to assert "/c/", the same
    //collection spelled differently, which is the duplicate entry the spec
    //forbids.) A half-undo -- description restored but card-42 still attached
    //-- would show up here as a navigation to /c/card-42.
    assert.strictEqual(window.location.pathname, "/c/main/");
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
  });

  it("preserves the raw requested-card placeholder when a route becomes a fragment", async () => {
    store.dispatch({ type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    window.history.replaceState({}, "", "/c/main/_");
    store.dispatch({ type: OPEN_CONFIGURE_COLLECTION_DIALOG, mode: "source" });
    await dialog.updateComplete;
    await dialog.updateComplete;
    const input = dialog.shadowRoot.querySelector("#collection-source-input");
    input.value = "starred/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".composer-actions .primary").click();
    await dialog.updateComplete;
    assert.strictEqual(window.location.pathname, "/c/starred/_");
  });

  //All three are pure functions of state that the composer asks for several
  //times per render, and all three used to recompute from scratch on every
  //keystroke. A stable result IDENTITY across repeated reads is the observable
  //form of "it did not recompute".
  it("recomputes its pure derivations only when their inputs change", async () => {
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
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.notStrictEqual(dialog._catalogItems, catalog);
    assert.notStrictEqual(dialog._composerSuggestions, suggestions);
  });

  //Every keystroke used to blank every count and re-enqueue, so each character
  //erased counts that were still correct for the whole debounce plus a worker
  //round trip — and the primary button flipped between "Open this collection"
  //and "Open N cards" while the draft it describes had not changed at all.
  it("keeps a count whose collection did not change across a keystroke", async () => {
    window.localStorage.setItem("collection-composer-preview", "on");
    try {
      const draftKey = dialog._previewCountKey(dialog._collectionDescription);
      dialog._retainedPreviewCounts.set(draftKey, 1307);
      dialog._refreshPreviewCounts();
      assert.strictEqual(dialog._previewCounts[dialog._draftPreviewID], 1307);
      assert.strictEqual(dialog._draftCountPending, false,
        "a known count is not a pending one");

      //A keystroke changes the suggestion list but not the draft collection.
      const input = dialog.shadowRoot.querySelector("#collection-composer-input");
      input.value = "sta";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await dialog.updateComplete;
      assert.strictEqual(dialog._previewCounts[dialog._draftPreviewID], 1307,
        "typing must not blank the count of a collection that did not change");
      assert.strictEqual(dialog._draftCountPending, false);
      assert.match(dialog.shadowRoot.querySelector(".composer-actions .primary").textContent,
        /Open 1307 cards/);

      //Changing the DRAFT is a different collection, so the count is genuinely
      //unknown — and says so, rather than silently reading as "no data".
      Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'))
        .find((button) => button.textContent.includes("Add Starred")).click();
      await dialog.updateComplete;
      assert.strictEqual(dialog._previewCounts[dialog._draftPreviewID], undefined);
      assert.strictEqual(dialog._draftCountPending, true);
      //Counts are recomputed in updated(), so the DOM catches up one frame later.
      await dialog.updateComplete;
      assert.match(dialog.shadowRoot.querySelector(".expression").textContent, /counting…/);
    } finally {
      window.localStorage.removeItem("collection-composer-preview");
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
        const role = node.getAttribute("role");
        assert.ok(
          role === "presentation" || role === "none" || role === "group",
          `an element with role="${role}" sits between the listbox and its option`
        );
        node = node.parentElement;
      }
      assert.strictEqual(node, listbox, "every option must live inside the listbox");
    }
  };

  it("keeps every option owned by its listbox", async () => {
    await seedRecents([["everything/starred/", 3]]);
    const suggestions = dialog.shadowRoot.querySelector("#collection-composer-suggestions");
    assert.ok(suggestions);
    assert.ok(suggestions.querySelectorAll('[role="option"]').length);
    assertListboxOwnership(suggestions);

    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const catalog = dialog.shadowRoot.querySelector("#collection-filter-catalog");
    assert.ok(catalog.querySelectorAll('[role="option"]').length);
    assertListboxOwnership(catalog);
  });

  //aria-controls naming an element that is not in the document is a dangling
  //reference; the composer renders a plain empty-state line, not a listbox,
  //when nothing matches.
  it("only points aria-controls at a listbox that is rendered", async () => {
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    const controls = input.getAttribute("aria-controls");
    assert.ok(controls && dialog.shadowRoot.querySelector(`#${controls}`),
      `aria-controls names a missing #${controls}`);

    //The empty-suggestion branch renders a plain line instead of a listbox.
    //Real corpus state always produces at least a text-query interpretation, so
    //the branch is driven directly rather than reached by typing something the
    //composer refuses to interpret.
    Object.defineProperty(dialog, "_composerSuggestions", { get: () => [], configurable: true });
    dialog.requestUpdate();
    await dialog.updateComplete;
    assert.strictEqual(dialog.shadowRoot.querySelector("#collection-composer-suggestions"), null);
    assert.strictEqual(input.getAttribute("aria-controls"), null);
    delete dialog._composerSuggestions;
  });

  //One row stands for the whole x / not-x pair. Flipping its polarity and
  //choosing it must add the OTHER filter, not the one the row started on.
  it("adds the inverse filter when a catalog row's polarity is flipped", async () => {
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Browse all filters")).click();
    await dialog.updateComplete;
    const rowFor = (filterName) => {
      const option = dialog.shadowRoot.querySelector(`#collection-filter-catalog [data-filter="${filterName}"]`);
      return option ? option.closest(".suggestion") : null;
    };
    const starred = rowFor("starred");
    assert.ok(starred, "the starred row must be in the catalog");
    assert.strictEqual(rowFor("unstarred"), null, "unstarred is the same row, not a second one");
    const polarity = starred.querySelector(".catalog-polarity");
    assert.ok(polarity, "a merged row must offer a polarity affordance");
    assert.strictEqual(polarity.getAttribute("aria-pressed"), "false");
    polarity.click();
    await dialog.updateComplete;
    const flipped = rowFor("unstarred");
    assert.ok(flipped, "flipping polarity must offer the inverse filter");
    assert.strictEqual(flipped.querySelector(".catalog-polarity").getAttribute("aria-pressed"), "true");
    flipped.querySelector('[role="option"]').click();
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["unstarred"]);
  });
});
