# Statement reconciliation workflow

This workflow parses the PDFs under `Statements/Budget Input` and compares them with the original, non-statement Supabase transaction history. Statement dates before or after that per-account history window are imported automatically when the web review queue is seeded. Only dates that overlap the original Supabase history are sent to reconciliation.

## Safety model

- Dry runs and review preparation are read-only.
- Statement rows retain their source filename, period, and page/row reference in the report.
- Account mappings and date policies are explicit review-manifest decisions.
- Existing Plaid, CSV, and manual transactions are never updated or deleted by apply.
- Prior statement imports do not expand the reconciliation window. The window is the first through last non-statement transaction for each mapped account (including approved alias accounts).
- `statements:seed-review` idempotently inserts missing rows outside that window, verifies their stored fields, and omits them from the review queue.
- Inserts use deterministic external transaction IDs and the existing unique provider/external-ID/user constraint.
- Apply is limited to 250 approved rows and should be filtered to one account/month.
- Apply prechecks deterministic external IDs, inserts each scoped batch atomically under the database's existing unique index, and verifies date, amount, description, account, user, and batch source afterward. The project does not enable PostgREST's transaction-end rollback preference, so the workflow does not use `.rollback()` as a dry-run mechanism.
- Every batch emits a self-contained receipt containing the exact inserted IDs and expected field values. Rollback accepts only those IDs and refuses rows that no longer carry the matching statement batch marker.

## Commands

Create a fresh reconciliation:

```powershell
npm run statements:dry-run -- --through=YYYY-MM-DD
```

Generate the durable decision manifest, review CSVs, and account/month batch plan:

```powershell
npm run statements:prepare -- --report=reports/statement-reconciliation/latest/reconciliation.json
```

Edit `review-manifest.json`. Pending account or transaction decisions are never applied. After editing, validate a proposed account/month batch and obtain the current content-derived approval token:

```powershell
npm run statements:review -- --report=reports/statement-reconciliation/latest/reconciliation.json --manifest=reports/statement-reconciliation/latest/review-manifest.json --account=capital_one:checking:3244 --month=2023-01
```

Apply only that approved batch:

```powershell
npm run statements:apply -- --report=reports/statement-reconciliation/latest/reconciliation.json --manifest=reports/statement-reconciliation/latest/review-manifest.json --account=capital_one:checking:3244 --month=2023-01 --approval=<token-from-review>
```

Verify the receipt immediately:

```powershell
npm run statements:verify -- --receipt=<apply-receipt-path>
```

Then rerun the dry run. Successfully inserted rows must move from `missing` to `exact match`, and no new likely duplicates or conflicts may appear before another batch is applied.

Rollback is intentionally destructive and requires a batch-specific approval value:

```powershell
npm run statements:rollback -- --receipt=<apply-receipt-path> --approval=rollback:<batch-id>
```

Rollback deletes only transaction IDs recorded as newly inserted in that receipt and only when their provider and batch source marker still match.
