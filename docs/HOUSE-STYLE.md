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

Note on sections and tags: in the code they are already the same type
(`Tags = {[tagName]: Section}`), and **#381 plans to merge them** into tags with
groups, where a section becomes "the tag group you may only pick one of". Do not
invest in copy that elaborates the distinction — describe each one's behaviour
plainly and let the merge simplify it later.
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

**The UI must define the word somewhere — MUST.** The deepest part of this defect
is not any single string; it is that nothing in the product ever says what a
collection is. A `help()` badge next to the Filters label in the Configure
Collection dialog is the natural home: *"A collection is a set of cards you can
link to."* (The dialog's own Title Case name is correct and stays.)

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
| Sign in / Sign out | Log in, Login | Hyphenate only the adjective ("a sign-in error"). The verb is two words, and so is the subject of a sentence: **"Sign in didn't complete"**, never "Sign-in did not complete" |
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

Note what that alert is currently the *only* surface for. `_saveStatus` is
`'idle'` unless `hasDurableBulkIntent` is true (`card-web-app.ts:758`), so the
save-status pill does **not** render for single-card failures; `saveError` only
chooses between `'saving'` and `'paused'` once the pill is already showing. A
failure with no durable-intent record sets `cardModificationError` in Redux where
nothing renders it. **Deleting that `alert()` before the error banner exists would
convert roughly 25 failure paths from rude to silent** — which is worse, and is
why §5 lists the banner as blocking.

### 2.5 Accessible names — MUST

**Every control has an accessible name.** An icon-only button MUST carry both a
`title` (for sighted hover) and an `aria-label` (for assistive tech).

A `title` on a `span.reason` WRAPPER does not name the button — verified against
Chromium's accessibility tree. That idiom exists so a disabled control can still
explain itself on hover; the name still has to be on the button. `card-view`'s
star / read / reading-list buttons show the correct pairing.

`test/accessible-names` ratchets both numbers: controls with no accessible name
at all, and controls with nothing on hover. **Both are now 0**, which changes what
this file is: not a budget being spent down, but an invariant. The NEXT nameless
icon button fails CI, rather than the eighteenth after it. Lower the budgets;
never raise them —
unless the SURVEY itself got stricter and began seeing real cases it used to
miss, in which case the budget rises to match and the commit says so. Tell that
apart from a regression by running the old survey against the new tree: if that
number is unchanged, the rise is accuracy.

It also ratchets its own **blind spots**, which is the part worth copying. A
button whose entire body is one interpolation cannot be classified from source
text — `${this._icon()}` needs a name, `${entry.action.label}` names itself, and
they are indistinguishable without running the app. All four in the tree today
are the harmless kind, so widening the icon test to swallow them would have
manufactured four false positives. The count is pinned instead: when a fifth
appears, a human decides which kind it is. Empty-bodied buttons are pinned at
zero, and inline `<svg>` now counts as an icon so the first one cannot arrive
unnamed. Saying nothing about a known hole is exactly how the first version of
that file came to report 6 of 18 and look healthy.

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

**`alert()`, `confirm()` and `prompt()` are forbidden in new code.** There are 81
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
single card can currently fire **seven sequential `confirm()`s plus one per
auto-TODO warning** — `card_diff.ts:335` loops, so the true maximum is unbounded.

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

### 3.6 Time: loading, in flight, pending, and blocked — MUST

Most of this app's hard UI problems are about time. A user acts, and the result
is not instantly and permanently true. The app models **four distinct states**,
and they mean genuinely different things to the user. Conflating them is the
most common failure here.

| State | What is true | What the user can do | Surface |
|---|---|---|---|
| **Loading** | The data isn't here yet. The user did not ask for this; it's the cost of arriving. | Wait, or work with what has arrived | Placeholder, dimmed list, `loading…` |
| **In flight** | The user asked, and it is running right now. | Wait, or cancel if cancelling is safe | `progress-panel`, save-status pill |
| **Pending** | It is committed **locally**. It survives reload. It has not been confirmed by the server. | Anything — including closing the tab | Amber dot, pending badge, snackbar |
| **Blocked** | It cannot even start. Saving is *refused*, not slow. | Read and edit; not save | Padlock, disabled control + `span.reason` |

The distinction that matters most is **pending vs. in flight**. "In flight" asks
the user to wait. "Pending" asks nothing of them — the work is durable, and
saying so is the whole point. And **blocked vs. in flight**: a padlock means
"you can read, you can't yet save", which is a different promise from a spinner.
`corpus-status-glyph.ts` names this explicitly — `writeLocked` exists so that
"saving is REFUSED, not merely slow" is visible at a glance.

