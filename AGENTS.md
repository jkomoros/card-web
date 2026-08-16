# AGENTS.md

Instructions for AI agents working in this repo. Humans may find the
environment section useful too.

The default branch is **`master`** (not `main`).

---

## The rule: no change lands on `master` without an adversarial review

Before committing to `master` — including changes that look trivial, and
including changes that came with a detailed issue telling you exactly what to
do — you MUST run a **separate adversarial sub-agent** against the diff and act
on what it finds.

This is not a code-review formality. Its purpose is to catch the specific
failure mode that a single agent implementing a well-specified fix is worst at
noticing: the fix does what the issue asked, the tests pass, and it is still
wrong — because it was applied at the wrong layer, because another caller
reaches the same defect, or because the tests prove something the product does
not actually do.

### What the adversarial agent must be told

Instruct it to argue AGAINST the change and to assume the author is wrong until
proven otherwise. It must **run code to test its hypotheses, not speculate**,
and it must clearly mark anything it could not verify by execution. A fabricated
or unverified objection is worse than no objection, because it costs a real
investigation to dismiss.

At minimum it must attempt these theses:

| Thesis | The question it must answer |
|---|---|
| **Wrong layer** | Is this papering over a defect that belongs one level down? Enumerate EVERY caller — is there a path to the same bad outcome that bypasses this fix? |
| **Does not achieve the effect** | Construct real inputs that still produce the bad outcome after the change. Include the case where the fix *destroys* something a user wanted kept. |
| **Robustness** | Does the predicate hold at the edges? If a helper has multiple code paths (DOM vs. no-document, worker vs. main thread), do they agree — or do the tests pass on a path the product never takes? |
| **Performance** | Quantify, don't hand-wave. Is new per-item work being paid inside a loop that already runs at scale? |
| **Security** | Does this reorder anything relative to sanitization, permission checks, or rules enforcement? |
| **Test quality** | Are the tests vacuous? Do they exercise the product's real path? Does simplified test fixture markup hide the case that actually breaks? |

### Triage

The agent's findings must be sorted into **BLOCKING** / **NON-BLOCKING** /
**NOISE**.

- **BLOCKING** must be fixed before landing, or explicitly overridden by the
  repo owner in the conversation. Do not override it yourself.
- **NON-BLOCKING** becomes a GitHub issue before landing, not a TODO comment
  and not a promise in a commit message.
- **NOISE** is dropped. Say so; do not silently ignore it.

### The adversarial agent produces claims, not verdicts

Its output is a list of things worth testing. It is not a review you accept, and
"the adversarial agent said so" is not evidence. Before you act on a finding —
especially one that changes the shape of the fix — **verify it yourself, by
running it.** Subagents report confidently and are sometimes wrong; a finding
adopted on trust is indistinguishable from one you invented.

This cuts both ways, and the second direction is the one that gets skipped:

- Before **adopting** a recommendation, reproduce the evidence for it. If the
  claim is that two implementations are equivalent, run both across a real
  battery of inputs and diff the output. Do not re-run the agent's own script;
  write your own.
- Before **dismissing** a finding as NOISE, confirm it is actually noise. The
  cheap failure is waving away a real defect because the agent's framing was
  annoying.

A refutation is a finding too, and often the most valuable one: proving that a
proposed safeguard is unreachable dead code, or that an objection describes
behaviour that already existed, converts a judgment call into a fact you can
state plainly in the commit message. Verify those the same way.

Report to the owner what you verified and how, separately from what the agent
merely asserted. If you could not verify something, say so and treat it as open.

### Prove your tests are not vacuous

A test that passes with *and* without the fix proves nothing. Before landing,
revert the source change (`git stash push <file>`), rebuild, and confirm the new
tests actually FAIL. Then restore and rebuild. State the result.

A test kept deliberately as a regression guard — one that passes either way
because it asserts the fix does not break an adjacent case — is fine, but say
that is what it is.

### When the adversarial pass may be skipped

Only for changes that cannot affect built or deployed behaviour: documentation,
comments, and this file. Everything touching `src/`, `shared/`, `functions/`,
`tools/`, `test/`, rules, or indexes needs it.

---

## Environment traps

These have each cost real debugging time. None are optional.

**Node 20.20.0 is required.** The login default is v18, which silently produces
different results and breaks `firebase-tools`. Every shell:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"
node --version   # MUST print v20.20.0
```

**Git hooks hang** and stash unstaged changes. Always:

```bash
git -c core.hooksPath=/dev/null <cmd>
git commit --no-verify
```

**Tests import compiled output.** Build before running any mocha suite, or you
will validate a stale build (`tools/assert-build-fresh.cjs` catches the obvious
cases, but build first anyway):

```bash
npm run build:shared && npm run build:typescript
```

**`firestore.rules` is GENERATED** from `firestore.TEMPLATE.rules` by
`npm run generate:config`. Never edit `firestore.rules` directly; your change
will be silently overwritten.

**`gcloud`'s active config points at PROD** (`complexity-compendium`). A stray
gcloud command hits production. `npm run backup` calls `gcloudEnsureProd()`
itself, so it repoints the project regardless of what your shell had set.

**`npm run deploy` runs no tests and takes no backup.** Both are manual,
separate steps. Nothing warns you if you skip them.

---

## Tests

`npm test` runs everything, including ~200 Firestore-emulator security tests.

CI (`.github/workflows/test.yml`) runs `npm run test:ci`, which is everything
*except* `test:security` — that one needs `config.SECRET.json`, which is
gitignored and correctly absent from CI. `test/ci-coverage` asserts that this is
the **only** exemption, so the workflow cannot silently drift into running less
than it claims. If you add a suite, that assertion is what will tell you.

Run the full suite before landing on `master`, not just the suite you think you
touched.

---

## Commit messages

Explain WHY, not just what. Describe the failure mode being fixed and the
alternative you rejected — the repo's history is used as an engineering record,
and "what" is already in the diff.

Do not claim a verification you did not perform. If tests failed, say so; if a
step was skipped, say that.
