/*eslint-env node*/

import { JSDOM } from "jsdom";
import assert from "assert";

import {
  LEGACY_COLLECTION_SOURCE_FIXTURES,
  ORDERED_QUERY_BEHAVIOR_FIXTURE,
} from "./fixtures.js";

const dom = new JSDOM("");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let CollectionDescription;
let QueryEngine;

const observedDescription = (description, selectedCard) => ({
  set: description.set,
  filters: description.filters,
  sort: description.sort,
  sortReversed: description.sortReversed,
  viewMode: description.viewMode,
  viewModeExtra: description.viewModeExtra,
  selectedCard,
  setExplicit: description.setNameExplicitlySet,
});

const card = (id, extras) => ({
  id,
  card_type: "content",
  title: "Title of " + id,
  body: "<p>Body of " + id + "</p>",
  section: "main",
  tags: [],
  sort_order: 1.0,
  references: {},
  references_info: {},
  references_inbound: {},
  references_info_inbound: {},
  star_count: 0,
  thread_count: 0,
  notes: "",
  todo: "",
  auto_todo_overrides: {},
  published: true,
  full_bleed: false,
  images: [],
  ...extras,
});

describe("collection source compatibility catalog", () => {
  before(async () => {
    ({ CollectionDescription } = await import(
      "../../lib/src/collection_description.js"
    ));
    ({ QueryEngine } = await import("../../lib/src/worker/query-engine.js"));
  });

  for (const fixture of LEGACY_COLLECTION_SOURCE_FIXTURES) {
    it("records legacy behavior: " + fixture.name, () => {
      assert.ok(
        fixture.desired.classification,
        "Fixture must state the desired lossless classification"
      );
      assert.strictEqual(typeof fixture.desired.preserveRaw, "boolean");

      if (fixture.legacyObserved.throws) {
        assert.throws(
          () => CollectionDescription.deserializeWithExtra(fixture.legacyInput),
          (error) =>
            error &&
            error.constructor &&
            error.constructor.name === fixture.legacyObserved.throws
        );
        return;
      }

      const [
        description,
        selectedCard,
      ] = CollectionDescription.deserializeWithExtra(fixture.legacyInput);
      assert.deepStrictEqual(
        observedDescription(description, selectedCard),
        fixture.legacyObserved
      );
    });
  }

  it("keeps execution invariant when canonical serialization is equal", () => {
    const fixture = ORDERED_QUERY_BEHAVIOR_FIXTURE;
    const firstDescription = CollectionDescription.deserialize(
      fixture.firstSource
    );
    const secondDescription = CollectionDescription.deserialize(
      fixture.secondSource
    );

    assert.strictEqual(
      firstDescription.serialize(),
      secondDescription.serialize()
    );
    assert.notStrictEqual(
      firstDescription.serializeOriginalOrder(),
      secondDescription.serializeOriginalOrder()
    );

    const cards = Object.fromEntries(
      Object.entries(fixture.cards).map(([id, extras]) => [
        id,
        card(id, extras),
      ])
    );
    const firstEngine = new QueryEngine();
    firstEngine.updateCards(cards, []);
    const secondEngine = new QueryEngine();
    secondEngine.updateCards(cards, []);

    const firstResult = firstEngine.runCollection(fixture.firstSource);
    const secondResult = secondEngine.runCollection(fixture.secondSource);

    assert.deepStrictEqual(firstResult.ids, ["betaFirst", "alphaFirst"]);
    assert.deepStrictEqual(secondResult, firstResult);
  });
});