The app's own save pill is the worked counter-example. `_saveStatus` is derived
from `hasDurableBulkIntent` (`card-web-app.ts:758`) — a durable intent persisted
*before* the first attempt, which survives reload. That is **pending**. It is
presented as in flight ("Saving card…", the gerund idiom that asks you to wait),
and `_unsafeExitReason` then arms a `beforeunload` prompt (`:140-144`). So the
app blocks tab-close over work whose entire design point is that closing the tab
is safe. Getting this distinction wrong costs the user something real.

Credit where due: **blocked is the app's strongest area.** `writeLocked`,
`blockedReason()` and the `span.reason` wrappers mean a refused save is
consistently rendered as refused, never as slow. That pattern is the model.

#### 3.6.1 The durability promise — MUST

When a user acts on something that writes, the app applies it **locally and
immediately**, queues it durably, and reconciles when the server echoes it.
Stars, reads, comments, card creations and card saves all work this way.

This means the UI's job is not "block until confirmed". It is:

1. **Apply optimistically.** The star fills now. Do not spin.
2. **Show that it is not yet confirmed** — amber, per §3.6.2. Do not show an
   error; nothing is wrong.
3. **Say the promise out loud when the user might doubt it.** The canonical
   phrasing already exists: *"That card is saved and will be created
   automatically when the connection recovers. Nothing is lost."*

   **Use the system's own three names.** `AuxWriteOutcome` is already
   `'committed' | 'queued' | 'discarded'` (`src/aux-write-queue.ts:785`), and
   that structure never reaches the user — #758 documents *five* different prose
   phrasings all reconstructing the same enum. Say which one happened:
   **committed** (done and visible), **queued** (durably saved, will land on its
   own — never lead with a failure verb), **discarded** (not saved, will not
   retry). Only `discarded` is bad news, and it is the one users are currently
   least equipped to distinguish.
4. **Escalate only when the promise breaks** — a write that has failed
   repeatedly, or been discarded, is a persistent error banner, not a snackbar.

Never make a user wait for a round trip to see their own action reflected. Never
report a queued write as a failure.

#### 3.6.2 The tone ladder — MUST

`src/corpus-status-glyph.ts` defines five tones with a **strict override
precedence**. This is the app's status vocabulary; use these meanings and this
precedence anywhere status is shown, not just in the corpus indicator.

| Tone | Means | Color |
|---|---|---|
| `problem` | Degraded, interrupted, wedged | `--app-warning-color` |
| `pending` | Local changes not yet server-confirmed | `--app-pending-color` |
| `working` | Actively fetching or verifying — **pulses** | `--app-primary-color-light` |
| `ok` | Live, nothing pending | `--app-secondary-color` |
| `muted` | Deliberately not syncing | `--app-dark-text-color-light` |

Precedence: **`problem` beats everything; `pending` beats `working` and `ok`**
(the pulse survives when both apply). A state that is both "fetching" and "has
unconfirmed writes" reads as pending, because that is the fact the user needs.

**Work in flight is amber everywhere.** `--app-pending-color` is the token for
exactly this meaning, and the comment at `card-web-app.ts:352` records why it was
unified: the save pill used teal while the corpus indicator used amber, so the
same state was two colors in the same app, often on screen simultaneously.

**A paused save stays amber, not red.** It is recoverable, not destructive. Full
warning red belongs to the Stop control alone (§3.7).

**Amber means exactly one thing: not yet server-confirmed.** It had drifted to
two other uses in `card-drawer`, and those two were not even the same as each
other. They are separated as follows:

- `.failure` ("this collection couldn't be computed") **is** a problem, scoped to
  one surface. It takes `--app-warning-color`, per the ladder. The reassurance
  that the corpus is fine and nothing was lost belongs in the **copy** — that is
  what §2.4 part 3 is for — not in a softened color. A color cannot say "nothing
  was lost"; a sentence can.
- `.diagnostic` ("we understood your URL differently than you wrote it") is not a
  problem at all. Nothing failed; the app made a substitution and proceeded. It
  is an informational note and takes `--app-dark-text-color-light`.

This abandons the deliberate "same amber family" symmetry at
`card-drawer.ts:242-244`, knowingly: the symmetry was pairing two states that
differ in whether anything went wrong, which is the distinction that matters
most to a reader.

