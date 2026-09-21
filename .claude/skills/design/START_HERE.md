# Design Skill — Index

The design system for this platform is consolidated into a single file.

## Files in this folder

| File | Purpose |
|------|---------|
| **SKILL.md** | The design system. Page layouts, components, colours, typography, spacing, breakpoints, accessibility. Read this before building or restyling anything. |
| **language-config.json** | Colour/spacing/breakpoint tokens, currency, date and phone formats, and UI strings. |
| **SCREEN-INVENTORY.md** | The list of screens in scope, by surface. Scope only, not behaviour. |

## Where things live

- **How a page should look** → `SKILL.md`
- **What a page must do** → `.claude/project requirment documents/`
- **Which screens exist** → `SCREEN-INVENTORY.md`

Behaviour is owned by the requirement documents. Where a visual spec here appears to
contradict them, the requirement documents win; see `.claude/CLAUDE.md` section 1.

## Non-negotiables

These are stated in full at the top of `SKILL.md`:

1. **Mobile-first** — design at 375px, then scale up.
2. **English-only UI** — all navigation, buttons, forms, labels and messages.
3. **Professional, not decorative** — no unnecessary gradients, effects or animation.
4. **Real e-commerce UX** — prioritise product discovery and checkout completion.
5. **Bangladesh-focused** — bKash/COD, Pathao/Steadfast, local address formats.

## Palette

The authoritative values are at `SKILL.md` "Color Palette" and in `language-config.json`:

- Primary action (red) `#DC143C`
- Secondary (dark gray) `#1F2937`
- Accent (emerald) `#059669`
- Success `#10B981` · Warning `#F59E0B` · Error `#DC2626`
- Text `#111827` · Background `#FFFFFF` · Border `#E5E7EB`

Do not introduce colours outside this set.
