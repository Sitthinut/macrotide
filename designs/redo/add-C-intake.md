# Add to portfolio — Design C: Intake-first (lowest cognitive load)

**Lens: calm by default, reveal on demand.** The modal opens to a single quiet
intake — *paste, snap a photo, or add a row.* No table, no mode picker, no segment
control. Detection classifies; the user lands on a calm confirmation where every
row's **Type** is already chosen and sits as a quiet control they rarely touch.
Advanced fields (fee, avg cost) stay tucked until needed. The user should almost
never consciously decide "snapshot vs transaction."

---

## 1. The core mechanism

One surface holds both worlds because the **snapshot-vs-transaction distinction
lives in a per-row `Type` field, never as a mode the user picks up front.** Each
review row carries a Type drawn from one vocabulary: **Starting balance** (an
opening anchor → routes as a snapshot) or **Buy / Sell / Dividend / Fee / Split /
Reinvest** (a dated ledger event → routes as a transaction). Auto-detect reads the
intake and sets each Type itself — a dated buy/sell token becomes that trade type;
a bare symbol + quantity becomes a Starting balance. Rows of different Type mix
freely in one save, and the single **Save** posts every row to
`POST /api/transactions`, which routes each by its Type (anchors vs deltas). The
user's only required act is to glance and confirm; Type is a quiet dropdown they
touch only to correct a rare miss.

---

## 2. Desktop — annotated ASCII mockup (review state)

Centered `.modal` (`.modal--form`, narrow 560px — the owner's preferred width;
*not* `--txnwide`). Review uses `.holding`-style rows, not a dense input grid: the
calm default is a **read-out you scan**, with editing revealed on tap (§5).

```
        ╔══════════════════════════════════════════════════════╗
.modal  ║  Add to portfolio                                ✕  ║ .modal-header
--form  ║  3 items ready · review and save                    ║ .modal-subtitle
 560px  ╟──────────────────────────────────────────────────────╢
        ║                                                      ║ .modal-body
        ║  ┌────┐                                              ║
.holding║  │ EX │ EXAMPLE-FUND-A          120 units   ฿24,000 ║  ← Starting balance
 row    ║  └────┘ Starting balance ▾      avg ฿200    quiet   ║    (swatch/name/value)
        ║                                                      ║
.holding║  ┌────┐                                              ║
 row    ║  │ KE │ K-EQUITY                  50 units    ฿9,250 ║  ← Buy
        ║  └────┘ Buy ▾ · 12 Mar 2026     ฿185.00/u   .delta  ║
        ║                                                      ║
.holding║  ┌────┐                                              ║
 row    ║  │ KE │ K-EQUITY                 −20 units    ฿4,000 ║  ← Sell
        ║  └────┘ Sell ▾ · 28 Mar 2026    ฿200.00/u   .delta  ║
        ║                                                      ║
        ║  + add row                              ⌃ paste more ║ .btn.link
        ║                                                      ║
        ║  ░░ 3 starting · 2 events · 1 anchor   .stats-strip ░║  (quiet summary)
        ╟──────────────────────────────────────────────────────╢
        ║                              [ Cancel ]  [ Save 3 ▸ ]║ .modal-footer
        ╚══════════════════════════════════════════════════════╝
                                       .btn.ghost   .btn.primary
```

Annotations:
- **The whole row reads like a holdings row** (`.swatch` / `.name` / `.value`),
  so a snapshot and a trade look like siblings, not different worlds.
- **Type is a quiet `▾` under the name** — `var(--muted)`, no border until
  hovered. It is set, not asked. A Sell shows `−20 units` and routes as a delta.
- **The date only appears for ledger events** (Buy/Sell), inline after Type.
  Starting balance shows `avg ฿200` instead — each Type reveals only its own fields.
- **`.stats-strip`** is a one-line reassurance ("3 starting · 2 events"), not a
  control. Fee / extra columns are hidden (§6).

---

## 3. Mobile — same surface, bottom sheet

Full-bleed `.modal` bottom sheet (slides up, rounded top, `100%` width). **Same
`.holding` rows, same quiet Type `▾`, same footer** — the layout reflows; the
components don't change.

