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
    assert.match(open, /when:[^\n]*whenKeyboardNavigates/,
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
});
