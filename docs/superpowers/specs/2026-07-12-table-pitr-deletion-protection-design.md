# Table PITR + Deletion Protection — Design

Date: 2026-07-12
Status: Approved (pending spec review)
Scope: `packages/dynamoose`

## Problem

Dynamoose's `Table` supports create-time and update-time management for throughput, indexes, tags, table class, and streams — but not two common production table settings:

- **Point-in-Time Recovery (PITR)** — continuous backups for restore-to-any-second within the retention window.
- **Deletion Protection** — a table-level flag that blocks `DeleteTable` until explicitly disabled.

Users must currently set both out-of-band (console, CLI, IaC), which drifts from the model definition Dynamoose otherwise owns.

Out of scope (explicitly deferred to a follow-up PR): index synchronization improvements, including the modified-same-name-GSI edge case. Index add/delete sync already works today via `update: ["indexes"]`.

## Goals

1. Add a `deletionProtection` table option that applies on create and syncs on update.
2. Add a `pointInTimeRecovery` table option that applies after create and syncs on update.
3. Follow existing Table-option conventions so the surface is consistent and discoverable.
4. Degrade gracefully on DynamoDB Local, which does not support continuous backups.

## API Surface

### `deletionProtection`

- Type: `boolean`. Default: `false`.
- Bare boolean — maps 1:1 to the native DynamoDB `DeletionProtectionEnabled` field. No sub-settings exist, matching other bare-boolean toggles (`create`, `initialize`).

### `pointInTimeRecovery`

- Type: `TablePointInTimeRecoveryOptions` = `{ enabled: boolean }`. Default: `{ enabled: false }`.
- Nested object shape mirrors `streamOptions` (`{ enabled, type }`), per the requested convention. Optional in the interface, present in `defaults.original`, accessed via `options.pointInTimeRecovery?.enabled` and guarded like `streamOptions`.

### `update` integration

Both settings join the opt-in `update` array via new `TableUpdateOptions` enum members:

- `TableUpdateOptions.deletionProtection = "deletionProtection"`
- `TableUpdateOptions.pointInTimeRecovery = "pointInTimeRecovery"`

`update: true` runs all actions (including these two); `update: ["deletionProtection", "pointInTimeRecovery"]` runs only those.

## Behavior

### Create path

| Setting | How applied on create |
|--------|-----------------------|
| `deletionProtection` | Set `DeletionProtectionEnabled` directly in the `CreateTable` request — native support. |
| `pointInTimeRecovery` | **Cannot** be set in `CreateTable`. Applied by a dedicated post-`waitForActive` setup-flow step that calls `updateContinuousBackups`, mirroring the existing Time-To-Live step. |

The PITR setup step is only pushed when `pointInTimeRecovery.enabled` is `true`, OR when `update` is `true`/includes `pointInTimeRecovery` — matching the TTL step's gating in `Table/index.ts` (the block around the existing `updateTimeToLive` push).

### Update path (existing table)

`updateTable` (`Table/utilities.ts`) gets two new diff blocks, each gated on `updateAll || update.includes(<option>)`, following the throughput/tableClass/streams pattern:

- **Deletion protection:** read `DescribeTable` → `Table.DeletionProtectionEnabled`; if it differs from expected, issue `UpdateTable` with `DeletionProtectionEnabled` and `waitForActive`.
- **PITR:** delegate to the shared `updatePointInTimeRecovery(table)` helper (see below).

### Shared helper: `updatePointInTimeRecovery(table)`

Idempotent, used by both the create-time setup step and the update-time block (DRY, same as how streams logic is shared conceptually):

1. `describeContinuousBackups` → `ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus` (`"ENABLED" | "DISABLED"`).
2. Compare to expected `options.pointInTimeRecovery?.enabled`.
3. If different, `updateContinuousBackups` with `PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: expected }`.

Handles both enable and disable.

### DynamoDB Local guard

`updateContinuousBackups`/`describeContinuousBackups` throw `UnknownOperationException` on DynamoDB Local. The PITR helper wraps its AWS calls in try/catch: on that specific exception, log a `console.warn` and skip — identical to the existing tag-update guard in `updateTable`. Deletion protection needs no such guard (supported by current DynamoDB Local).

## Files Changed

1. **`lib/Table/index.ts`**
   - `TableOptions`: add `deletionProtection: boolean;` and `pointInTimeRecovery?: TablePointInTimeRecoveryOptions;`.
   - New exported interface `TablePointInTimeRecoveryOptions { enabled: boolean; }` (beside `TableStreamOptions`).
   - `TableUpdateOptions`: add `deletionProtection` and `pointInTimeRecovery` members.
   - Setup flow: add the PITR post-`waitForActive` step.
   - Doc comment: extend the `update` row's action list, add rows for `deletionProtection` and `pointInTimeRecovery`, and add both to the default-object example.

2. **`lib/Table/defaults.ts`**
   - `original`: add `"deletionProtection": false` and `"pointInTimeRecovery": { "enabled": false }`.

3. **`lib/Table/utilities.ts`**
   - `createTableRequest`: set `object.DeletionProtectionEnabled` when `options.deletionProtection`.
   - New `updatePointInTimeRecovery(table)` helper.
   - `updateTable`: add the deletion-protection diff block and the PITR block.

4. **`lib/aws/ddb/internal.ts`**
   - Two typed overloads: `describeContinuousBackups` and `updateContinuousBackups`.

## Testing

Unit tests in `packages/dynamoose/test/Table.js` (mocked DynamoDB via the existing test harness), mirroring the tags/streams/tableClass test structure:

- **Create:** `deletionProtection: true` → `CreateTable` request carries `DeletionProtectionEnabled: true`. `pointInTimeRecovery.enabled: true` → no PITR field in `CreateTable`, but `updateContinuousBackups` called after active.
- **Update — deletion protection:** current `false`, expected `true` → one `UpdateTable` with `DeletionProtectionEnabled: true`; no-op when already matching.
- **Update — PITR:** current `DISABLED`, expected enabled → `updateContinuousBackups` enable; current `ENABLED`, expected disabled → disable; no-op when already matching.
- **`update` gating:** verify blocks run for `update: true` and for the targeted `update: [...]` arrays, and do not run when excluded.
- **DynamoDB Local guard:** `updateContinuousBackups` throwing `UnknownOperationException` → warn + no throw.
- **Type tests:** extend `test/types` fixtures for the new options.

## Documentation

- Update the Table-options guide page under `docs/` with `deletionProtection` and `pointInTimeRecovery` rows.
- Update the FAQ IAM-permissions list to include `dynamodb:UpdateContinuousBackups` and `dynamodb:DescribeContinuousBackups` (the `internal.ts` comment mandates this for new operations). Deletion protection uses the already-listed `dynamodb:UpdateTable`.
- Add a `PENDING_CHANGELOG.md` entry.
