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
let collectionComposerSuggestions;
let collectionDescriptionFromComposerSource;
let readableCollectionExpression;

const descriptions = {
  starred: "Cards you have starred",
  updated: "Cards updated in a date range",
  "working-notes": "Working notes cards",
};

describe("Collection Composer suggestions", () => {
  before(async () => {
    ({ CollectionDescription } = await import(
      "../../lib/src/collection_description.js"
    ));
    ({
      collectionComposerSuggestions,
      collectionDescriptionFromComposerSource,
      readableCollectionExpression,
    } = await import("../../lib/src/collection-composer-suggestions.js"));
  });

  it("starts from the current collection with deterministic transformations", () => {
    const current = CollectionDescription.deserialize(
      "everything/working-notes/"
    );
    const suggestions = collectionComposerSuggestions(
      current,
      "",
      descriptions
    );
    assert.strictEqual(suggestions[0].label, "Remove Working Notes");
    assert.strictEqual(suggestions[0].description.serialize(), "everything/");
    assert.ok(suggestions.some((item) => item.label === "Keep only Starred"));
    assert.ok(
      suggestions.some((item) => item.label === "Reverse the current sort")
    );
  });

  it("turns an existing card selection into an explicit filter", () => {
    const current = CollectionDescription.deserialize("everything/");
    const suggestions = collectionComposerSuggestions(
      current,
      "",
      descriptions,
      { cardsSelected: true }
    );
    const selected = suggestions.find(
      (item) => item.label === "Keep only the selected cards"
    );
    assert.ok(selected);
    assert.deepStrictEqual(selected.description.filters, ["selected"]);
    assert.match(selected.detail, /ordinary Selected filter/);
  });

  it("shows ambiguous text as explicit interpretations", () => {
    const current = CollectionDescription.deserialize("everything/");
    const suggestions = collectionComposerSuggestions(
      current,
      "work",
      descriptions
    );
    assert.strictEqual(suggestions[0].label, "Add Working Notes");
    assert.strictEqual(suggestions.at(-1).label, "Text contains “work”");
    assert.notStrictEqual(
      suggestions[0].description.serialize(),
      suggestions.at(-1).description.serialize()
    );
  });

  it("constructs configurable filters with visible editable defaults", () => {
    const current = CollectionDescription.deserialize("everything/");
    const [suggestion] = collectionComposerSuggestions(
      current,
      "updated",
      descriptions
    );
    assert.match(suggestion.description.filters[0], /^updated\//);
    assert.match(suggestion.detail, /editable default/);
  });

  it("accepts fragments, routes, and full URLs as collection source", () => {
    assert.strictEqual(
      collectionDescriptionFromComposerSource("starred").serialize(),
      "main/starred/"
    );
    assert.strictEqual(
      collectionDescriptionFromComposerSource(
        "/c/everything/working-notes/_"
      ).serialize(),
      "everything/working-notes/"
    );
    assert.strictEqual(
      collectionDescriptionFromComposerSource(
        "https://example.com/c/everything/starred/_?ignored"
      ).serialize(),
      "everything/starred/"
    );
  });

  it("returns null for invalid source instead of throwing", () => {
    assert.strictEqual(
      collectionDescriptionFromComposerSource("view/grid/"),
      null
    );
  });

  it("renders a compact readable expression", () => {
    const description = CollectionDescription.deserialize(
      "everything/starred/working-notes/sort/reverse/updated/"
    );
    assert.strictEqual(
      readableCollectionExpression(description),
      "Everything AND Starred AND Working Notes · sorted by reverse Updated"
    );
    const query = CollectionDescription.deserialize(
      "everything/query/inductively+knowable/"
    );
    assert.strictEqual(
      readableCollectionExpression(query),
      "Everything AND Query Inductively Knowable"
    );
  });
});
