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

let buildCollectionFilterCatalog;

describe("Collection filter catalog", () => {
  before(async () => {
    ({ buildCollectionFilterCatalog } = await import("../../lib/src/collection-filter-catalog.js"));
  });

  const descriptions = {
    starred: "Cards that you starred",
    updated: "Cards updated in a date range",
    author: "Cards by a contributor",
    query: "Cards containing text",
    similar: "Cards similar to a card",
  };

  const candidates = [{
    filter: "inductively-knowable",
    category: "tag",
    label: "Tagged “Inductively Knowable”",
    detail: "Keeps cards with this tag",
    aliases: ["epistemology"],
  }, {
    filter: "direct-connections/+card-1",
    category: "relationship",
    label: "Directly connected to this card",
    detail: "Follows links in either direction",
    aliases: ["related"],
    spotlight: true,
  }];

  it("groups static, configurable, and live concrete filters by human concept", () => {
    const result = buildCollectionFilterCatalog(descriptions, candidates, []);
    assert.strictEqual(result.find(item => item.filter === "updated").category, "Dates");
    assert.strictEqual(result.find(item => item.filter === "author").category, "People");
    assert.strictEqual(result.find(item => item.filter === "query").category, "Text and specific cards");
    assert.strictEqual(result.find(item => item.filter === "similar").category, "Similarity");
    assert.strictEqual(result.find(item => item.filter === "inductively-knowable").category, "Tags and sections");
    assert.strictEqual(result.find(item => item.filter.startsWith("direct-connections/")).category, "Suggested for this card");
    assert.match(result.find(item => item.filter === "updated").example, /last 7 days/);
    assert.strictEqual(result.find(item => item.filter === "inductively-knowable").example, "Everything AND Tagged “Inductively Knowable”");
  });

  it("searches labels, descriptions, categories, and aliases", () => {
    assert.deepStrictEqual(buildCollectionFilterCatalog(descriptions, candidates, [], "epistemology").map(item => item.filter), ["inductively-knowable"]);
    assert.deepStrictEqual(buildCollectionFilterCatalog(descriptions, candidates, [], "related").map(item => item.filter), ["direct-connections/+card-1"]);
    assert.ok(buildCollectionFilterCatalog(descriptions, candidates, [], "date").some(item => item.filter === "updated"));
  });

  it("marks exact and configurable-family filters as already applied", () => {
    const result = buildCollectionFilterCatalog(descriptions, candidates, ["starred", "updated/after/3-days-ago", "direct-connections/+card-2"]);
    assert.strictEqual(result.find(item => item.filter === "starred").appliedIndex, 0);
    assert.strictEqual(result.find(item => item.filter === "updated").appliedIndex, 1);
    assert.strictEqual(result.find(item => item.filter === "direct-connections/+card-1").appliedIndex, -1);
  });

  it("promotes applied and common filters within a category", () => {
    const result = buildCollectionFilterCatalog({
      alpha: "Alpha",
      beta: "Beta",
      content: "Content",
      starred: "Starred",
      unread: "Unread",
    }, [], ["content"]);
    assert.deepStrictEqual(result.map(item => item.filter), ["content", "unread", "starred", "alpha", "beta"]);
  });
});
