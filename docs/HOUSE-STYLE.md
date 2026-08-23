# HOUSE-STYLE.md

The user-facing house style: the conceptual model the app presents, the words it
uses, how it looks, and how it behaves. This is the reference for anyone — human
or agent — adding or changing something a user can see.

**This document is normative, not descriptive.** It records the style the app is
converging on. Where the app does not yet comply, that is recorded in §7 as debt,
not as precedent. Do not cite existing non-compliant code as justification for
writing more of it.

---

## 0. How to use this

Rules are numbered so audits and reviews can cite them (`HS-2.1`, `HS-4.2`).
**MUST** rules are enforceable and a reviewer should block on them. **SHOULD**
rules are the default; departing from one requires a comment at the site saying
why.

Before building a user-facing surface, check **§5, the canonical primitive
index**. The single most common failure mode in this codebase is not bad taste —
it is a component re-inventing a primitive that already exists three directories
away. `progress-panel.ts` was written specifically to end progress-surface
divergence and is used by two of eleven long-running surfaces. `snack-bar.ts`
carries the comment "the snack-bar existed for exactly this and was used once,
ever" (`src/actions/app.ts:500`). `sync-copy.ts` had to consolidate *eight*
different sentences for "sync is not ready".

Look for the primitive first. If it does not exist, build it as a primitive.

---

## 1. The conceptual model

### 1.1 Card is the atom — MUST

The card is the only durable content object (`shared/types.ts:436`). Every other
user-facing noun is one of three things: a **property of** cards, a **set of**
cards, or a **derivative of** cards.

Do not introduce a user-facing noun that breaks this. If a new feature needs to
persist something, the first question is whether it is a property of a card, a
set of cards, or a derivative — and if it is genuinely none of those, that is a
conceptual-model change and needs the repo owner's sign-off, not just a schema
migration.

### 1.2 The nouns

| Noun | What it is to the user | Defined |
|---|---|---|
| **Card** | The atom. Has a type, a title, a body, and a place. | `shared/types.ts:436` |
| **Card type** | What kind of thing this card is. 7 of them, each with a one-line description. | `shared/card_fields.ts:87-181` |
| **Section** | Where a card lives. A card is in 0 or 1. Determines default order. | `src/types.ts:613` |
| **Tag** | A group a card is in. A card is in 0 or more. | `src/types.ts:625` |
| **Reference** | A typed edge from one card to another. 16 types, each with a name and description. | `shared/card_fields.ts:184-380` |
| **Collection** | An addressable set of cards. Always a URL. See §1.3. | `src/collection_description.ts:225` |
| **Filter** | A named predicate that narrows a collection. | `src/filters.ts` |
| **Sort** | An order for a collection. 14 of them. | `src/filters.ts:1665` |
| **Comment** | A thread of messages attached to a card. | `src/types.ts:441` |
| **Concept** | A card type whose title becomes vocabulary, highlighted in other cards. | `src/nlp.ts:227` |
| **Suggestion** | A machine-proposed change to a card, which you accept or reject. | `src/types.ts:975` |
| **Card sync** | Keeping your cards available locally. Never called "the corpus" in the UI. | `src/sync-copy.ts` |

### 1.3 "Collection" is a reserved word — MUST

**A collection is an addressable set of cards, expressed as a URL.** That is the
only thing the word means in user-facing copy.

Sections and tags are **card properties**, not collections. Each one *names* a
collection — `/c/section-name/` is a real, shareable URL — but the property and
the collection are different things, and the copy must not conflate them.

Approved phrasings:

- A section is **"where a card lives"**. A card is in 0 or 1 sections.
- A tag is **"a group a card is in"**. A card is in 0 or more tags.
- A collection is **"a set of cards you can link to"**.

Forbidden: describing a tag or a section *as* a collection. This is the app's
single worst terminology defect today — the editor says "Tags are collections…
that a card can be in" (`src/components/card-editor.ts:689`) while the info panel
says a section is "The collection that this card lives in"
(`src/components/card-info-panel.ts:313`), and the Configure Collection dialog
uses the word for a third thing. Nothing in the UI currently defines it. See
§7 debt item D1.

