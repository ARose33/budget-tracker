# StackMint v2 rollout preflight — September 11, 2026

## Current status: database-password blocker resolved

The official Supabase CLI browser login succeeded using the user's existing Google-authenticated dashboard session. CLI 2.117.0 can obtain its own short-lived database login role; the existing database password is not required. Do not ask the user for that password again or reset it. A read-only connection query succeeded. The CLI-created administrative login role is a real access-management side effect; no financial records, application schema, existing credentials, or paid resources were changed.

The free official PostgreSQL 17.11 Windows tools produced a native custom-format database archive with 99 TABLE DATA entries. The protected recovery directory is `%LOCALAPPDATA%/StackMint-Recovery/backup-20260911T204516Z-03199106`, outside OneDrive and Git. Seven encrypted artifacts cover the database (including Auth and archive schemas), role definitions without role passwords, Storage inventory and the one object's bytes, existing application environment, project root encryption key, and remote configuration. Every artifact was independently decrypted in memory and matched its recorded SHA-256 checksum. The private directory has inherited access disabled and one user-only access rule. No private contents were printed.

The export initially stopped at remote configuration because a local CLI configuration was missing. Initializing that configuration locally and repeating the read-only export completed the bundle. Its status is `exported-not-restored`, with `RestoreVerified: false`. Encryption/checksum verification is not a restore drill, and this earlier checkpoint does not replace a fresh coordinated rollout checkpoint.

Supabase quoted **$0/month** for a new project in the existing Rose Residences organization on September 11. The user has been asked to choose that organization for the temporary restore test; the answer is still pending. No project was created and no costs were confirmed or activated. Do not reuse the unrelated inactive project. The source project is unchanged, proposals 01–11 are not applied, and nothing has been pushed to `origin/main`.

The earlier password-prompt notes below are historical and superseded. Resume with the authorized CLI connection, isolated restore/diff checks, and coordinated schema/application rollout—not another password request. General rollout authorization and the $0 constraint remain in force.

### Recovery tooling

`scripts/backup-stackmint.ps1` uses the official CLI's temporary connection, native `pg_dump`/`pg_dumpall`, read-only Storage downloads, and configuration/key exports. `scripts/recovery-common.ps1` captures process output without printing private values and encrypts each export with Windows user-bound DPAPI before removing its plaintext copy. The scripts do not run migrations or create paid resources. Temporary CLI metadata is excluded from Git. PowerShell parsing and whitespace checks passed; the actual export and all seven artifact checksum checks succeeded. Restoration and hosted compatibility remain unverified.

## Earlier preflight findings

The user approved proceeding with backup/staging preparation and is ready for a maintenance pause and rollout. That authorization remains in effect. Recovery verification and the exact shared-database compatibility checks remain prerequisites; readiness for a pause does not establish that a backup is restorable.

**User constraint: $0 additional cost.** Backup, staging, validation and rollout must use local or verified free resources within their free allowances. Do not purchase or activate paid plans, projects, branches, compute, add-ons, trials that convert to paid billing, or billable provider/model usage. General rollout approval does not authorize spending. The earlier Pro quote is informational only and that route is excluded. If recovery cannot be verified within this constraint, leave production unchanged and report the specific blocker; do not weaken recovery checks or infer permission to spend.

No production pause, schema/data change, credential change, account disconnection, provider call, paid resource creation, merge or push was performed during this preflight.

## Verified remotely, read-only

- The configured source URL matches the connected project. Its organization is on the Free plan; the project is healthy on PostgreSQL 17.6. There are no development branches. The other listed project is inactive and was not repurposed.
- The shared database has 33 public tables, all with RLS enabled, plus two archive schemas containing 22 tables. Database/Auth/Storage/Vault and the complete migration ledger are in the recovery boundary. This inventory is not a backup.
- One external foreign key connects the wealth-management account table to legacy `plaid_items`. Proposal 01 changes lifecycle protection and browser grants on that shared object. The other application's callers must be checked before rollout; a database-wide pause would affect more than StackMint.
- One database cron job is active. Its schedule is monthly; its command was not exposed. The limited metadata check found no direct mention of the selected StackMint tables or HTTP calls, but indirect function dependencies remain unverified. Do not disable unrelated jobs by assumption.
- Storage has two buckets and one object. Object names, contents and user identifiers were not returned. Actual file bytes still need protected export and restore verification.
- GitHub `main` remains at baseline `7097b80b518a52f935f1327b8976de83556716e6`; the account has repository push permission. GitHub reports a successful Vercel deployment status for that SHA, dated September 8. This does not prove the current production alias or branch setting. GitHub's default branch remains `master`; deployment instructions still target `main`.
- The 13 historical local migration files and `vercel.json` remain unchanged from baseline. No v2 proposal was applied to the existing project.

## Access and recovery blockers

