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

let CollectionDescription;
let startCollectionComposerPreviews;

describe("Collection Composer preview coordinator", () => {
  before(async () => {
    ({ CollectionDescription } = await import(
      "../../lib/src/collection_description.js"
    ));
    ({ startCollectionComposerPreviews } = await import(
      "../../lib/src/collection-composer-preview.js"
    ));
  });

  const suggestion = (id, source) => ({
    id,
    kind: "add",
    label: id,
    detail: "",
    description: CollectionDescription.deserialize(source),
  });

  it("keys asynchronous counts to stable suggestion identity", async () => {
    const resolvers = {};
    const observed = [];
    startCollectionComposerPreviews(
      [
        suggestion("starred", "everything/starred/"),
        suggestion("unread", "everything/unread/"),
      ],
      "active-card",
      (description, keyCardID) =>
        new Promise((resolve) => {
          resolvers[description] = resolve;
          assert.strictEqual(keyCardID, "active-card");
        }),
      (id, count) => observed.push([id, count])
    );
    resolvers["everything/unread/"]({ numCards: 9 });
    resolvers["everything/starred/"]({ numCards: 4 });
    await Promise.resolve();
    assert.deepStrictEqual(observed, [
      ["unread", 9],
      ["starred", 4],
    ]);
  });

  it("discards every response after cancellation", async () => {
    let resolvePreview;
    const observed = [];
    const cancel = startCollectionComposerPreviews(
      [suggestion("starred", "everything/starred/")],
      "",
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
      (id, count) => observed.push([id, count])
    );
    cancel();
    resolvePreview({ numCards: 4 });
    await Promise.resolve();
    assert.deepStrictEqual(observed, []);
  });

  it("does nothing when the worker is unavailable", () => {
    const observed = [];
    assert.doesNotThrow(() =>
      startCollectionComposerPreviews(
        [suggestion("starred", "everything/starred/")],
        "",
        () => null,
        (id, count) => observed.push([id, count])
      )
    );
    assert.deepStrictEqual(observed, []);
  });

  it("treats worker rejection as an unavailable preview", async () => {
    const observed = [];
    startCollectionComposerPreviews(
      [suggestion("starred", "everything/starred/")],
      "",
      () => Promise.reject(new Error("worker restarted")),
      (id, count) => observed.push([id, count])
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(observed, []);
  });
});
