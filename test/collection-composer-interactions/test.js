/*eslint-env node*/

import { JSDOM } from "jsdom";
import assert from "assert";

const dom = new JSDOM("", { url: "https://example.com/c/main/" });
for (const name of [
  "window", "document", "Document", "HTMLElement", "Element", "Node",
  "customElements", "CSSStyleSheet", "Event", "CustomEvent", "MouseEvent",
  "InputEvent", "KeyboardEvent", "ShadowRoot", "HTMLInputElement",
  "HTMLButtonElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLSlotElement",
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
    assert.match(labels[0], /Keep only cards tagged “Systems”/);
    assert.match(labels[1], /Keep only section “Half Baked”/);
    assert.match(labels[2], /This card and directly connected cards/);
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
      .find((button) => button.textContent.includes("Keep only Starred"));
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
    assert.match(dialog.shadowRoot.textContent, /Added Query Inductively Knowable/);
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
      .find((button) => button.textContent.includes("Keep only Starred"));
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
    assert.strictEqual(window.location.pathname, "/c/");
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
