/*eslint-env node*/

import { JSDOM } from "jsdom";
import assert from "assert";

const dom = new JSDOM("", { url: "https://example.com/c/main/" });
for (const name of [
  "window", "document", "Document", "HTMLElement", "Element", "Node",
  "customElements", "CSSStyleSheet", "Event", "CustomEvent", "MouseEvent",
  "InputEvent", "KeyboardEvent", "ShadowRoot", "HTMLInputElement",
  "HTMLButtonElement", "HTMLSelectElement", "HTMLSlotElement",
]) globalThis[name] = name === "window" ? dom.window : name === "document" ? dom.window.document : dom.window[name];
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

window.localStorage.setItem("collection-composer", "on");

describe("Collection Composer interactions", () => {
  let store;
  let dialog;
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
    await import("../../lib/src/components/configure-collection-dialog.js");
  });

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
  });

  it("clicking an Add suggestion updates only the draft", async () => {
    const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    const starred = buttons.find((button) => button.textContent.includes("Keep only Starred"));
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
    assert.match(after.find((button) => button.textContent.includes("Keep only Starred")).textContent, /5 cards · 7 fewer/);
    assert.match(after.find((button) => button.textContent.includes("Keep only Unread")).textContent, /19 cards · 7 more/);
    assert.strictEqual(
      Array.from(dialog.shadowRoot.querySelectorAll("button"))
        .find((button) => button.classList.contains("primary")).textContent,
      "Open 12 cards"
    );
    dialog._draftPreviewCache = {
      description: dialog._collectionDescription.serialize(),
      count: 12,
    };
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    input.value = "star";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await dialog.updateComplete;
    assert.match(dialog.shadowRoot.querySelector(".expression").textContent, /12 cards/);
  });

  it("opens the edited draft only from the explicit primary action", async () => {
    const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    buttons.find((button) => button.textContent.includes("Keep only Starred")).click();
    await dialog.updateComplete;
    const primary = Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Open this collection"));
    primary.click();
    await dialog.updateComplete;
    assert.match(window.location.pathname, /starred/);
    assert.strictEqual(store.getState().app.configureCollectionDialogOpen, false);
    assert.strictEqual(store.getState().collection.snapshot, null);
  });

  it("Escape cancels the draft without changing the active collection", async () => {
    const buttons = Array.from(dialog.shadowRoot.querySelectorAll('[role="option"]'));
    buttons.find((button) => button.textContent.includes("Keep only Starred")).click();
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
    buttons.find((button) => button.textContent.includes("Keep only Starred")).click();
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
      .find((button) => button.textContent.includes("Keep only Starred"));
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
      .find((button) => button.textContent.includes("Keep only Starred"));
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
      .find((button) => button.textContent.includes("Keep only Starred"));
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
      .find((button) => button.textContent.includes("Keep only Starred"));
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
      .find((button) => button.textContent.includes("Keep only Starred"));
    suggestion.click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    const filter = dialog.shadowRoot.querySelector("configure-collection-filter");
    assert.strictEqual(filter.shadowRoot.activeElement?.localName, "select");
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
      .find((button) => button.textContent.includes("Keep only Starred"));
    suggestion.click();
    await dialog.updateComplete;
    dialog.shadowRoot.querySelector(".expression-clause-label").click();
    await dialog.updateComplete;
    Array.from(dialog.shadowRoot.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Hide visual builder")).click();
    await dialog.updateComplete;
    assert.strictEqual(dialog.shadowRoot.querySelector("configure-collection-filter"), null);
    const input = dialog.shadowRoot.querySelector("#collection-composer-input");
    assert.strictEqual(dialog.shadowRoot.activeElement, input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    await dialog.updateComplete;
    assert.deepStrictEqual(store.getState().collection.snapshot.filterNames, ["starred"]);
    assert.ok(dialog.shadowRoot.querySelector(".expression-clause").hasAttribute("data-selected"));
  });
});
