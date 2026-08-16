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
globalThis.BroadcastChannel = class {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  close() {}
};

let CollectionDescription;
let collectionComposerSuggestions;
let collectionDescriptionFromComposerSource;
let readableCollectionExpression;
let collectionExpressionParts;
let selectCollectionComposerCandidates;
let activeCardRelationshipCandidates;
let activeCardMetadataCandidates;
let makeConfigurableFilter;
let configurableFilterCacheKey;

const descriptions = {
  starred: "Cards you have starred",
  updated: "Cards updated in a date range",
  exclude: "Cards outside another collection",
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
      collectionExpressionParts,
      activeCardRelationshipCandidates,
      activeCardMetadataCandidates,
    } = await import("../../lib/src/collection-composer-suggestions.js"));
    ({ selectCollectionComposerCandidates } = await import("../../lib/src/selectors.js"));
    ({ makeConfigurableFilter, configurableFilterCacheKey } = await import("../../lib/src/filters.js"));
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
    assert.strictEqual(suggestions[0].action, "remove");
    assert.strictEqual(suggestions[0].description.serialize(), "everything/");
    assert.ok(suggestions.some((item) => item.label === "Keep only Starred"));
    assert.ok(
      suggestions.some((item) => item.label === "Reverse the current sort")
    );
  });

  it("uses contributor labels instead of durable IDs in removal suggestions", () => {
    const candidate = {
      filter: "author/visibleperson",
      category: "author",
      label: "Cards Casey authored or collaborated on",
      detail: "",
      clauseLabel: "Contributed By Casey",
    };
    const suggestions = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/author/visibleperson/"),
      "",
      descriptions,
      { candidates: [candidate] }
    );
    assert.strictEqual(suggestions[0].label, "Remove Contributed By Casey");
    assert.match(suggestions[0].detail, /Contributed By Casey/);
    assert.doesNotMatch(`${suggestions[0].label} ${suggestions[0].detail}`, /visibleperson/);
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

  it("describes recent destinations as explicit differences", () => {
    const current = CollectionDescription.deserialize(
      "everything/working-notes/"
    );
    const recent = CollectionDescription.deserialize(
      "main/starred/sort/recent/"
    );
    const suggestions = collectionComposerSuggestions(
      current,
      "",
      descriptions,
      { recentCollections: [{ description: recent, visits: 3 }] }
    );
    assert.strictEqual(
      suggestions[0].label,
      "Back to Main AND Starred · sorted by Recent"
    );
    assert.strictEqual(suggestions[0].action, "open");
    assert.match(suggestions[0].detail, /Uses Main instead of Everything/);
    assert.match(suggestions[0].detail, /Removes Working Notes/);
    assert.match(suggestions[0].detail, /Adds Starred/);
    assert.match(suggestions[0].detail, /Visited 3 times/);
  });

  it("explains promoted rolling-date memories mechanistically", () => {
    const suggestions = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"),
      "",
      descriptions,
      {
        recentCollections: [{
          description: CollectionDescription.deserialize("everything/created/after/3-days-ago/"),
          visits: 3,
          frequent: true,
          relative: true,
        }],
      }
    );
    assert.match(suggestions[0].label, /^Often: /);
    assert.match(suggestions[0].detail, /rolling date window/);
    assert.match(suggestions[0].detail, /Visited 3 times/);
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

  it("ranks name matches ahead of incidental description matches", () => {
    const current = CollectionDescription.deserialize("everything/");
    const suggestions = collectionComposerSuggestions(current, "working", {
      "mined-for-content": "Cards with working source material",
      "working-notes": "Working notes cards",
    });
    assert.strictEqual(suggestions[0].label, "Add Working Notes");
  });

  it("discovers concrete values with deterministic, inspectable filters", () => {
    const current = CollectionDescription.deserialize("everything/");
    const candidates = [
      {
        filter: "inductively-knowable",
        category: "tag",
        label: "Tagged “Inductively Knowable”",
        detail: "Keeps cards tagged Inductively Knowable",
        aliases: ["inductively knowable", "tag"],
      },
      {
        filter: "half-baked",
        category: "section",
        label: "In section “Half Baked”",
        detail: "Keeps cards in the Half Baked section",
        aliases: ["half baked", "section"],
      },
    ];
    const suggestions = collectionComposerSuggestions(
      current,
      "tag inductively",
      { "inductively-knowable": "Matches cards in the Inductively Knowable tag" },
      { candidates }
    );
    assert.strictEqual(suggestions[0].label, "Tagged “Inductively Knowable”");
    assert.deepStrictEqual(suggestions[0].description.filters, ["inductively-knowable"]);
    assert.match(suggestions[0].detail, /“inductively-knowable” to the collection URL/);
    assert.strictEqual(suggestions.at(-1).label, "Text contains “tag inductively”");
  });

  it("ranks exact built-ins over weaker concrete matches", () => {
    const current = CollectionDescription.deserialize("everything/");
    const suggestions = collectionComposerSuggestions(current, "starred", descriptions, {
      candidates: [{
        filter: "starred-ideas",
        category: "tag",
        label: "Tagged “Starred Ideas”",
        detail: "Keeps cards tagged Starred Ideas",
      }],
    });
    assert.strictEqual(suggestions[0].label, "Add Starred");
  });

  it("suppresses ambiguous and reserved section or tag IDs", () => {
    const candidates = selectCollectionComposerCandidates({
      data: {
        sections: {
          shared: { title: "Shared section" },
          starred: { title: "Misleading section" },
          safe: { title: "Safe section" },
        },
        tags: {
          shared: { title: "Shared tag" },
          unread: { title: "Misleading tag" },
          useful: { title: "Useful tag" },
        },
        cards: {},
        authors: {},
      },
    });
    assert.ok(!candidates.some(candidate => ["shared", "starred", "unread"].includes(candidate.filter)));
    assert.ok(candidates.some(candidate => candidate.filter === "safe" && candidate.category === "section"));
    assert.ok(candidates.some(candidate => candidate.filter === "useful" && candidate.category === "tag"));
    assert.strictEqual(candidates.find(candidate => candidate.filter === "working-notes").label, "Card type: Working Notes");
  });

  it("discovers only visible contributors with durable, honestly labeled clauses", () => {
    const candidates = selectCollectionComposerCandidates({
      data: {
        sections: {},
        tags: {},
        cards: {
          one: { author: "CurrentUser", collaborators: ["VisiblePerson"] },
        },
        authors: {
          CurrentUser: { displayName: "Jordan" },
          VisiblePerson: { displayName: "Casey" },
          HiddenPerson: { displayName: "Hidden" },
        },
      },
      user: { user: { uid: "CurrentUser" } },
    });
    const mine = candidates.find(candidate => candidate.label === "My cards");
    const casey = candidates.find(candidate => candidate.label.includes("Casey"));
    assert.strictEqual(mine.filter, "author/currentuser");
    assert.strictEqual(casey.filter, "author/visibleperson");
    assert.match(casey.label, /authored or collaborated on/);
    assert.ok(!candidates.some(candidate => candidate.label.includes("Hidden")));
    assert.ok(!casey.searchValues.some(value => value.includes("visibleperson")));

    const suggestions = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"),
      "casey",
      { author: "Selects cards by contributor" },
      { candidates }
    );
    assert.strictEqual(suggestions[0].label, "Cards Casey authored or collaborated on");
    assert.deepStrictEqual(suggestions[0].description.filters, ["author/visibleperson"]);
    assert.doesNotMatch(suggestions[0].detail, /visibleperson/i);
    const [contributorFilter] = makeConfigurableFilter("author/visibleperson");
    assert.strictEqual(contributorFilter({ author: "Other", collaborators: ["VisiblePerson"] }, {}).matches, true);
    assert.strictEqual(
      readableCollectionExpression(suggestions[0].description, {
        "author/visibleperson": "Cards Casey authored or collaborated on",
      }),
      "Everything AND Cards Casey authored or collaborated on"
    );

    const duplicateNames = selectCollectionComposerCandidates({
      data: {
        sections: {}, tags: {},
        cards: { one: { author: "First", collaborators: ["Second"] } },
        authors: { First: { displayName: "Casey" }, Second: { displayName: "Casey" } },
      },
      user: { user: { uid: "SomeoneElse" } },
    }).filter(candidate => candidate.category === "author");
    assert.strictEqual(new Set(duplicateNames.map(candidate => candidate.label)).size, 2);
    assert.ok(duplicateNames.every(candidate => !/First|Second/.test(candidate.label)));
  });

  it("caps and deduplicates concrete values while retaining text search", () => {
    const current = CollectionDescription.deserialize("everything/tag-0/");
    const candidates = Array.from({ length: 9 }, (_, index) => ({
      filter: `tag-${index}`,
      category: "tag",
      label: `Tagged “Tag ${index}”`,
      detail: `Keeps cards tagged Tag ${index}`,
      aliases: ["tag"],
    }));
    const suggestions = collectionComposerSuggestions(current, "tag", {}, { candidates });
    assert.strictEqual(suggestions.filter(item => item.kind === "add").length, 6);
    assert.ok(!suggestions.some(item => item.description.filters.filter(filter => filter === "tag-0").length > 1));
    assert.strictEqual(suggestions.at(-1).kind, "search");
  });

  it("offers explicit active-card relationship clauses only with context", () => {
    assert.deepStrictEqual(activeCardRelationshipCandidates(""), []);
    const candidates = activeCardRelationshipCandidates("card-123");
    const suggestions = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"),
      "links from this card",
      descriptions,
      { candidates }
    );
    assert.strictEqual(suggestions[0].label, "This card and cards it links to");
    assert.deepStrictEqual(suggestions[0].description.filters, ["children/+card-123"]);
    assert.match(suggestions[0].detail, /copied links keep this anchor/);
    assert.doesNotMatch(suggestions[0].description.serialize(), /key-card-id/);
    assert.strictEqual(suggestions.at(-1).kind, "search");
    assert.strictEqual(
      readableCollectionExpression(suggestions[0].description),
      "Everything AND This Card And Cards It Links To"
    );
    const byFamilyName = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"),
      "children",
      descriptions,
      { candidates }
    );
    assert.strictEqual(byFamilyName[0].label, "This card and cards it links to");

    const withoutTyping = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"),
      "",
      descriptions,
      { candidates }
    );
    assert.deepStrictEqual(withoutTyping.slice(0, 1).map(suggestion => suggestion.label), [
      "This card and directly connected cards",
    ]);
    const withRecent = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"),
      "",
      descriptions,
      {
        candidates,
        recentCollections: [{
          description: CollectionDescription.deserialize("everything/starred/"),
          visits: 1,
        }],
      }
    );
    assert.ok(!withRecent.some(suggestion => suggestion.kind === "add" && suggestion.label.includes("This card")));
    assert.ok(withRecent.some(suggestion => suggestion.label === "Keep only Unread"));
  });

  it("turns visible active-card metadata into explicit contextual clauses", () => {
    const base = [
      { filter: "inductively-knowable", category: "tag", label: "Tagged", detail: "", valueLabel: "Inductively Knowable", clauseLabel: "Tagged Inductively Knowable" },
      { filter: "systems", category: "tag", label: "Tagged", detail: "", valueLabel: "Systems", clauseLabel: "Tagged Systems" },
      { filter: "half-baked", category: "section", label: "Section", detail: "", valueLabel: "Half Baked", clauseLabel: "Section Half Baked" },
      { filter: "working-notes", category: "card type", label: "Type", detail: "", valueLabel: "Working Notes", clauseLabel: "Card Type Working Notes" },
      { filter: "author/person", category: "author", label: "Cards Casey authored or collaborated on", detail: "", valueLabel: "Casey", clauseLabel: "Contributed By Casey" },
      { filter: "author/collaborator", category: "author", label: "Cards Alex authored or collaborated on", detail: "", valueLabel: "Alex", clauseLabel: "Contributed By Alex" },
    ];
    const contextual = activeCardMetadataCandidates({
      section: "half-baked",
      tags: ["missing-tag", "systems", "inductively-knowable"],
      cardType: "working-notes",
      contributors: ["Person", "Collaborator", "Person"],
    }, base);
    assert.deepStrictEqual(contextual.map(candidate => candidate.filter), [
      "inductively-knowable",
      "systems",
      "half-baked",
      "working-notes",
      "author/person",
      "author/collaborator",
    ]);
    assert.deepStrictEqual(contextual.filter(candidate => candidate.spotlight).map(candidate => candidate.filter), [
      "inductively-knowable",
      "half-baked",
    ]);
    assert.match(contextual[0].detail, /open card has this tag/i);
    assert.match(contextual[0].urlDetail, /copied links keep this value/i);
    assert.strictEqual(
      readableCollectionExpression(
        CollectionDescription.deserialize("everything/inductively-knowable/"),
        Object.fromEntries(contextual.map(candidate => [candidate.filter, candidate.clauseLabel]))
      ),
      "Everything AND Tagged Inductively Knowable"
    );

    const combined = [...contextual, ...activeCardRelationshipCandidates("card-123")];
    const withoutTyping = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"), "", descriptions, { candidates: combined }
    );
    assert.deepStrictEqual(withoutTyping.slice(0, 3).map(suggestion => suggestion.label), [
      "Keep only cards tagged “Inductively Knowable”",
      "Keep only section “Half Baked”",
      "This card and directly connected cards",
    ]);
  });

  it("executes durable relative-date candidates with their stated meaning", () => {
    const [filter] = makeConfigurableFilter("updated/after/7-days-ago");
    const timestamp = (date) => ({ toMillis: () => date.getTime() });
    const recent = new Date();
    const old = new Date();
    old.setDate(old.getDate() - 8);
    assert.strictEqual(filter({ updated_substantive: timestamp(recent) }).matches, true);
    assert.strictEqual(filter({ updated_substantive: timestamp(old) }).matches, false);

    const candidates = selectCollectionComposerCandidates({ data: { sections: {}, tags: {}, cards: {}, authors: {} } });
    const suggestions = collectionComposerSuggestions(
      CollectionDescription.deserialize("everything/"),
      "last 7 days",
      descriptions,
      { candidates }
    );
    assert.strictEqual(suggestions[0].label, "Updated since 7 days ago");
    assert.deepStrictEqual(suggestions[0].description.filters, ["updated/after/7-days-ago"]);

    const beforeMidnight = new Date(2026, 6, 17, 23, 59);
    const afterMidnight = new Date(2026, 6, 18, 0, 1);
    assert.notStrictEqual(
      configurableFilterCacheKey("updated/after/today", beforeMidnight),
      configurableFilterCacheKey("updated/after/today", afterMidnight)
    );
    assert.strictEqual(
      configurableFilterCacheKey("updated/after/2026-7-17", beforeMidnight),
      configurableFilterCacheKey("updated/after/2026-7-17", afterMidnight)
    );
  });

  it("marks configurable families for guided editing before commitment", () => {
    const current = CollectionDescription.deserialize("everything/");
    const [suggestion] = collectionComposerSuggestions(
      current,
      "updated",
      descriptions
    );
    assert.match(suggestion.description.filters[0], /^updated\//);
    assert.strictEqual(suggestion.configureFilter, "updated");
    assert.strictEqual(suggestion.label, "Configure Updated");
    assert.match(suggestion.detail, /choose its values before changing the draft/);
  });

  it("routes nested collection expressions to lossless Source editing", () => {
    const current = CollectionDescription.deserialize("everything/");
    const [suggestion] = collectionComposerSuggestions(
      current,
      "exclude",
      descriptions
    );
    assert.strictEqual(suggestion.sourceFilter, "exclude");
    assert.strictEqual(suggestion.configureFilter, undefined);
    assert.strictEqual(suggestion.label, "Edit Exclude in Source");
    assert.match(suggestion.detail, /completions/);
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

  it("keeps text search available when slash-containing source is invalid", () => {
    const current = CollectionDescription.deserialize("everything/");
    const suggestions = collectionComposerSuggestions(current, "view/grid/", descriptions);
    assert.ok(suggestions.some((suggestion) => suggestion.label === "Text contains “view/grid/”"));
  });

  it("keeps text search available beside a valid slash source", () => {
    const current = CollectionDescription.deserialize("everything/");
    const suggestions = collectionComposerSuggestions(current, "starred/unread/", descriptions);
    assert.strictEqual(suggestions[0].action, "open");
    assert.ok(suggestions.some((suggestion) => suggestion.label === "Text contains “starred/unread/”"));
  });

  it("does not offer to append an already applied filter", () => {
    const current = CollectionDescription.deserialize("everything/starred/");
    const suggestions = collectionComposerSuggestions(current, "starred", descriptions);
    assert.ok(!suggestions.some((suggestion) => suggestion.label === "Add Starred"));
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
    const web = CollectionDescription.deserialize("everything/view/web/graph/");
    assert.strictEqual(
      readableCollectionExpression(web),
      "Everything · viewed as Web (Graph)"
    );
    const union = CollectionDescription.deserialize("everything/starred+unread/");
    assert.strictEqual(
      readableCollectionExpression(union),
      "Everything AND (Starred OR Unread)"
    );
  });

  it("exposes structured expression parts without reparsing display text", () => {
    const description = CollectionDescription.deserialize(
      "everything/starred+unread/query/inductively+knowable/sort/reverse/recent/view/web/graph/"
    );
    const parts = collectionExpressionParts(description);
    assert.deepStrictEqual(parts.set, { raw: "everything", label: "Everything" });
    assert.deepStrictEqual(parts.filters.map(({ raw, label, index }) => ({ raw, label, index })), [
      { raw: "starred+unread", label: "(Starred OR Unread)", index: 0 },
      { raw: "query/inductively+knowable", label: "Query Inductively Knowable", index: 1 },
    ]);
    assert.deepStrictEqual(parts.modifiers, ["sorted by reverse Recent", "viewed as Web (Graph)"]);
  });
});