#### 3.6.3 Progress surfaces — MUST

Any operation that can exceed ~1 second uses `progress-panel.ts`. It provides a
heading, a determinate-or-indeterminate bar, an honest count, and a `<details>`
disclosure.

A progress surface MUST say **what** is happening and, when the total is known,
**how far along** it is. A bare translucent scrim is not a progress indicator —
`suggestions-viewer.ts` still ships one, which is the exact defect
`progress-panel.ts` was written to fix.

- **Progress always describes the current phase**, and the phase is
  distinguishable. The status ring reports the fetched fraction while
  downloading and the completed-checks fraction while verifying, with a
  different band color for each, so a stalled bar can be told from a finished
  one.
- **Counts are compact and honest**: `812`, `40.2k`, `12.4k↑` when the total is
  unknown, `12.4k/40.2k` when it is known. Never invent a denominator.
- **Unconfirmed local changes get a count, not just a color** — the superscript
  `·2` badge. "Something is pending" is much less useful than "two things are".
- **Gerund + ellipsis** for the label (§2.3).

#### 3.6.4 Announcing state — MUST

- Ambient status and progress: `role='status'` + `aria-live='polite'`.
- Something the user must act on: `role='alert'`. Reserve
  `aria-live='assertive'` for work at risk — the unsaved-draft banner is the
  bar.
- A surface that is already an `alertdialog` does not need either.
- Use `aria-busy` on a region while its content is being replaced.
- The reason a thing is paused or blocked is **visible text**, not only a
  `title` — hover-only is unreachable on touch.

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

The precedent was the save pill's Stop button, for a long time the app's only
warning-colored control. It is now `button.small.destructive` in
`ButtonSharedStyles`, and Stop uses it like anything else.

Today the tiers are inverted in places: resolving a thread and accepting a
suggestion are not recoverable and are not confirmed.

**Correction, since this document got one wrong.** §3.7 used to cite fork as the
inversion — confirmed despite being recoverable. It is NOT recoverable.
`createForkedCard` copies the section and the tags, and
`getReasonUserMayNotDeleteCard` refuses to delete a card that has either, with
`deleteCard` answering that refusal by `console.warn`-ing and returning. So
"just delete the fork" means unset the section, remove every tag, then delete,
with nothing on screen explaining why until you have. Fork is Tier 1. A confirm
was removed on the strength of the wrong classification and had to be restored.

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
| **Destructive** | `button.small.destructive` — warning-color glyph | Tier 1 acts only (§3.7) |
| **Text button** | `button` | Banners and gates, where a verb is clearer than a glyph |

**These are the only variants.** A surface needing something else should extend
`ButtonSharedStyles`, not hand-roll a local button system — `corpus-ownership-gate`
currently defines its own, including a `.secondary` outline variant that exists
nowhere else.

The destructive variant is deliberately narrow. It exists for §3.7 Tier 1 acts
only; putting it on a reversible-until-Save removal is what teaches people to
stop reading the red ones. It was generalized from the save pill's Stop control,
which was for a long time the app's only visually distinct destructive control.

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
| `--app-pending-color` (amber) | Not yet on the server; a paused but recoverable operation |
| `--app-dark-text-color` | Body text; a subtle icon |
| `--app-dark-text-color-light` | Subordinate, or disabled |

Status uses the five-tone ladder and its override precedence — see §3.6.2.

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
| Persistent failure | The error banner — `reportPersistentError()`, rendered in `card-web-app.ts`'s `.banners` stack |
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

**Missing primitives** — build these rather than working around them.

| Primitive | For | Issue |
|---|---|---|
| Async modal layer (`confirmDestructive` / `askForInput`) | The seam that lets 31 straight-line call sites migrate once, not twice | #708 |
| Destructive-confirm dialog | §3.7 Tier 1 | #708 |
| Generic input dialog | The 14 migratable `prompt()` sites | #708 |

`alert()`/`confirm()` are **synchronous and re-entrant-safe** — the world cannot
change while one is open. Their replacements are promises and can be raced. Every
migration must therefore re-check its precondition **after** the await, not only
before. `card-web-app.ts:578-586` already documents this hazard for the draft case
and mitigates it by capturing the target id before the modal; that is the pattern.

## 5b. Related issues

This document is the standing reference behind several open issues, not a
replacement for any of them.

