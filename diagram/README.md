# Fabrillke - Project Diagrams

All diagrams are [Mermaid](https://mermaid.js.org/) code blocks. They render automatically in GitHub, VS Code
(Markdown preview with the "Markdown Preview Mermaid Support" extension) and the mermaid.live editor.

Built from the requirement docs in `.claude/project requirment documents/` and checked against the actual
migrations, routes and services (as of 2026-10-03).

| # | File | What it explains | Read it when |
| --- | --- | --- | --- |
| 01 | [order-state-machine](01-order-state-machine.md) | Order, payment and shipment statuses and allowed transitions | Touching anything about order or payment status |
| 02 | [system-architecture](02-system-architecture.md) | Frontend, backend layers, Supabase, external services, route groups | Starting out, or deciding where code belongs |
| 03 | [er-diagram](03-er-diagram.md) | All database tables, keys, enums, integrity rules | Writing a migration or query |
| 04 | [checkout-sequence](04-checkout-sequence.md) | Price preview, place order, confirm, cancel | Working on checkout or order handling |
| 05 | [courier-shipment-sequence](05-courier-shipment-sequence.md) | Shipment creation, webhooks, polling, tracking, failures | Working on Pathao, Steadfast or tracking |
| 06 | [rbac](06-rbac.md) | Roles, permission tiers, matrix, decision flow | Adding a protected endpoint or admin menu |
| 07 | [user-flows-sitemap](07-user-flows-sitemap.md) | Storefront and admin pages, customer journey, daily admin routine | Understanding the product from a user's view |
| 08 | [use-cases](08-use-cases.md) | Who can do what, including system actors | Scoping features and permissions |

Suggested reading order for a newcomer: 02, 07, 03, 01, 04, 05, 06, 08.

## Keeping them current

Diagrams describe the code at one point in time. When a migration, status transition or route changes, update the
matching file. If a diagram and `07-order-state-machine.md` disagree, the requirement document wins.
