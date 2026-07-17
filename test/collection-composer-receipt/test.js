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

let appReducer;
let OPEN_SNACKBAR;
let CLOSE_SNACKBAR;

describe("Collection Composer navigation receipt", () => {
  before(async () => {
    appReducer = (await import("../../lib/src/reducers/app.js")).default;
    ({ OPEN_SNACKBAR, CLOSE_SNACKBAR } = await import(
      "../../lib/src/actions.js"
    ));
  });

  it("stores a semantic message and browser-back action", () => {
    const state = appReducer(undefined, {
      type: OPEN_SNACKBAR,
      message: "Now showing Everything AND Starred · 4 cards",
      action: "back",
    });
    assert.strictEqual(state.snackbarOpened, true);
    assert.strictEqual(
      state.snackbarMessage,
      "Now showing Everything AND Starred · 4 cards"
    );
    assert.strictEqual(state.snackbarAction, "back");
  });

  it("clears receipt semantics when the snackbar closes", () => {
    const open = appReducer(undefined, {
      type: OPEN_SNACKBAR,
      message: "Now showing Everything AND Starred",
      action: "back",
    });
    const closed = appReducer(open, { type: CLOSE_SNACKBAR });
    assert.strictEqual(closed.snackbarOpened, false);
    assert.strictEqual(closed.snackbarMessage, "");
    assert.strictEqual(closed.snackbarAction, "");
  });
});
