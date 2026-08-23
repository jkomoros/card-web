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
let CollectionDescription;

//The catalog builds its examples on the draft the user is actually composing,
//so every case here has to say which draft it is talking about.
const draft = (serialized = "everything/") => CollectionDescription.deserialize(serialized);

describe("Collection filter catalog", () => {
  before(async () => {
    ({ buildCollectionFilterCatalog } = await import("../../lib/src/collection-filter-catalog.js"));
    ({ CollectionDescription } = await import("../../lib/src/collection_description.js"));
  });

  const descriptions = {
    starred: "Cards that you starred",
    updated: "Cards updated in a date range",
    author: "Cards by a contributor",
    query: "Cards containing text",
    similar: "Cards similar to a card",
    exclude: "Cards outside another collection",
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
    const result = buildCollectionFilterCatalog(descriptions, candidates, draft());
    assert.strictEqual(result.find(item => item.filter === "updated").category, "Dates");
    assert.strictEqual(result.find(item => item.filter === "author").category, "People");
    assert.strictEqual(result.find(item => item.filter === "query").category, "Text and specific cards");
    assert.strictEqual(result.find(item => item.filter === "similar").category, "Similarity");
    assert.strictEqual(result.find(item => item.filter === "inductively-knowable").category, "Tags and sections");
    assert.strictEqual(result.find(item => item.filter.startsWith("direct-connections/")).category, "Suggested for this card");
    assert.match(result.find(item => item.filter === "updated").example, /Updated since 7 days ago/);
    assert.strictEqual(result.find(item => item.filter === "updated").guided, true);
    assert.strictEqual(result.find(item => item.filter === "exclude").guided, false);
    assert.match(result.find(item => item.filter === "exclude").example, /NOT Working Notes/);
    assert.strictEqual(result.find(item => item.filter === "inductively-knowable").example, "Everything AND Tagged “Inductively Knowable”");
  });

  it("searches labels, descriptions, categories, and aliases", () => {
    assert.deepStrictEqual(buildCollectionFilterCatalog(descriptions, candidates, draft(), "epistemology").map(item => item.filter), ["inductively-knowable"]);
    assert.deepStrictEqual(buildCollectionFilterCatalog(descriptions, candidates, draft(), "related").map(item => item.filter), ["direct-connections/+card-1"]);
    assert.ok(buildCollectionFilterCatalog(descriptions, candidates, draft(), "date").some(item => item.filter === "updated"));
  });

  it("marks exact and configurable-family filters as already applied", () => {
    const result = buildCollectionFilterCatalog(descriptions, candidates, draft("everything/starred/updated/after/3-days-ago/direct-connections/+card-2/"));
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
    }, [], draft("everything/content/"));
    assert.deepStrictEqual(result.map(item => item.filter), ["content", "unread", "starred", "alpha", "beta"]);
  });
});