| Issue | Relationship |
|---|---|
| #708 | *Make all alerts, confirms, and prompts be in in-app UX.* Specifies the approach §3.4 assumes: indirect behind async methods first, and expect a stack of concurrently-active messages because in-app dialogs do not block. |
| #758 | *Rationalize progress & outcome UX.* The direct precursor to §3.6. Source of the committed/queued/discarded vocabulary and of `progress-panel.ts`. |
| #740 | *Factor out a keyboard-shortcut layer.* Stage 1 shipped as `src/shortcuts.ts`; §3.8's shortcut sheet is stage 2, and user-configurable bindings are stage 3 — do not foreclose it. |
| #660 | *Do a pretty Error dialog.* Overlaps the persistent error banner; decide whether a transient tool error and a durable-write failure are one surface or two. |
| #692 | *Use dialog element.* Native `<dialog>` would supply focus trapping, an `inert` backdrop and Escape for free — three of §3.3's gaps. **Decided:** harden the existing `DialogElement` instead, so all eight current dialogs are fixed at once and there is one code path; #692 stays open as a later migration that can be reviewed on its own. Do not build a second dialog system in the meantime. |
| #381 | *Combine tags/sections.* Would collapse the §1.2 distinction into tags with groups. |
| #722 | *Differentiate not-loaded cards.* Adjacent to §3.6 state 1 but a different problem: data that may never arrive without an explicit fetch, not data that is on its way. |
| #745 | Its issue number is currently rendered in a user-facing tooltip (`find-dialog.ts:247`) — a §1.4 violation. |

---

## 6. Enforcement

**The native-modal ratchet.** The count of `alert(`/`confirm(`/`prompt(` call
sites in `src/` and `shared/` is pinned. It may fall; it may not rise. The
baseline is **51**.

**`src/modal.ts` is the one exception, and it is the reason the rest can fall.**
It is the async seam from #708, and its whole job is to be the single place that
still calls out to the native functions, so every other site can migrate to an
awaitable call *once* rather than twice. Its three calls are scaffolding with a
scheduled demolition date: each one is deleted when its in-app dialog lands. It
is excluded from the pin because counting it would mean the number rises when
the migration starts and falls when it finishes, which is precisely backwards as
a signal.

```bash
grep -rnE "(^|[^a-zA-Z0-9_.])(window\.)?(alert|confirm|prompt)\(" src shared --include="*.ts" \
  | grep -v "^src/modal.ts:" \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*)" | wc -l
```

The command prints **52**, not 51. Exactly one match is a false positive:
`src/components/bulk-import-dialog.ts:173` is a continuation line inside a block
comment that happens to begin with `alert()`. Live call sites: **51**.

**Where the remaining 51 are.** Fifty of them are blocking `confirm()`/`prompt()`
calls, which are paused: they need the in-app dialogs from #708 and they need to
move a whole function at a time, because a save that answers on two different
surfaces in one pass is worse than one that answers modally twice. The fifty-first
is `card_diff.ts:359`, a one-way `alert()` that is only still here because it sits
in the middle of `confirmationsForCardDiff`, five blocking confirms in a row.

Every OTHER one-way `alert()` in the app is gone. That mattered more than the
count: an `alert()` is modal, carries no action, and disappears on dismissal, so
it was the worst available surface for exactly the news it was usually carrying —
a write that failed, was discarded, or is stuck. Those now land on the persistent
banner with a retry where retrying helps, and refusals the user can correct land
on a refused-kind snackbar.

**No file other than `src/modal.ts` may gain one.** If you find yourself wanting
a second exception, the thing you actually want is to route through the seam.