**Corollary — every view of cards SHOULD be a collection.** Tabs, reference
blocks, search results and selection are all `CollectionDescription`s today, and
new card-listing surfaces should be too rather than inventing a parallel
mechanism. Note the honest exceptions: `reading-list` and `main` are *sets*
precisely because their order is not expressible as filters
(`shared/types.ts:146-153`).

**Corollary — if a collection's URL does not reproduce for another user, say
so.** Several do not: `random` sort depends on a session-local salt, `selected`
depends on unpersisted selection, and `starred`/`unread`/`in-reading-list` are
per-user. Each of these currently offers a "Navigate to this collection" button
that produces a URL which will not reproduce. See §7 debt item D2.

### 1.4 One word per concept — MUST

| Use | Never | Note |
|---|---|---|
| Tag | Label | "Label" appears throughout bulk-operation errors for the thing the editor calls a tag |
| Save | Commit, Modify | The button says Save; the tooltip, the shortcut label and the action family should agree |
| Sign in / Sign out | Log in, Login | Hyphenate only the adjective ("sign-in error"), never the verb |
| Card sync | Corpus, Compendium sync | "Corpus" is an internal word |
| Section | — | The place a card lives |
| Tag | — | A group a card is in |
| Collection | View, Card list | §1.3 |
| Delete | Remove (for irreversible acts) | "Remove" is for reversible removal from a set; "Delete" destroys |
| Discard | Delete (for unsaved work) | Drafts and pending operations are discarded, not deleted |
| Reference | Link (for typed edges) | "Link" means a hyperlink in a card body; a `link` reference is user-labeled "Body link" |
| Suggested concepts | Missing concepts | One feature, one name — pick "Suggested concepts" |
| Working notes | Working note, working-notes | Plural, two words, in visible copy |