```
┌─────────────────────────────┐
│  ───            (grab handle)│  ← sheet affordance (mobile-only)
│  Add to portfolio        ✕  │ .modal-header
│  3 items · review & save    │ .modal-subtitle
├─────────────────────────────┤
│ ┌──┐ EXAMPLE-FUND-A         │ .holding (stacks:
│ │EX│ 120 units    ฿24,000   │   value drops below
│ └──┘ Starting balance ▾     │   name on narrow)
│      avg ฿200               │  ← extra field on its own line
│ ─────────────────────────── │ .line-soft divider
│ ┌──┐ K-EQUITY               │
│ │KE│ +50 units     ฿9,250   │
│ └──┘ Buy ▾ · 12 Mar         │  ← date abbreviates
│ ─────────────────────────── │
│ ┌──┐ K-EQUITY               │
│ │KE│ −20 units     ฿4,000   │
│ └──┘ Sell ▾ · 28 Mar        │
│                             │
│ + add row                   │ .btn.link.full
├─────────────────────────────┤
│      [ Save 3 items ▸ ]     │ .modal-footer (primary
│        Cancel               │   full-width; Cancel below)
└─────────────────────────────┘
```

**Shared vs platform-specific:**
- *Shared:* every `.holding` row, the Type `▾`, `.sheet-input` editors, the Save
  button, all copy and detection logic.
- *Mobile-only:* grab handle, full-bleed sheet, value reflows under the name,
  footer goes vertical (`.btn.full` primary, Cancel as `.btn.link` beneath).
  `+ paste more` collapses into `+ add row`'s menu to save vertical space.

---

## 4. The intake — paste / image / type, no segment

The modal **opens to one calm intake**, not a table and not a `.method-tabs`
control. A single `.drop-zone` that is also the paste target and the type target:

```
┌─────────────────────────────────────────┐
│  Add to portfolio                    ✕  │
│  Paste, snap a photo, or add a row      │ .modal-subtitle
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  │
│  │            ⌘V / 📷                 │  │ .drop-zone
│  │  Paste holdings or a statement,   │  │  (dz-title)
│  │  drop a screenshot, or add a row  │  │  (dz-sub)
│  └───────────────────────────────────┘  │
│                                         │
│             + add a row manually        │ .btn.link (centered)
├─────────────────────────────────────────┤
│              [ Cancel ]                  │ .modal-footer (no Save yet)
└─────────────────────────────────────────┘
```

- **Three intakes, one box.** Paste (⌘V anywhere in the modal), image (click/drop
  the `.drop-zone`, OCR), or `+ add a row`. These are *how data arrives*, never
  *what kind it is* — there is no Holdings/Activity choice.
- **The table doesn't exist until there's data** (hard progressive disclosure).
  The moment paste/OCR/row produces rows, the intake **collapses to the
  `+ paste more` link** and the review list (§2) animates in with Types already set.
- **Detection runs on arrival.** "EXAMPLE-FUND-A 120" → Starting balance.
  "12/03 BUY K-EQUITY 50 @185" → a Buy. No spinner-gated mode; rows just appear
  pre-classified.

---

## 5. Editing a row & changing its Type

Tapping a row's text expands it **in place** into the native `.ledger-edit` inline
editor — the calm read-out becomes an edit grid only for that one row:

```
┌──┐ K-EQUITY                            ▴ collapse
│KE│ ┌─ Type ──────┐ ┌─ Date ───────┐         .ledger-edit
└──┘ │ Buy       ▾ │ │ 12 Mar 2026  │         (grid of .sheet-input)
     └─────────────┘ └──────────────┘
     ┌─ Units ─┐ ┌─ Price ──┐ ┌─ Amount ──┐
     │   50    │ │ 185.00   │ │  9,250    │
     └─────────┘ └──────────┘ └───────────┘
     ＋ fee · note                        ← .btn.link (advanced, tucked)
```

- **Type is a `<select>` styled as `.sheet-input`.** Its options span both worlds
  in one list — `Starting balance` sits above a divider, then `Buy / Sell /
  Dividend / Fee / Split / Reinvest`. Changing it is the *only* place the two
  worlds are named, and it's one quiet control the user reaches for rarely.
