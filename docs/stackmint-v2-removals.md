# Verified v2 code removals

Baseline: 7097b80b518a52f935f1327b8976de83556716e6. No database object, migration, record, Storage object, account identifier or historical period was deleted.

| Removed code | Evidence and replacement | Preserved history |
| --- | --- | --- |
| BudgetEditDialog, BudgetGroupCard, BudgetLineItemRow, BudgetSummaryCard | The unified Budget route uses CategoryDialog, BudgetAmount, CategoryGroup and the canonical financial read. Full source/script/config searches found only the old components' internal references, no route, dynamic import, feature flag, cron or webhook consumer. The old group → row chain had no external entry. | Same category/month budget IDs; previous edits journaled under proposed preservation controls. |
| AddAccountDialog; its createAccount chain; unused balance/visibility mutations | Prior Git review confirms manual account controls were retired. Rechecked all source and operator entry points: only the unused dialog called createAccount; the other helpers had no callers. | Existing accounts, hidden accounts, balances and opening values are accessible through Accounts; transactions remain searchable. |
| groupCategories and findDuplicates wrapper | Each was referenced only by its definition. Active category grouping uses groupBudgetItems. Duplicate handling remains in explicit provider/reconciliation review and the verified-distinct transaction command. | Existing duplicate flags, source identities and old SQL functions remain. |
| @tanstack/react-table and its unused table-core dependency | No import, dynamic load, route, script, build or job uses the package; Transactions uses its existing native table. Removed through npm with scripts/audit/network disabled. | No data impact. |
| Five Next starter SVGs | No asset reference in source, scripts, metadata, manifest, config or docs. Application icons remain. | No financial data involved. |
| Unused project @playwright/test development package | Full source/script/test search found no import or consumer. Browser checks used the Codex in-app browser. Removed the unused test runner package through offline npm; Next's optional Playwright dependency remains managed by its own manifest. | No data impact; the 58 synthetic tests remain enabled. |

Earlier behavior commits also removed the obsolete Plan/Activity rendering, client-side capped split-filter assembly, old note modal, competing report queries and direct deletion helper. Their active workflows were replaced by the unified Budget, SQL transaction filters, shared editor, preserved note versions and Archive/Restore. They are behavior replacements, not feature retirement.

Uncertain HTTP endpoints, CLI/import/merge tools, generated shared-database type families, historical SQL definitions and all 13 applied migration files are retained. Old unsafe write RPCs are proposed to lose execution privileges after old-client quiescence; their definitions and applied history are retained. No assumption is made about unknown external callers.
