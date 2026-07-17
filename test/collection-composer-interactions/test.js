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
    store.addReducers({ collection });
    ({
      OPEN_CONFIGURE_COLLECTION_DIALOG,
      CANCEL_CONFIGURE_COLLECTION_DIALOG,
    } = await import("../../lib/src/actions.js"));
    await import("../../lib/src/components/configure-collection-dialog.js");
  });

  beforeEach(async () => {
    window.history.replaceState({}, "", "/c/main/");
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
});