- **Switching Type reshapes the row's fields, not the row's identity.** Pick
  *Starting balance* and Date/Price collapse, `Avg cost` appears; pick *Buy* and
  they return. The `.type-badge` pattern marks an auto-detected Type vs a
  user-overridden one (`border-color: var(--accent)` when overridden).
- **Fee and note stay behind `+ fee · note`** — revealed on demand, never on screen
  by default. Collapse (`▴`) returns the row to its one-line `.holding` form.

---

## 6. Empty / first-run, and cost-unknown

**Empty / first-run** is just the intake (§4) — already the calm empty state, so
there's no separate screen. A muted helper line under the drop-zone shows one
example of each, so a first-timer learns the surface by reading it:

```
│  ┌───────────────────────────────────┐  │
│  │            ⌘V / 📷                 │  │ .drop-zone
│  │  Paste holdings or a statement…   │  │
│  └───────────────────────────────────┘  │
│  e.g.  EXAMPLE-FUND-A  120              │ .dz-sub (var(--muted))
│        12 Mar  BUY  K-EQUITY  50 @185   │
│             + add a row manually        │ .btn.link
```

**Cost-unknown Starting balance** is the common case and must feel complete, not
broken. Avg cost is optional: leave it blank and the row stays valid and saveable.

```
┌──┐ EXAMPLE-FUND-A          120 units    ฿24,000
│EX│ Starting balance ▾      avg cost —    ⚠ unknown
└──┘                         (no value, no error)
```

- Blank avg cost renders `—`, with a single `var(--amber)` note **"cost basis not
  recorded"** (the `.evline-anchor__note` pattern) — informational, not blocking.
- Save stays enabled; the anchor posts with `null` cost. No red, no required-field
  nag — the calm default tolerates the unknown.

---

## 7. Shared-component table

| Component (native class) | Role in this modal | Shared mobile ↔ desktop? |
| --- | --- | --- |
| `.modal` + Header / Body / Footer | Shell (centered desktop / bottom-sheet mobile) | **Shared** structure; mobile adds full-bleed + grab handle |
| `.modal--form` (560px) | Narrow width (owner preference) | **Shared** (mobile = full width) |
| `.drop-zone` | The single intake (paste / image / drop target) | **Shared** |
| `.holding` (`.swatch`/`.name`/`.sub`/`.value`) | Each calm review row | **Shared**; value reflows under name on mobile |
| `.ledger-edit` | In-place row editor (revealed on tap) | **Shared** |
| `.sheet-input` | Every field, incl. the Type `<select>` | **Shared** |
| `.type-badge` | Auto-detected vs overridden Type marker | **Shared** |
| `.evline-anchor__note` (`var(--amber)`) | "cost basis not recorded" | **Shared** |
| `.stats-strip` | Quiet "3 starting · 2 events" reassurance | **Shared** |
| `.btn.primary` / `.btn.ghost` / `.btn.link` | Save / Cancel / "+ add row", "+ paste more" | **Shared**; footer stacks vertical on mobile |
| `.delta.up` / `.delta.down` | Buy/Sell amount tint | **Shared** |
| Grab handle, full-bleed sheet | Sheet affordance | **Mobile-only** |

Detection, Type vocabulary, validation, and the single `POST /api/transactions`
save are **100% shared** — only the modal frame and footer orientation differ.

---

## 8. Cognitive-load tactics

1. **One intake, zero mode choice.** The first decision ("snapshot vs
   transaction") is *deleted*, not relocated — detection assigns Type per row, so
   the user never picks a world. Paste/image/row are framed as *how data arrives*.
2. **Hard progressive disclosure.** No table until there's data; no Save until
   there are rows; no fee/note/avg-cost fields until a row is expanded or a Type
   needs them. The screen only ever shows the next thing.
3. **Type is set, not asked — and quiet.** It renders as muted text with a `▾`,
   not a labelled control, signalling "already handled, touch only to correct."
   The two-world vocabulary surfaces in exactly one place: that one dropdown.
4. **Tolerant defaults.** Unknown avg cost is fine (amber note, never a blocker);
   the row stays saveable. Calm by default means the modal never nags — it accepts
   what you give it and lets you reveal more only when you want to.
