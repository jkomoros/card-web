/*eslint-env node*/

//The receipt is asserted through the SNACKBAR QUEUE (app.snackbars) and the
//module that records where the receipt points, because that is the contract the
//app now has: showSnackbar(message, {kind, action: {label, actionID},
//dedupeKey}) pushes a SnackbarMessage, and a serializable actionID resolves to
//a registered thunk. The previous version of this file asserted
//state.snackbarMessage/snackbarAction/snackbarExpectedLocation, three fields
//that no longer exist.

import { JSDOM } from "jsdom";
import assert from "assert";

const dom = new JSDOM("", { url: "https://example.com/c/everything/starred/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let appReducer;
let PUSH_SNACKBAR;
let DISMISS_SNACKBAR;
let receipt;

const message = (overrides = {}) => ({
  id: "snackbar-1",
  message: "Now showing Everything AND Starred · 4 cards",
  kind: "info",
  durationMs: 10000,
  action: { label: "Undo", actionID: "undo-collection-navigation" },
  dedupeKey: "collection-navigation-receipt",
  ...overrides,
});

describe("Collection Composer navigation receipt", () => {
  before(async () => {
    appReducer = (await import("../../lib/src/reducers/app.js")).default;
    ({ PUSH_SNACKBAR, DISMISS_SNACKBAR } = await import(
      "../../lib/src/actions.js"
    ));
    receipt = await import("../../lib/src/collection-composer-receipt.js");
  });

  it("queues a semantic message carrying an Undo action", () => {
    const state = appReducer(undefined, {
      type: PUSH_SNACKBAR,
      message: message(),
    });
    assert.strictEqual(state.snackbars.length, 1);
    assert.strictEqual(
      state.snackbars[0].message,
      "Now showing Everything AND Starred · 4 cards"
    );
    //'info', not a write-outcome word: nothing reached a server.
    assert.strictEqual(state.snackbars[0].kind, "info");
    assert.deepStrictEqual(state.snackbars[0].action, {
      label: "Undo",
      actionID: "undo-collection-navigation",
    });
  });

  it("replaces the previous receipt rather than stacking a second one", () => {
    const first = appReducer(undefined, {
      type: PUSH_SNACKBAR,
      message: message(),
    });
    const second = appReducer(first, {
      type: PUSH_SNACKBAR,
      message: message({ id: "snackbar-2", message: "Now showing Starred" }),
    });
    assert.strictEqual(second.snackbars.length, 1);
    assert.strictEqual(second.snackbars[0].id, "snackbar-2");
  });

  it("drops the receipt from the queue when it is dismissed", () => {
    const open = appReducer(undefined, {
      type: PUSH_SNACKBAR,
      message: message(),
    });
    const closed = appReducer(open, {
      type: DISMISS_SNACKBAR,
      snackbarID: "snackbar-1",
    });
    assert.deepStrictEqual(closed.snackbars, []);
  });

  it("records one pending receipt location, invalidated by the next one", () => {
    receipt.clearCollectionNavigationReceipt();
    assert.strictEqual(receipt.pendingCollectionNavigationReceipt(), "");
    receipt.recordCollectionNavigationReceipt("/c/everything/starred/");
    assert.strictEqual(
      receipt.pendingCollectionNavigationReceipt(),
      "/c/everything/starred/"
    );
    receipt.recordCollectionNavigationReceipt("/c/everything/reads/");
    assert.strictEqual(
      receipt.pendingCollectionNavigationReceipt(),
      "/c/everything/reads/"
    );
    receipt.clearCollectionNavigationReceipt();
    assert.strictEqual(receipt.pendingCollectionNavigationReceipt(), "");
  });

  it("reads the current location as path plus search plus hash", () => {
    assert.strictEqual(
      receipt.currentBrowserLocation(),
      "/c/everything/starred/"
    );
  });

  it("only undoes while the receipt still describes the current location", () => {
    assert.strictEqual(
      receipt.collectionReceiptCanUndo(
        "/c/everything/starred/",
        "/c/everything/starred/"
      ),
      true
    );
    assert.strictEqual(
      receipt.collectionReceiptCanUndo(
        "/c/everything/starred/",
        "/c/everything/starred/card-a"
      ),
      false
    );
    assert.strictEqual(receipt.collectionReceiptCanUndo("", ""), false);
  });
});