**The app title is configuration, not a literal — MUST.** `APP_TITLE` is a config
key. Never hardcode "Compendium" (or any deployment's name) in a string. It is
currently hardcoded in ~12 of the app's most disruptive messages. See §7 debt
item D3.

**Never show an internal identifier to a user — MUST.** No raw enum keys
(`working-notes`, `todo-difficulty`, `card-rank`), no internal concept names
("card finisher", "replay preflight", "retaining intent"), no GitHub issue
numbers, no Firebase error codes. Every enum that reaches the UI needs a display
name.

---

## 2. UX writing

### 2.1 Capitalization — MUST

**Names are Title Case. Actions and prose are sentence case.**

| Surface | Case | Example |
|---|---|---|
| Dialog titles | Title Case | `Configure Collection`, `Image Properties` |
| Form labels | Title Case | `Card Type`, `Force Enable TODO` |
| Tab and section names | Title Case | `Reading List` |
| Button labels | sentence case | `Reload`, `Use this tab`, `Stop and leave partial result` |
| Tooltips (`title=`) | sentence case | `Edit all cards`, `Star this card` |
| `aria-label` | sentence case | `Save card` |
| Snackbar and error messages | sentence case | |
| Empty states | sentence case | |
| Placeholder text | sentence case | |

The test: does the string *name a thing* (Title Case) or *tell you to do
something / tell you what happened* (sentence case)?

Text buttons are already 100% sentence case and read well. Form labels are
already 100% Title Case and are machine-generated by `toTitleCase()` at
`src/components/card-editor.ts:602`. The work is in the tooltips, which are split
23 sentence / 10 Title, sometimes on adjacent lines of the same control group.

### 2.2 Punctuation and glyphs — MUST

- **Ellipsis is `…` (U+2026)**, never `...`. Currently split ~17 Unicode / ~8 ASCII.
- **Apostrophe is `'` (U+2019)** in prose. Currently mixed.
- **Quotes around user data are `"…"` (U+201C/U+201D)**, not `"…"`.
- **Terminal periods**: full sentences take one. Fragments — button labels,
  tooltips, empty states, form labels — do not. Today this splits by file rather
  than by rule, and one control's tooltip flips between the two depending on
  state (`src/components/card-editor.ts:970`).
- **No exclamation marks.** There are four in the app and none are earned; one is
  on an error message (`'No changes to make!'`) and one is on a destructive bulk
  import.

### 2.3 Voice — SHOULD

- **Second person.** "Your draft is safe", "Your cards are on the server".
- **Contractions are fine** and preferred — but be consistent within a message.
- **Imperative for actions**: `Edit card`, `Move image left`, `Delete card permanently`.
- **Gerund + ellipsis for progress**: `Saving card…`, `Waiting for a connection…`.
  `src/sync-copy.ts:70-76` defines the canonical verb constants; use them.
- **Never blame the user.** "That couldn't be saved" beats "You didn't do X".

### 2.4 The error formula — MUST

`src/sync-copy.ts` is the model for every error message in the app. It **derives**
the reason from actual state rather than asserting one, and its header comment
records why: eight competing sentences existed, and all of them asserted
"verifying" while the gate also fired on three other states — so the header pill
and the Save tooltip two inches away contradicted each other.

An error message has four parts, in order. The first two are mandatory:

1. **What happened**, in the user's vocabulary. *"That card no longer exists on the server"*
2. **What it means for their work.** *"so your edit was not saved"*
3. **Reassurance, if any is true.** *"Your draft has been kept"*
4. **The next step, if there is one.** *"copy anything you need before discarding it"*

The canonical helper is `blockedReason(status, verb)` (`src/sync-copy.ts:56-64`),
which composes exactly this shape from a status and a gerund verb.

**Never show a raw error object to a user — MUST.** `alert(err)` on an `Error` is
currently the app's default save-failure UI (`src/actions/data.ts:3252`). Never
interpolate `String(err)`, a Firebase auth code, or an internal concept name into
user-facing text. **Never tell a user to open DevTools** — two messages currently
do.

### 2.5 Accessible names — MUST

**Every control has an accessible name.** An icon-only button MUST carry both a
`title` (for sighted hover) and an `aria-label` (for assistive tech). ~27
icon-only buttons currently have neither — including every dialog's close button
and the primary confirm button of six dialogs. See §7 debt item D4.

- Tooltips are **commands**, not descriptions: `Edit card`, not `Opens the editor`.
- A **disabled** control explains why, on the `span.reason` wrapper — not on the
  button, because Chrome and Safari suppress hover on disabled controls. This is
  documented and provided by `ButtonSharedStyles`
  (`src/components/button-shared-styles.ts:1-13`).
- If a control has a **keyboard shortcut**, the tooltip ends with it in
  parentheses via `shortcutKeys()`: `Edit card (⌘E)`. Six tooltips do this; Find
  (⌘F) and Save (⌘↵) are the notable omissions.
- Tooltips are labels, not state readouts. Do not use a `Noun - Value` shape.

### 2.6 Empty states — SHOULD

One sentence-case fragment, no terminal period, no exclamation, stating what is
absent: `No comments yet`, `No suggestions for this card`. Add a second sentence
only when there is a genuine next step, and phrase it as an offer, not a scolding.

### 2.7 Irreversibility — MUST

One phrasing: **"This can't be undone."** Not "This action cannot be undone", not
"This cannot undo confirmed changes", not "forever", not "Permanently" — the app
currently ships all five. Where only part of an operation is irreversible, say
what survives: *"The 12 cards already saved will keep their changes."*

The app has **no undo, anywhere**. Every such sentence is literally true, which
is exactly why it must not be diluted by overuse — see §3.7.

---

## 3. Feedback, dialogs, and containers

### 3.1 The four tiers

| Tier | What it's for | Primitive |
|---|---|---|
| **Inline** | Editing the card itself | `card-editor.ts`, contenteditable, `tag-list` |
| **Panel** | Ambient context tied to the current card; opened by a persistent toggle; lives *in* the layout | `card-info-panel`, `comments-panel`, `card-drawer`, `suggestions-viewer` |
| **Dialog** | A modal sub-task with its own transient state, committed or discarded as a unit | `dialog-element.ts` |
| **Ambient** | Status and transient outcomes; never blocks | `snack-bar`, `progress-panel`, `limit-warning`, `corpus-status-indicator`, the save-status pill |

### 3.2 Choosing a tier — SHOULD

Ask what happens to the user's work if they walk away:

- Nothing to commit → **ambient** or **panel**.
- It edits the card in place → **inline**.
- It accumulates state that must be committed or thrown away as a unit → **dialog**.

A surface that has no commit action is not a dialog. `configure-collection-dialog`
is the standing counter-example: it has no OK/Cancel, mutates a live snapshot on
every keystroke, and its own scrim hides the collection it is configuring. It is
a panel wearing dialog clothes.

### 3.3 The dialog contract — MUST

Subclass `DialogElement` (`src/components/dialog-element.ts`). It provides the
scrim, the close button, the `<h2>` title, **one** scroll container (`#inner`),
Escape at `DIALOG_SHORTCUT_PRIORITY`, backdrop-click, and focus-on-open.

- Override `innerRender()`. Do **not** override `updated()` without calling
  `super.updated()` — two dialogs do, and one of them focuses nothing on open as
  a result.
- `_shouldClose(cancelled)` MUST treat backdrop-click and Escape identically.
  `find-dialog` currently does not, leaving the editor in a stale linking state
  when the scrim is clicked.
- Set `this.mobile` from `state.app.mobileMode`. Only one of eight dialogs does,
  so the base class's mobile rule is dead for the other seven.
- **Buttons go bottom-right, primary last (rightmost).** Cancel, where present,
  sits to its left. The `.buttons` flex block belongs in the base class, not
  copy-pasted — it is currently duplicated in six subclasses.
- The primary action is a `button.round.primary` with `aria-label`.
- A dialog MUST always be dismissable. `multi-edit-dialog` can currently refuse
  Escape, the X, and the backdrop simultaneously.

New dialogs must also be added to `selectKeyboardNavigates`
(`src/selectors.ts:544`), which enumerates them by hand — a ninth dialog will
silently fail to suppress global shortcuts. Prefer fixing the enumeration.

### 3.4 Native browser modals — MUST NOT add new ones

**`alert()`, `confirm()` and `prompt()` are forbidden in new code.** There are 82
call sites today (`src/` + `shared/`). That number must not grow.

The count is pinned and reviewers check it — see §6. Existing sites are migrated
opportunistically: **if you are already editing a function that contains one,
replace it.** Do not file an issue for the ones you did not touch.

The replacement for each:

| Instead of | Use |
|---|---|
| `alert()` reporting a transient outcome | `showSnackbar()` |
| `alert()` reporting a persistent failure | The save-status pill / an error banner |
| `alert()` reporting a validation refusal | Inline validation on the field |
| `alert()` reporting a precondition | A disabled control with a `span.reason` tooltip |
| `confirm()` guarding an irreversible act | A destructive-confirm dialog (§3.7) |
| `confirm()` as a pre-save warning | One pre-save review dialog listing all warnings |
| `confirm()` as a boolean form field | A checkbox in a real form |
| `prompt()` | An input dialog |
| `prompt()` to pick a card | `find-dialog` — it is already a card picker |
| `prompt()` to expose text for copying | A copy button + `navigator.clipboard` + a snackbar |

Three of these targets do not exist yet: **a destructive-confirm dialog, a generic
input dialog, and a persistent error banner.** Building them is the unblocking
work; until they exist, "opportunistically" will not have anywhere to land.

Two properties of native modals make them worse than they look: they fire from
inside dialogs (a native `prompt` over the Find dialog), and they fire with no
user action at all (the background write queue alerts on failure). Saving a
single card can currently fire seven sequential `confirm()`s.

### 3.5 Transient feedback — MUST

**Every user-initiated action gets feedback.** Today star, mark-read,
reading-list, single-card tag changes, suggestion accept/reject, comment resolve
and clipboard copy all succeed silently; several operations fail silently to
`console.warn`.

- A **visible state change** counts as feedback (the star fills in). Nothing more
  is needed.
- Otherwise use `showSnackbar()` (`src/actions/app.ts:502`).
- **A refusal is never silent.** `console.warn` and return is not a user
  interface. Card deletion currently refuses for policy reasons with no on-screen
  response at all.

Refusals resolve one of three ways, in preference order:
1. **Prevent it** — disable the control, explain why on the `span.reason` wrapper.
2. **Explain it inline** — next to the field that is wrong.
3. **Report it** — snackbar for transient, banner for persistent.

Note the snackbar's current limits: one message, one shared timer, no stacking,
no action button, no `aria-live`. A second message overwrites the first
silently. Fix the primitive rather than routing around it.

### 3.6 Progress — MUST

Any operation that can exceed ~1 second uses `progress-panel.ts`. It provides a
heading, a determinate-or-indeterminate bar, an honest count, and a `<details>`
disclosure.

A progress surface MUST say **what** is happening and, when the total is known,
**how far along** it is. A bare translucent scrim is not a progress indicator —
`suggestions-viewer.ts` still ships one, which is the exact defect
`progress-panel.ts` was written to fix.

### 3.7 Destructive actions — MUST

Two tiers, by reversibility:

**Tier 1 — irreversible once committed.** Delete card, delete comment, discard a
draft, discard a pending operation, resolve a thread, stop a running bulk
operation, overwrite another user's edits, accept a suggestion.

- The control's icon is `var(--app-warning-color)`.
- The action requires an explicit confirm naming what is lost.
- The confirm's action button repeats the verb — `Delete card`, not `OK`.
- The copy uses the §2.7 phrasing.

**Tier 2 — reversible until Save.** Remove a tag, remove a reference, remove an
editor, remove a filter, change a field.

- Plain `button.small` treatment.
- **No confirm.** These are fast, repeated actions; confirming them trains people
  to dismiss confirms without reading, which is what makes Tier 1 dangerous.

The precedent is `card-web-app.ts:369` — the Stop button, the app's one
warning-colored control, added with a comment saying "the most destructive
control on screen keeps a visibly distinct treatment". Generalize it.

Today the tiers are inverted in places: fork (recoverable) is confirmed, while
resolving a thread and accepting a suggestion (not recoverable) are not.

Guards belong in the **action**, not the component, so every caller is covered.

### 3.8 Keyboard — SHOULD

Register through `src/shortcuts.ts` — never add a bare `window.addEventListener`
for a key. The registry handles priority, focus policy, repeat suppression, IME,
and reserved-combo rejection at registration time.

Every binding carries a `label`. Those labels are currently rendered nowhere;
19 shortcuts have zero discoverability. A shortcut sheet is the intended
consumer.

Escape closes the topmost dismissable surface. `⌘↵` commits the focused editor
or dialog — it currently reaches two of eight dialogs.

---

## 4. The visual system

### 4.1 Tokens — MUST

Every color, shadow, font family and transition comes from a custom property
defined at `src/components/card-web-app.ts:178-237`. That block is the single
source of truth.

- **Never write a literal color in component CSS.** There are ~38 competing color
  literals today against 44 tokens.
- **Never use a fallback value in `var()`** — `var(--app-divider-color, #e0e0e0)`.
  If the token exists the fallback is dead; if it doesn't, the fallback silently
  becomes the design. Two current fallbacks *contradict* their tokens, and three
  tokens referenced by `chat-view.ts` are never defined at all, so that component
  renders blue in a purple app.
- **If a value needs to exist in two places, it needs a token.** Eight distinct
  translucent-whites currently serve one "scrim" role.
- Adding a token means adding it to the `:host` block with a comment saying what
  role it serves, in the style of `--app-pending-color`.

### 4.2 Buttons — MUST

Import `ButtonSharedStyles`. Three components with `<button>` currently do not,
and render native UA buttons next to the app's own.

| Variant | Class | Use for |
|---|---|---|
| **Subtle icon** | `button.small` | The default. Inline actions in panels, editors, lists, dialog close |
| **Circle icon** | `button.round` | Persistent toolbar actions, FABs, dialog confirm |
| **Primary circle** | `button.round.primary` | The one committing action of a surface (Save, Accept, Send) |
| **Toggle on** | `.selected` | A toggle in its on state; always paired with `aria-pressed` |
| **Destructive** | `button.small` + warning-color fill | Tier 1 acts only (§3.7) |
| **Text button** | `button` | Banners and gates, where a verb is clearer than a glyph |

**These are the only variants.** A surface needing something else should extend
`ButtonSharedStyles`, not hand-roll a local button system — `corpus-ownership-gate`
currently defines its own, including a `.secondary` outline variant that exists
nowhere else.

- **Never render a text glyph where an icon exists.** `+` and `X` appear as
  literal characters in four places while `PLUS_ICON` and `CANCEL_ICON` exist.
- **44px minimum hit target.** `button.small` is currently 18×18 with
  `padding: 0; margin: 0`, against 48 usages. Two sites patch this locally; the
  fix belongs in `ButtonSharedStyles`.
- Icons come from `shared/icons.ts` (Material). New icons use the classic
  `0 0 24 24` viewBox to match the other 55.

### 4.3 Typography — SHOULD

Two families, both from tokens: `--app-header-font-family` (Raleway) for titles,
`--app-default-font-family` (Source Sans Pro) for body. `card-renderer.ts`
hardcodes both, in the most visible component in the app.

**Only weights 400 and 700 exist.** They are the only ones loaded. `500` and
`600` are requested in four places and silently synthesized.

Sizes: **`em` inside the card** (relative to the 20px anchor at
`card-stage.ts:160` — this half of the system is coherent and should stay);
**`rem` in the chrome**. Never `px` for text. The documented conventions worth
keeping: `0.75em` + `--app-dark-text-color-light` for a subordinate label,
`0.7em` for the smallest metadata.

### 4.4 Elevation, radius, motion — SHOULD

- **Elevation is a two-step ladder**: `var(--card-shadow)` for any surface
  floating above the page, and the button rest→hover pair. Twelve distinct
  shadow values exist today, five of them serving the single role "floating".
- **Core surfaces are square.** Cards, dialogs, thumbnails, comment threads and
  non-round buttons have `border-radius: 0`. Rounding is for pills (`999px`) and
  circles (`50%`) only. Eleven other radius values exist in newer chrome, no two
  components agreeing.
- **Transitions use `var(--transition-fade)`.**
- Respect `prefers-reduced-motion`.

### 4.5 Color semantics — MUST

| Token | Means |
|---|---|
| `--app-primary-color` (purple) | Brand; a link; the committing action |
| `--app-secondary-color` (teal) | Live/exists; hover; a toggle that is on |
| `--app-warning-color` (red) | Error, or a Tier 1 destructive control |
| `--app-pending-color` (amber) | Not yet on the server |
| `--app-dark-text-color` | Body text; a subtle icon |
| `--app-dark-text-color-light` | Subordinate, or disabled |

Red currently also means "unpublished" (`card-link.ts:146`), which collides with
"error". Unpublished should get its own treatment.

### 4.6 Layout — SHOULD

- **Panel**: 13em column, `0.5em` padding, a 1px `--app-divider-color` rule on the
  joining edge, `h3` at `font-weight: normal` in `--app-dark-text-color-light`.
- **Use `gap`, not margins**, for flex spacing in new code.
- **One breakpoint: 900px.** It lives in `installMediaQueryWatcher`
  (`card-web-app.ts:667`) and is applied as a `mobile` property threaded down and
  set as a class. Do not add a CSS `@media` query for it; take the property.

---

## 5. Canonical primitive index

Check this table before building. If the job is here, the primitive exists.

| Job | Primitive |
|---|---|
| Modal sub-task | `dialog-element.ts` |
| Pick a card | `find-dialog.ts` (already supports picker modes) |
| Long-running operation | `progress-panel.ts` |
| Transient outcome | `showSnackbar()` — `src/actions/app.ts:502` |
| Persistent failure | The save-status pill — `card-web-app.ts:350` |
| Ambient status | `corpus-status-indicator.ts`, `limit-warning.ts` |
| Buttons | `ButtonSharedStyles` |
| Links, headings, `[hidden]` | `SharedStyles` |
| Scrollable region | `ScrollingSharedStyles` |
| Icons | `shared/icons.ts` |
| Copy about sync being unavailable | `blockedReason()` — `src/sync-copy.ts` |
| Keyboard shortcut | `src/shortcuts.ts` |
| Explain a disabled control | `span.reason` wrapper (in `ButtonSharedStyles`) |
| Define a term in place | `help()` — `src/components/help-badges.ts` |
| Card set / any view of cards | `CollectionDescription` |

**Missing primitives** — build these rather than working around them:
a destructive-confirm dialog, a generic input dialog, a persistent error banner,
a keyboard-shortcut sheet, and a stackable snackbar.

---

## 6. Enforcement

**The native-modal ratchet.** The count of `alert(`/`confirm(`/`prompt(` call
sites in `src/` and `shared/` is pinned. It may fall; it may not rise. The
baseline is **82**.

```bash
grep -rnE "(^|[^a-zA-Z0-9_.])(window\.)?(alert|confirm|prompt)\(" src shared --include="*.ts" \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*)" | wc -l
```

This is currently enforced **by review, not by a test**: run the command, compare
against the number above. When you remove sites, lower the pin in this document
in the same commit.

That is a deliberate choice to keep the rule cheap, and it has a known failure
mode: a reviewer who does not know the pin exists will not check it, and the
baseline will drift upward silently. If that starts happening, the fix is a
source-text pin test in `test/`, following the idiom already used elsewhere in
this repo — the grep above is written to be dropped into one unchanged.

The same reasoning applies to the other rules here that are countable rather than
tasteful — icon-only buttons without an accessible name, literal colors in
component CSS, `var()` fallbacks. None are pinned today. Each becomes worth
pinning at the point where it has visibly regressed once.

---

## 7. Known debt

Ranked by user-visible impact. These are the audit targets, not exceptions to the
rules.

| # | Debt | Rule |
|---|---|---|
| D1 | "Collection" means four things and is never defined in the UI | §1.3 |
| D2 | 82 native modals; save can fire 7 sequential confirms; merge conflict is a `confirm()` loop, one per field | §3.4 |
| D3 | `alert(err)` on a raw `Error` is the default save-failure UI | §2.4 |
| D4 | ~27 icon-only buttons with no accessible name, including every dialog's close button and six dialogs' primary action | §2.5 |
| D5 | Destructive controls are visually identical to safe ones; the tiers are inverted in places | §3.7 |
| D6 | No dialog traps focus, sets `inert`, or sets `role="dialog"` / `aria-modal` | §3.3 |
| D7 | Silent success and silent `console.warn` refusals across ~15 operations | §3.5 |
| D8 | `progress-panel` used by 2 of 11 long-running surfaces | §3.6 |
| D9 | "Compendium" hardcoded in ~12 strings; `APP_TITLE` is config | §1.4 |
| D10 | `chat-view.ts` uses three undefined tokens and renders blue | §4.1 |
| D11 | Tag/label, sign in/log in, suggested/missing concepts split | §1.4 |
| D12 | 31 font sizes, 12 shadows, 11 radii, 8 translucent-whites | §4.1, §4.3, §4.4 |
| D13 | Title Case and sentence case alternate within one control group | §2.1 |
| D14 | 19 shortcuts with zero discoverability | §3.8 |
| D15 | Internal identifiers leak: raw enum keys, `(#745)` in a tooltip, "card finisher", DevTools instructions | §1.4, §2.4 |
| D16 | Typos in shipping copy: "Thesholds", "typcially", "arent", `ai-assitant` (breaking two label associations) | §2 |
| D17 | Shareable-looking URLs that don't reproduce; `canonicalizeURL` erases the collection | §1.3 |
| D18 | `viewMode` is in every collection URL with no UI to set it | §1.3 |
| D19 | Tag creation fails silently through six paths | §3.5 |
| D20 | `.small` hit target is 18px against 48 usages | §4.2 |
