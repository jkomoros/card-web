/*eslint-env node*/

import assert from "assert";

let readCollectionComposerMode;
let writeCollectionComposerMode;
let collectionComposerEnabled;
let collectionComposerPublicEnabled;
let collectionComposerParserShadowEnabled;
let collectionComposerPreviewEnabled;
let writeCollectionComposerPreviewEnabled;

const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

describe("Collection Composer capability", () => {
  let originalWindow;

  before(async () => {
    originalWindow = globalThis.window;
    ({
      readCollectionComposerMode,
      writeCollectionComposerMode,
      collectionComposerEnabled,
      collectionComposerPublicEnabled,
      collectionComposerParserShadowEnabled,
      collectionComposerPreviewEnabled,
      writeCollectionComposerPreviewEnabled,
    } = await import("../../lib/src/collection-composer-mode.js"));
  });

  beforeEach(() => {
    globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  });

  after(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it("is safely off by default", () => {
    assert.strictEqual(readCollectionComposerMode(), "off");
    assert.strictEqual(collectionComposerEnabled(), false);
    assert.strictEqual(collectionComposerPublicEnabled(), false);
    assert.strictEqual(collectionComposerParserShadowEnabled(), false);
  });

  it("supports an explicit dogfood mode", () => {
    writeCollectionComposerMode("dogfood");
    assert.strictEqual(readCollectionComposerMode(), "dogfood");
    assert.strictEqual(collectionComposerEnabled(), true);
    assert.strictEqual(collectionComposerPublicEnabled(), false);
    assert.strictEqual(collectionComposerParserShadowEnabled(), true);
  });

  it("keeps a hash override for the current tab after navigation", () => {
    globalThis.window.location = { hash: "#collection-composer=dogfood" };
    assert.strictEqual(readCollectionComposerMode(), "dogfood");
    assert.strictEqual(
      globalThis.window.localStorage.getItem("collection-composer"),
      null
    );
    globalThis.window.location.hash = "";
    assert.strictEqual(readCollectionComposerMode(), "dogfood");
  });

  it("keeps hash-enabled previews for the current tab", () => {
    globalThis.window.location = { hash: "#collection-composer=on&collection-composer-preview=on" };
    assert.strictEqual(collectionComposerPreviewEnabled(), true);
    globalThis.window.location.hash = "";
    assert.strictEqual(collectionComposerPreviewEnabled(), true);
  });

  it("supports the public-on bundle without diagnostics", () => {
    writeCollectionComposerMode("on");
    assert.strictEqual(readCollectionComposerMode(), "on");
    assert.strictEqual(collectionComposerEnabled(), true);
    assert.strictEqual(collectionComposerPublicEnabled(), true);
    assert.strictEqual(collectionComposerParserShadowEnabled(), false);
  });

  it("keeps worker previews behind a subordinate capability", () => {
    writeCollectionComposerPreviewEnabled(true);
    assert.strictEqual(collectionComposerPreviewEnabled(), false);
    writeCollectionComposerMode("dogfood");
    assert.strictEqual(collectionComposerPreviewEnabled(), true);
    writeCollectionComposerPreviewEnabled(false);
    assert.strictEqual(collectionComposerPreviewEnabled(), false);
  });

  it("normalizes unknown persisted values to off", () => {
    globalThis.window.localStorage.setItem(
      "collection-composer",
      "experimental"
    );
    assert.strictEqual(readCollectionComposerMode(), "off");
  });

  it("clears persisted state when disabled", () => {
    writeCollectionComposerMode("on");
    writeCollectionComposerMode("off");
    assert.strictEqual(
      globalThis.window.localStorage.getItem("collection-composer"),
      null
    );
    assert.strictEqual(readCollectionComposerMode(), "off");
  });

  it("is safely off without a window", () => {
    delete globalThis.window;
    assert.strictEqual(readCollectionComposerMode(), "off");
    assert.doesNotThrow(() => writeCollectionComposerMode("on"));
  });
});
