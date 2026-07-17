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
let formatCollectionCardCount;
let formatCollectionCountDelta;

describe("Collection Composer preview coordinator", () => {
  before(async () => {
    ({ CollectionDescription } = await import(
      "../../lib/src/collection_description.js"
    ));
    ({ startCollectionComposerPreviews, formatCollectionCardCount, formatCollectionCountDelta } = await import(
      "../../lib/src/collection-composer-preview.js"
    ));
  });

  it("formats counts and their consequences in plain language", () => {
    assert.strictEqual(formatCollectionCardCount(1), "1 card");
    assert.strictEqual(formatCollectionCardCount(12), "12 cards");
    assert.strictEqual(formatCollectionCountDelta(7, 12), "5 fewer");
    assert.strictEqual(formatCollectionCountDelta(19, 12), "7 more");
    assert.strictEqual(formatCollectionCountDelta(12, 12), "same number of cards");
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
      (id, count) => observed.push([id, count]),
      { debounceMS: 0 }
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
      (id, count) => observed.push([id, count]),
      { debounceMS: 0 }
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
        (id, count) => observed.push([id, count]),
        { debounceMS: 0 }
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
      (id, count) => observed.push([id, count]),
      { debounceMS: 0 }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(observed, []);
  });

  it("treats a synchronous worker failure as an unavailable preview", () => {
    assert.doesNotThrow(() =>
      startCollectionComposerPreviews(
        [suggestion("starred", "everything/starred/")],
        "",
        () => { throw new Error("worker bridge unavailable"); },
        () => {},
        { debounceMS: 0 }
      )
    );
  });

  it("cancels debounced work before it reaches the worker", async () => {
    let calls = 0;
    const cancel = startCollectionComposerPreviews(
      [suggestion("starred", "everything/starred/")],
      "",
      () => {
        calls++;
        return Promise.resolve({ numCards: 1 });
      },
      () => {},
      { debounceMS: 20 }
    );
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(calls, 0);
  });

  it("deduplicates equivalent descriptions and fans out their count", async () => {
    let calls = 0;
    const observed = [];
    startCollectionComposerPreviews(
      [
        suggestion("first", "everything/starred/unread/"),
        suggestion("second", "everything/unread/starred/"),
      ],
      "",
      () => {
        calls++;
        return Promise.resolve({ numCards: 3 });
      },
      (id, count) => observed.push([id, count]),
      { debounceMS: 0 }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(observed, [["first", 3], ["second", 3]]);
  });

  it("bounds concurrent worker requests", async () => {
    let running = 0;
    let peak = 0;
    const resolvers = [];
    startCollectionComposerPreviews(
      [
        suggestion("one", "everything/starred/"),
        suggestion("two", "everything/unread/"),
        suggestion("three", "everything/read/"),
      ],
      "",
      () => new Promise((resolve) => {
        running++;
        peak = Math.max(peak, running);
        resolvers.push((value) => {
          running--;
          resolve(value);
        });
      }),
      () => {},
      { debounceMS: 0, maxConcurrent: 2 }
    );
    assert.strictEqual(resolvers.length, 2);
    resolvers[0]({ numCards: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(resolvers.length, 3);
    resolvers[1]({ numCards: 1 });
    resolvers[2]({ numCards: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(peak, 2);
  });

  it("bounds worker requests across cancelled generations", async () => {
    let running = 0;
    let peak = 0;
    const resolvers = [];
    const run = () => new Promise((resolve) => {
      running++;
      peak = Math.max(peak, running);
      resolvers.push((value) => {
        running--;
        resolve(value);
      });
    });
    for (let generation = 0; generation < 4; generation++) {
      const cancel = startCollectionComposerPreviews(
        [
          suggestion(`starred-${generation}`, `everything/starred/query/${generation}/`),
          suggestion(`unread-${generation}`, `everything/unread/query/${generation}/`),
        ],
        "",
        run,
        () => {},
        { debounceMS: 0 }
      );
      cancel();
    }
    assert.strictEqual(resolvers.length, 2);
    assert.strictEqual(peak, 2);
    resolvers[0]({ numCards: 1 });
    resolvers[1]({ numCards: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(running, 0);
    assert.strictEqual(peak, 2);
  });

  it("shares matching work across generations while the worker limit is full", async () => {
    const resolvers = {};
    const observed = [];
    let calls = 0;
    const run = (description) => new Promise((resolve) => {
      calls++;
      resolvers[description] = resolve;
    });
    const cancelFirst = startCollectionComposerPreviews(
      [
        suggestion("old-starred", "everything/starred/"),
        suggestion("old-unread", "everything/unread/"),
      ],
      "",
      run,
      () => {},
      { debounceMS: 0 }
    );
    startCollectionComposerPreviews(
      [suggestion("new-starred", "everything/starred/")],
      "",
      run,
      (id, count) => observed.push([id, count]),
      { debounceMS: 0 }
    );
    cancelFirst();
    assert.deepStrictEqual(Object.keys(resolvers).sort(), ["everything/starred/", "everything/unread/"]);
    resolvers["everything/starred/"]({ numCards: 4 });
    resolvers["everything/unread/"]({ numCards: 9 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(observed, [["new-starred", 4]]);
    assert.strictEqual(calls, 2);
  });
});
