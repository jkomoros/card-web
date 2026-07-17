/*eslint-env node*/

import { JSDOM } from "jsdom";
import assert from "assert";

const dom = new JSDOM("");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let reducer;
let initialState;
let OPEN_CONFIGURE_COLLECTION_DIALOG;
let CLOSE_CONFIGURE_COLLECTION_DIALOG;
let CANCEL_CONFIGURE_COLLECTION_DIALOG;
let UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT;

describe("Collection Composer draft lifecycle", () => {
  before(async () => {
    reducer = (await import("../../lib/src/reducers/collection.js")).default;
    ({ INITIAL_STATE: initialState } = await import("../../lib/src/filters.js"));
    ({
      OPEN_CONFIGURE_COLLECTION_DIALOG,
      CLOSE_CONFIGURE_COLLECTION_DIALOG,
      CANCEL_CONFIGURE_COLLECTION_DIALOG,
      UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
    } = await import("../../lib/src/actions.js"));
  });

  const draft = {
    setName: "main",
    filterNames: ["starred"],
    sortName: "default",
    sortReversed: false,
    viewMode: "list",
    viewModeExtra: "",
  };

  it("discards a composed draft on cancel", () => {
    const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
    const changed = reducer(opened, {
      type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
      collection: draft,
    });
    const cancelled = reducer(changed, { type: CANCEL_CONFIGURE_COLLECTION_DIALOG });
    assert.deepStrictEqual(cancelled.active, initialState.active);
    assert.strictEqual(cancelled.snapshot, null);
  });

  it("preserves the legacy builder's explicit commit path", () => {
    const opened = reducer(initialState, { type: OPEN_CONFIGURE_COLLECTION_DIALOG });
    const changed = reducer(opened, {
      type: UPDATE_COLLECTION_CONFIGURATION_SHAPSHOT,
      collection: draft,
    });
    const committed = reducer(changed, { type: CLOSE_CONFIGURE_COLLECTION_DIALOG });
    assert.deepStrictEqual(committed.active, draft);
    assert.strictEqual(committed.snapshot, null);
  });
});
