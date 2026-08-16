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
let collectionReceiptCanUndo;

describe("Collection Composer navigation receipt", () => {
  before(async () => {
    appReducer = (await import("../../lib/src/reducers/app.js")).default;
    ({ OPEN_SNACKBAR, CLOSE_SNACKBAR } = await import(
      "../../lib/src/actions.js"
    ));
    ({ collectionReceiptCanUndo } = await import(
      "../../lib/src/collection-composer-receipt.js"
    ));
  });

  it("only undoes while the receipt still describes the current location", () => {
    assert.strictEqual(collectionReceiptCanUndo("/c/everything/starred/", "/c/everything/starred/"), true);
    assert.strictEqual(collectionReceiptCanUndo("/c/everything/starred/", "/c/everything/starred/card-a"), false);
    assert.strictEqual(collectionReceiptCanUndo("", ""), false);
  });

  it("survives canonicalizing the active card from ID to preferred slug", () => {
    assert.strictEqual(
      collectionReceiptCanUndo(
        "/c/everything/starred/card-id",
        "/c/everything/starred/preferred-slug",
        ["card-id", "preferred-slug"]
      ),
      true
    );
    assert.strictEqual(
      collectionReceiptCanUndo(
        "/c/everything/starred/card-id",
        "/c/everything/starred/a-different-card",
        ["different-id", "a-different-card"]
      ),
      false
    );
    assert.strictEqual(
      collectionReceiptCanUndo(
        "/c/everything/starred/older-valid-slug",
        "/c/everything/starred/preferred-slug",
        ["card-id", "preferred-slug", "older-valid-slug"]
      ),
      true
    );
    assert.strictEqual(
      collectionReceiptCanUndo(
        "/c/everything/starred/card-id?composer=1",
        "/c/everything/starred/preferred-slug",
        ["card-id", "preferred-slug"]
      ),
      false
    );
  });

  it("stores a semantic message and browser-back action", () => {
    const state = appReducer(undefined, {
      type: OPEN_SNACKBAR,
      message: "Now showing Everything AND Starred · 4 cards",
      action: "back",
      expectedLocation: "/c/everything/starred/",
    });
    assert.strictEqual(state.snackbarOpened, true);
    assert.strictEqual(
      state.snackbarMessage,
      "Now showing Everything AND Starred · 4 cards"
    );
    assert.strictEqual(state.snackbarAction, "back");
    assert.strictEqual(state.snackbarExpectedLocation, "/c/everything/starred/");
  });

  it("clears receipt semantics when the snackbar closes", () => {
    const open = appReducer(undefined, {
      type: OPEN_SNACKBAR,
      message: "Now showing Everything AND Starred",
      action: "back",
      expectedLocation: "/c/everything/starred/",
    });
    const closed = appReducer(open, { type: CLOSE_SNACKBAR });
    assert.strictEqual(closed.snackbarOpened, false);
    assert.strictEqual(closed.snackbarMessage, "");
    assert.strictEqual(closed.snackbarAction, "");
    assert.strictEqual(closed.snackbarExpectedLocation, "");
  });
});
