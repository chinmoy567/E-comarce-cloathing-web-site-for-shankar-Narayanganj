# Bangladesh administrative geography dataset

The authoritative source for internal geography. Read this before changing
`bd-adm-cod-v03.json` or `scripts/seedGeography.ts`.

## Source

| Field | Value |
| --- | --- |
| Dataset | Bangladesh – Subnational Administrative Boundaries (COD-AB), version **03** |
| Origin | **Bangladesh Bureau of Statistics (BBS)** live geoservices |
| Published by | OCHA Field Information Services Section (FISS) / OCHA ROAP |
| Landing page | https://data.humdata.org/dataset/cod-ab-bgd |
| Resource used | `bgd_admin_boundaries.xlsx` (sheets `bgd_admin1`, `bgd_admin2`, `bgd_admin3`) |
| Boundary alignment | BBS updates as of **March 2025** |
| Reviewed for accuracy | **2025-06-01** |
| Licence | CC BY-IGO |
| Retrieved | **2026-09-22** |

### Why this source

- It is the **official government-derived** dataset: boundaries and codes come
  from BBS, the national statistical authority, not from a courier and not from
  a community-maintained repository.
- It carries **stable identifiers** — national P-codes adapted to OCHA standards
  (`BD20` → `BD2003` → `BD20030004`) — so parent/child relationships are
  expressed in the identifier itself and can be re-verified against a later
  release.
- It is **versioned and dated**, so "which geography is loaded" is answerable.
- It is **independent of Pathao and Steadfast** (CLAUDE.md §6), which is the
  architectural requirement: couriers are mapped *onto* this hierarchy, never
  used as its source.

Verified on retrieval: 8 divisions, 64 districts, 507 ADM3 units, zero orphans,
zero duplicate P-codes, and every child's P-code prefixed by its parent's.

## Levels covered — and the one that is not

| Level | Covered | Count |
| --- | --- | --- |
| ADM1 Division | yes | 8 |
| ADM2 District | yes | 64 |
| ADM3 Upazila / Thana | yes | 507 (495 upazilas + 12 city-corporation units) |
| ADM4 Union / Ward | **no** | — |

**Union/Ward is not in this dataset.** The publisher states plainly that
*"ADM4 (Ward level) is not officially confirmed or maintained"*, and BBS
publishes no authoritative machine-readable union/ward geocode list.

`02-customer.md` §2.2 requires a Union/Ward field, so the platform keeps it as
the **validated free-text** field migration 0002 already defined
(`customers.ward_unit_name` with the `UNION`/`WARD` discriminator). It is not
invented as structured data, because CLAUDE.md §1 forbids inventing
requirements or records, and a wrong union list would be worse than none — it
would silently misroute parcels.

`customers.union_ward_id` exists, nullable and unused, so an authoritative
level-4 source can be adopted later without another `ALTER` on a large table.

Community datasets such as `nuhil/bangladesh-geocode` do publish ~4,500 unions.
They were **considered and rejected as authoritative**: they are not government
-maintained and lag redistricting. If one is ever adopted, it must be recorded
here as a distinct, clearly non-authoritative source with its own version.

## Regenerating the dataset file

`bd-adm-cod-v03.json` is generated from the published workbook, not hand-edited.
To take a new upstream release:

1. Download the current `bgd_admin_boundaries.xlsx` from the landing page above.
2. Regenerate the JSON, keeping the `source` block accurate (publisher, version,
   alignment date, retrieval date).
3. Re-verify: counts, no orphans, no duplicate P-codes, prefix nesting.
4. Commit the regenerated file as a reviewable diff, then re-run the seed.

Name the file for the version it carries (`bd-adm-cod-v03.json`) so two
releases never silently occupy one filename.

## Loading it

```bash
npm run migrate          # creates the geography tables (0003)
npm run seed:geography   # loads this dataset — idempotent, safe to re-run
```

The seed upserts on `pcode`, so re-running updates names in place and never
duplicates a row or reassigns a uuid. That matters:
`customers.division_id`/`district_id`/`upazila_id` and every
`courier_location_mappings.geo_id` reference those uuids, so a seed that
recreated rows would orphan them.

The seed verifies final row counts against the dataset inside the transaction
and aborts if they disagree, so a partially-loaded hierarchy can never be
committed.
