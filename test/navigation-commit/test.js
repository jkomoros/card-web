/*eslint-env node*/

import assert from "assert";

let navigationCommitDecision;
let normalizeNavigationPath;

describe("navigation compare-and-commit decision", () => {
  before(async () => {
    ({ navigationCommitDecision, normalizeNavigationPath } = await import(
      "../../lib/src/navigation-commit.js"
    ));
  });

  it("normalizes both leading-slash path forms", () => {
    assert.strictEqual(normalizeNavigationPath("c/everything/"), "/c/everything/");
    assert.strictEqual(normalizeNavigationPath("/c/everything/"), "/c/everything/");
  });

  it("does not push a duplicate history entry", () => {
    assert.deepStrictEqual(
      navigationCommitDecision("/c/everything/", "c/everything/", false),
      { status: "unchanged", path: "/c/everything/", history: "none" }
    );
  });

  it("reports editing as an explicit blocker without history", () => {
    assert.deepStrictEqual(
      navigationCommitDecision("/c/everything/", "/c/starred/", true),
      { status: "blocked-editing", path: "/c/starred/", history: "none" }
    );
  });

  it("distinguishes push from silent replace", () => {
    assert.deepStrictEqual(
      navigationCommitDecision("/c/everything/", "/c/starred/", false),
      { status: "commit", path: "/c/starred/", history: "push" }
    );
    assert.deepStrictEqual(
      navigationCommitDecision("/c/everything/", "/c/starred/", false, true),
      { status: "commit", path: "/c/starred/", history: "replace" }
    );
  });
});
