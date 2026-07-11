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

- Type: `TablePointInTimeRecoveryOptions` = `{ enabled: boolean; recoveryPeriodInDays?: number }`. Default: `{ enabled: false }`.
- Nested object shape mirrors `streamOptions` (`{ enabled, type }`), per the requested convention. Optional in the interface, present in `defaults.original`, accessed via `options.pointInTimeRecovery?.enabled` and guarded like `streamOptions`.
- `recoveryPeriodInDays` (optional, integer 1–35) sets the PITR retention window. Meaningful only when `enabled` is `true`; omitted → AWS default of 35 days. Validated on construction — throws `InvalidParameter` if provided and outside the integer range 1–35.

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

The PITR setup step is pushed when the `update` array **explicitly includes** `pointInTimeRecovery`, OR when `pointInTimeRecovery.enabled` is `true` and create/update is engaged (`options.create` is `true` or `update === true`). This mirrors the TTL step's `&& options.expires` opt-in gate in `Table/index.ts` (around the existing `updateTimeToLive` push): a bare `update: true` on a table that never engaged PITR does **not** trigger a `describeContinuousBackups` call, preserving backward compatibility and avoiding a surprise API dependency for existing `update: true` users. Consequence: **disabling** PITR requires the explicit `update: ["pointInTimeRecovery"]` form — a bare `update: true` with `enabled: false` is treated as "not engaged".

It is the single place PITR is reconciled — there is deliberately **no** PITR block in `updateTable`, because PITR uses the sidecar `updateContinuousBackups` API rather than `UpdateTable`, exactly as TTL uses `updateTimeToLive`. The step is inserted after the TTL step and before the `updateTable` push (it needs an ACTIVE table for `describeContinuousBackups`, which the preceding `waitForActive` step guarantees).

### Update path (existing table)

`updateTable` (`Table/utilities.ts`) gets one new diff block, gated on `updateAll || update.includes(TableUpdateOptions.deletionProtection)`, following the throughput/tableClass/streams pattern:

- **Deletion protection:** read `DescribeTable` → `Table.DeletionProtectionEnabled`; if it differs from expected, issue `UpdateTable` with `DeletionProtectionEnabled` and `waitForActive`.

PITR is **not** reconciled here — it is handled entirely by the dedicated setup-flow step calling `updatePointInTimeRecovery(table)` (see Create path and Shared helper), mirroring how TTL lives outside `updateTable`.

### Shared helper: `updatePointInTimeRecovery(table)`

Idempotent, used by both the create-time setup step and the update-time block (DRY, same as how streams logic is shared conceptually):

1. `describeContinuousBackups` → `ContinuousBackupsDescription.PointInTimeRecoveryDescription` for current status (`PointInTimeRecoveryStatus`, `"ENABLED" | "DISABLED"`) and current `RecoveryPeriodInDays`.
2. Compare to expected `options.pointInTimeRecovery?.enabled` and `recoveryPeriodInDays`.
3. Update when the enabled-state differs, OR when enabling and an explicit `recoveryPeriodInDays` differs from the current value. Call `updateContinuousBackups` with `PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: expected }`, adding `RecoveryPeriodInDays` only when enabling and a value is set.

Handles enable, disable, and retention-window change.

### DynamoDB Local guard

`updateContinuousBackups`/`describeContinuousBackups` throw `UnknownOperationException` on DynamoDB Local. The PITR helper wraps its AWS calls in try/catch: on that specific exception, log a `console.warn` and skip — identical to the existing tag-update guard in `updateTable`. Deletion protection needs no such guard (supported by current DynamoDB Local).

## Files Changed

1. **`lib/Table/index.ts`**
   - `TableOptions`: add `deletionProtection: boolean;` and `pointInTimeRecovery?: TablePointInTimeRecoveryOptions;`.
   - New exported interface `TablePointInTimeRecoveryOptions { enabled: boolean; recoveryPeriodInDays?: number; }` (beside `TableStreamOptions`).
   - Constructor validation: reject `pointInTimeRecovery.recoveryPeriodInDays` when provided and not an integer in 1–35, throwing `CustomError.InvalidParameter` (alongside the existing hashKey/rangeKey validation).
   - `TableUpdateOptions`: add `deletionProtection` and `pointInTimeRecovery` members.
   - Setup flow: add the PITR post-`waitForActive` step.
   - Doc comment: extend the `update` row's action list, add rows for `deletionProtection` and `pointInTimeRecovery`, and add both to the default-object example.

2. **`lib/Table/defaults.ts`**
   - `original`: add `"deletionProtection": false` and `"pointInTimeRecovery": { "enabled": false }`.

3. **`lib/Table/utilities.ts`**
   - `createTableRequest`: set `object.DeletionProtectionEnabled` when `options.deletionProtection`.
   - New `updatePointInTimeRecovery(table)` helper.
   - `updateTable`: add the deletion-protection diff block only (no PITR block — PITR runs via the setup step).

4. **`lib/aws/ddb/internal.ts`**
   - Two typed overloads: `describeContinuousBackups` and `updateContinuousBackups`.

## Testing

Unit tests in `packages/dynamoose/test/Table.js` (mocked DynamoDB via the existing test harness), mirroring the tags/streams/tableClass test structure:

- **Create:** `deletionProtection: true` → `CreateTable` request carries `DeletionProtectionEnabled: true`. `pointInTimeRecovery.enabled: true` → no PITR field in `CreateTable`, but `updateContinuousBackups` called after active.
- **Update — deletion protection:** current `false`, expected `true` → one `UpdateTable` with `DeletionProtectionEnabled: true`; no-op when already matching.
- **Update — PITR:** current `DISABLED`, expected enabled → `updateContinuousBackups` enable (via `update: true` or `update: ["pointInTimeRecovery"]`); current `ENABLED`, expected disabled → disable (only via the explicit `update: ["pointInTimeRecovery"]` form); no-op when already matching; a bare `update: true` with default/`enabled: false` PITR is not engaged (no `describeContinuousBackups` call). Recovery period: enable carries `RecoveryPeriodInDays` when set; changing the period on an already-enabled table issues an update; a matching period is a no-op; an invalid period (0, 36, non-integer) throws `InvalidParameter` at construction.
- **`update` gating:** verify blocks run for `update: true` and for the targeted `update: [...]` arrays, and do not run when excluded.
- **DynamoDB Local guard:** `updateContinuousBackups` throwing `UnknownOperationException` → warn + no throw.
- **Type tests:** extend `test/types` fixtures for the new options.

## Documentation

- Update the Table-options guide page under `docs/` with `deletionProtection` and `pointInTimeRecovery` rows.
- Update the FAQ IAM-permissions list to include `dynamodb:UpdateContinuousBackups` and `dynamodb:DescribeContinuousBackups` (the `internal.ts` comment mandates this for new operations). Deletion protection uses the already-listed `dynamodb:UpdateTable`.
- Add a `PENDING_CHANGELOG.md` entry.
