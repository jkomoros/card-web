/*eslint-env node*/

import { JSDOM } from "jsdom";
import assert from "assert";

const dom = new JSDOM("", { url: "https://example.com" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let CollectionDescription;
let readRecentCollections;
let recordRecentCollection;

describe("Collection Composer history", () => {
  before(async () => {
    ({ CollectionDescription } = await import(
      "../../lib/src/collection_description.js"
    ));
    ({ readRecentCollections, recordRecentCollection } = await import(
      "../../lib/src/collection-composer-history.js"
    ));
  });

  beforeEach(() => window.localStorage.clear());

  it("records transitions newest-first and preserves authoring order", () => {
    const first = CollectionDescription.deserialize(
      "everything/query/beta/query/alpha/"
    );
    const second = CollectionDescription.deserialize("everything/starred/");
    recordRecentCollection(first, "alex", 100);
    recordRecentCollection(second, "alex", 200);
    const recent = readRecentCollections("alex");
    assert.deepStrictEqual(
      recent.map((entry) => entry.canonical),
      [second.serialize(), first.serialize()]
    );
    assert.strictEqual(recent[1].authoring, first.serializeOriginalOrder());
  });

  it("collapses consecutive navigation within the same collection", () => {
    const description = CollectionDescription.deserialize(
      "everything/starred/"
    );
    recordRecentCollection(description, "alex", 100);
    recordRecentCollection(description, "alex", 200);
    assert.deepStrictEqual(readRecentCollections("alex"), [
      {
        canonical: description.serialize(),
        authoring: description.serializeOriginalOrder(),
        visitedAt: 100,
        visits: 1,
      },
    ]);
  });

  it("increments visits when returning and keeps identity scopes separate", () => {
    const first = CollectionDescription.deserialize("everything/starred/");
    const second = CollectionDescription.deserialize("everything/unread/");
    recordRecentCollection(first, "alex", 100);
    recordRecentCollection(second, "alex", 200);
    recordRecentCollection(first, "alex", 300);
    recordRecentCollection(second, "other-user", 400);
    assert.strictEqual(readRecentCollections("alex")[0].visits, 2);
    assert.deepStrictEqual(
      readRecentCollections("other-user").map((entry) => entry.canonical),
      [second.serialize()]
    );
  });

  it("ignores corrupt, invalid, duplicate, and cross-semantic entries", () => {
    window.localStorage.setItem(
      "collection-composer-history:alex",
      JSON.stringify([
        {
          canonical: "everything/starred/",
          authoring: "everything/starred/",
          visitedAt: 3,
          visits: 1,
        },
        {
          canonical: "everything/starred/",
          authoring: "everything/starred/",
          visitedAt: 2,
          visits: 9,
        },
        {
          canonical: "everything/starred/",
          authoring: "everything/unread/",
          visitedAt: 1,
          visits: 1,
        },
        { garbage: true },
      ])
    );
    assert.deepStrictEqual(readRecentCollections("alex"), [
      {
        canonical: "everything/starred/",
        authoring: "everything/starred/",
        visitedAt: 3,
        visits: 1,
      },
    ]);
  });

  it("never throws on malformed storage", () => {
    window.localStorage.setItem("collection-composer-history:alex", "{");
    assert.deepStrictEqual(readRecentCollections("alex"), []);
  });
});
