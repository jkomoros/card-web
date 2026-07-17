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
let readRememberedCollections;
let recordRecentCollection;
let collectionDescriptionActuallyVisited;
let collectionDescriptionWithRelativeDateMemory;

describe("Collection Composer history", () => {
  before(async () => {
    ({ CollectionDescription } = await import(
      "../../lib/src/collection_description.js"
    ));
    ({ readRecentCollections, readRememberedCollections, recordRecentCollection, collectionDescriptionActuallyVisited } = await import(
      "../../lib/src/collection-composer-history.js"
    ));
    ({ collectionDescriptionWithRelativeDateMemory } = await import(
      "../../lib/src/collection-composer-memory.js"
    ));
  });

  beforeEach(() => window.localStorage.clear());

  it("records the retained active collection for bare-card navigation", () => {
    const requestedFallback = CollectionDescription.deserialize("main/section-a/");
    const retainedActive = CollectionDescription.deserialize("everything/starred/unread/");
    assert.strictEqual(
      collectionDescriptionActuallyVisited(requestedFallback, retainedActive, false),
      retainedActive
    );
    assert.strictEqual(
      collectionDescriptionActuallyVisited(requestedFallback, retainedActive, true),
      requestedFallback
    );
  });

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

  it("recognizes a frequently revisited moving date window", () => {
    recordRecentCollection(
      CollectionDescription.deserialize("everything/created/after/2026-7-7/"),
      "alex",
      new Date(2026, 6, 10, 12).getTime()
    );
    recordRecentCollection(
      CollectionDescription.deserialize("everything/created/after/2026-7-8/"),
      "alex",
      new Date(2026, 6, 11, 12).getTime()
    );
    recordRecentCollection(
      CollectionDescription.deserialize("everything/created/after/2026-7-9/"),
      "alex",
      new Date(2026, 6, 12, 12).getTime()
    );
    const remembered = readRememberedCollections("alex");
    assert.deepStrictEqual(remembered.slice(0, 2).map(entry => entry.authoring), [
      "everything/created/after/2026-7-9/",
      "everything/created/after/2026-7-8/",
    ]);
    assert.strictEqual(remembered[2].authoring, "everything/created/after/3-days-ago/");
    assert.strictEqual(remembered[2].visits, 3);
    assert.strictEqual(remembered[2].frequent, true);
    assert.strictEqual(remembered[2].relative, true);
  });

  it("keeps an often-used exact collection available beyond immediate recents", () => {
    const favorite = CollectionDescription.deserialize("everything/starred/unread/");
    const other = (name) => CollectionDescription.deserialize(`everything/${name}/`);
    recordRecentCollection(favorite, "alex", 100);
    recordRecentCollection(other("working-notes"), "alex", 200);
    recordRecentCollection(favorite, "alex", 300);
    recordRecentCollection(other("has-todo"), "alex", 400);
    recordRecentCollection(favorite, "alex", 500);
    recordRecentCollection(other("published"), "alex", 600);
    recordRecentCollection(other("unread"), "alex", 700);
    const remembered = readRememberedCollections("alex");
    assert.strictEqual(remembered[2].canonical, favorite.serialize());
    assert.strictEqual(remembered[2].visits, 3);
    assert.strictEqual(remembered[2].frequent, true);
    assert.ok(!remembered[2].relative);
  });

  it("does not reinterpret a fixed absolute milestone as a rolling window", () => {
    const description = CollectionDescription.deserialize("everything/created/after/2026-7-7/");
    assert.strictEqual(
      collectionDescriptionWithRelativeDateMemory(description, new Date(2026, 6, 10, 12)).filters[0],
      "created/after/3-days-ago"
    );
    recordRecentCollection(description, "alex", new Date(2026, 6, 10, 12).getTime());
    recordRecentCollection(CollectionDescription.deserialize("everything/starred/"), "alex", new Date(2026, 6, 11, 12).getTime());
    recordRecentCollection(description, "alex", new Date(2026, 6, 12, 12).getTime());
    assert.ok(!readRememberedCollections("alex").some(entry => entry.frequent && entry.relative));
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