This is currently enforced **by review, not by a test**: run the command, subtract
the one known false positive, compare against the number above. When you remove
sites, lower the pin in this document in the same commit. If this ever becomes a
test, strip comments before matching — the idiom already exists in
`test/util/scrollbar-convention.test.js`.

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
| D2 | 51 native modals, all but one of them blocking `confirm()`/`prompt()`; save can fire 7 sequential confirms; merge conflict is a `confirm()` loop, one per field | §3.4 |
| D3 | ~~`alert(err)` on a raw `Error` is the default save-failure UI~~ — **done**: `modifyCardFailure` reports to the error banner | §2.4 |
| D4 | **Closed.** Every icon-only control has an accessible name (was 32) and a hover name (was 14). Both budgets ratcheted at **0** by `test/accessible-names`, so this is now an invariant rather than a shrinking debt | §2.5 |
| D5 | Destructive controls are visually identical to safe ones; the tiers are inverted in places | §3.7 |
| D6 | ~~No dialog traps focus or sets `role`/`aria-modal`~~ — **mostly done**: `DialogElement` sets `role`, `aria-modal` and `aria-labelledby`, and traps focus with sentinels plus a walk that descends into shadow roots. The backdrop is still not `inert`, so background content stays reachable by screen-reader virtual cursor; #692 (native `<dialog>`) would supply that | §3.3 |
| D7 | **Partly done.** A survey found **129** console-only refusals, not ~15 — but most are invariant guards a user cannot reach, and migrating those would be noise. The rule now applied: a refusal reachable by a **keyboard shortcut** must speak, because a shortcut has no disabled state to read; one behind an already-disabled control, a cancelled prompt, or a programming-error guard must not. Done for the six per-user controls, tag creation, card creation, forking and edit-entry, pinned in both directions by `test/shortcut-refusals` | §3.5 |
| D8 | `progress-panel` used by 2 of 11 long-running surfaces | §3.6 |
| D14 | ~~19 shortcuts with zero discoverability~~ — **done**: the shortcut sheet renders the registry | §3.8 |
| D23 | ~~Eight loading idioms~~ — **partly done**: `loading-placeholder` exists and six sites migrated; `card-drawer`'s dim/pin and `card-renderer`'s boot placeholder remain | §3.6 |
| D9 | "Compendium" hardcoded in 18 strings plus `manifest.json`; `APP_TITLE` is config. **Deferred by owner decision:** the fix needs `APP_TITLE` inside `sync-copy.ts` and `corpus-status-glyph.ts`, both deliberately import-free — the latter so its layered-meaning contract stays Node-testable. Threading it as a parameter touches every caller; importing the generated config breaks that test harness. Only affects other deployments of this app | §1.4 |
| D10 | ~~`chat-view.ts` uses three undefined tokens and renders blue~~ — **done**: all three replaced with the existing purple family, and every `var()` fallback in the file removed. Ratcheted by `test/design-tokens`, which asserts no component names a token defined nowhere | §4.1 |
| D11 | Tag/label, sign in/log in, suggested/missing concepts split | §1.4 |
| D12 | 31 font sizes, 12 shadows, 11 radii, 8 translucent-whites | §4.1, §4.3, §4.4 |
| D13 | Title Case and sentence case alternate within one control group | §2.1 |
| D15 | **Partly done**: `(#745)` is out of the find-dialog tooltip, and no user-facing string in `src/components` now contains an issue number. Raw enum keys, "card finisher" and the DevTools instructions remain | §1.4, §2.4 |
| D16 | ~~Typos in shipping copy~~ — **done** in `b3667434` and `f1aa9c89`; verified absent from `src/` and `shared/` | §2 |
| D17 | Shareable-looking URLs that don't reproduce; `canonicalizeURL` erases the collection | §1.3 |
| D18 | `viewMode` is in every collection URL with no UI to set it | §1.3 |
| D19 | ~~Tag creation fails silently through **eight** paths~~ — **done**, with a correction to the count: **six** of the eight are reachable from the UI. Both callers already return before dispatching when the name or display name is empty, so those two fire only from code — and by the shortcut rule they would be exempt anyway, being the cancelled-prompt case one layer up. A ninth problem was found in the fixing: `reservedCollectionName` conflates "reserved" with "not loaded yet", so the first message told the user a name was taken when it was very likely free | §3.5 |
| D20 | `.small` hit target is 18px against 48 usages | §4.2 |
| D21 | `card-drawer.ts:237` and `:245` still use amber for two non-pending meanings; §3.6.2 now resolves this — `.failure` to warning, `.diagnostic` to subordinate grey | §3.6.2 |
| D22 | The tone ladder, the durability promise and the phase-aware ring exist only in `corpus-status-glyph.ts`; other status surfaces predate them and don't follow them | §3.6 |
| D24 | ~~`applyOptimistically` silently reverts on failure~~ — **done, but unverified at runtime**: the revert now names the action it undid across all six. No test exercises it: every one of the six awaits `awaitInteractableCollection` first, and the harness has no interactable collection, so the guard refuses before the revert is reached. Needs a seeded collection (see #774) | §3.6.1 |
| D25 | The save pill presents a *pending* state as *in flight*, and arms a `beforeunload` prompt over durable work | §3.6 |
| D26 | Guards for four destructive acts live in components, not actions; two have unguarded paths to the same erasure | §3.7 |
| D27 | `suggestions-viewer` can wedge: a refused apply returns without clearing `pending`, leaving the scrim up until reload | §3.6 |