The Supabase connector can inspect the database but does not expose backup export or restore-to-new-project operations. The application environment contains API credentials, not a PostgreSQL backup connection or Management API token. Only key names and a source-URL match were inspected; no credential value was logged or copied into this worktree.

Both the in-app browser and connected Chrome reached Supabase's sign-in screen. A Chrome tab is left open for the user to sign in. Dashboard access is needed to inspect available recovery controls and connection options. Do not reset the database password, extract a browser session token, or change project settings to work around missing access.

Follow-up: the user signed in successfully in Chrome. The actual backup page confirms that this Free project has no included project backups. The subscription dialog quotes Pro **from $25/month**; that is not a complete staging-resource quote and no upgrade was selected or purchased. The staging organization question is pending. The current manual-export path still needs the existing PostgreSQL password, which is separate from dashboard authentication; no reset is authorized or needed if that password is available.

`scripts/set-recovery-access.ps1` provides an interactive local password prompt and saves a Windows-user-encrypted credential under `%LOCALAPPDATA%/StackMint-Recovery`, with access restricted to that Windows user. It never connects to a service, changes credentials, or performs a backup. It prints only the saved file path. Run it with the source project reference from the dashboard; do not send the password or encrypted file in chat. This helper does not establish that the supplied password works or that a recovery point exists.

At the user's request, the helper now also supports `-PromptWindow`: a local masked input dialog with Save and Cancel. It was launched using the installed PowerShell runtime with a hidden console; its process is responding and its error log is empty while awaiting input. The first launch with legacy Windows PowerShell was blocked by its script execution policy. The retry used the existing PowerShell runtime and its existing policy; no execution policy was changed. No saved credential was present at the launch check. Syntax and whitespace checks passed for the dialog addition; password entry and saving remain user-dependent.

Helper validation: PowerShell syntax parsing passed. A synthetic PSCredential encryption/decryption round trip passed under the normal Windows user profile, with an assertion that the serialized value did not contain the plaintext synthetic password. The sandbox profile could not use DPAPI, so that initial attempt was not successful verification; the successful check ran outside the sandbox with only the synthetic value. The interactive prompt and private-directory creation await user execution. No real password has been read or stored by this helper yet.

A read-only source check of the separate local Wealth Manager project found a different account/item contract and no `wm_accounts`, `pwm_accounts`, or Supabase references in the inspected application directories. This does not identify the deployed consumer of the shared legacy relationship. Its existing uncommitted work was left untouched.

Supabase documents automatic daily backups for paid plans and recommends manual exports for Free projects. The managed restore-to-new-project feature also requires a paid plan. No upgrade is assumed or authorized by this finding. A manual protected backup and separate test environment are an alternative, subject to usable database access and an identified destination. Any required paid resource must have its actual price reviewed before creation. See [database backups](https://supabase.com/docs/guides/platform/backups) and [restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

Database backups do not contain Storage object bytes. The recovery procedure must separately preserve those bytes and relevant configuration. Restoring a database snapshot alone does not satisfy the approved recovery requirement.

## Remaining execution order

Release checks were rerun September 10: `npm run lint` and `npm run build` both exited 0; Next generated 29 routes. They ran through the reviewed isolated environment with synthetic configuration and the outbound network guard inherited by child processes. No application environment file was loaded. The unchanged candidate's 58-test result is recorded in the release notes; the suite was not rerun as part of this metadata-only preflight.

1. Obtain dashboard/backup access and identify an isolated restore destination. Keep real exports encrypted outside Git and the synchronized project directory. Capture the complete shared database, Auth records, file bytes, and required configuration/secret references without printing them.
2. Restore only to the identified new environment, with external email/provider/webhook/job activity blocked. Compare record identities, relationships, field values, file hashes, and frozen financial totals. Preserve archived and unrelated application data as well as StackMint's seven tables.
3. Apply proposals 01–11 in order to that restored environment. Verify original field values remain unchanged, hosted Auth/REST/Storage behavior, concurrent edits, shared callers, and a compatible application rollback. The synthetic fixture results remain useful but are not proof of these hosted contracts.
4. Prepare the precise StackMint write/sync pause and resume procedure. Old direct browser writes and old note-storage writers must stop; an application banner alone cannot enforce this. Avoid pausing unrelated shared-database consumers. Do not start a maintenance window while access/recovery work is blocked.
5. With verified recovery and the reviewed operation scope, take the fresh rollout checkpoint, execute the coordinated schema/application release, and preserve post-launch writes on rollback. Follow AGENTS.md for code release: lint/build, commit, push `origin/main`, then stop; do not use Vercel tools.

The release notes and compatible rollback requirements remain in [the release candidate](stackmint-v2-release-candidate.md). This preflight records newly verified facts and unresolved prerequisites, not completed backup/staging evidence.
