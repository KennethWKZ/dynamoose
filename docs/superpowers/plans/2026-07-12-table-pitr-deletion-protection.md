# Table PITR + Deletion Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `deletionProtection` and `pointInTimeRecovery` (with recovery-period) options to Dynamoose's `Table`, applied on create and reconciled on update.

**Architecture:** Deletion protection is a native DynamoDB `CreateTable`/`UpdateTable` field, so it rides `createTableRequest` and gets a diff block in `updateTable` (mirroring `tableClass`/`streams`). PITR uses the sidecar `updateContinuousBackups` API, so — like TTL's `updateTimeToLive` — it lives in a single dedicated setup-flow step (`updatePointInTimeRecovery`), never in `updateTable`.

**Tech Stack:** TypeScript, `@aws-sdk/client-dynamodb`, Jest, ESLint, Lerna monorepo (`packages/dynamoose`).

## Global Constraints

- Package root for all paths and commands: `packages/dynamoose`.
- Tests run against compiled output (`require("../dist")`) — **always `npm run build` before `npx jest`**.
- Test run (single file, filtered): `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "<pattern>"`.
- Type tests: `cd packages/dynamoose && npm run build && npm run test:types`.
- Lint (from repo root): `npm run lint`.
- SDK floor (already the peer dep): `@aws-sdk/client-dynamodb >=3.1073.0` — has `PointInTimeRecoverySpecification.RecoveryPeriodInDays` and `DeletionProtectionEnabled`.
- Convention: only emit an API field when it is meaningful (e.g. set `DeletionProtectionEnabled` on create **only when true**, like `StreamSpecification`/`TableClass`).
- Indentation in all source and test files is **tabs**, matching the existing files.

---

### Task 1: Deletion Protection — type, enum, default, and create path

**Files:**
- Modify: `packages/dynamoose/lib/Table/index.ts` (`TableOptions` interface ~L564-577; `TableUpdateOptions` enum ~L551-558; `@param options` doc comment ~L74-115)
- Modify: `packages/dynamoose/lib/Table/defaults.ts` (`original` object)
- Modify: `packages/dynamoose/lib/Table/utilities.ts` (`createTableRequest` ~L61-87)
- Test: `packages/dynamoose/test/Table.js` (inside the create-request `describe` that captures `createTableParams` — the block containing the `tableClass`/`streamOptions` create tests, ~L428-560, using `new instance.Table(...)`)

**Interfaces:**
- Produces: `TableOptions.deletionProtection: boolean` (default `false`); `TableUpdateOptions.deletionProtection = "deletionProtection"`; `createTableRequest` emits `DeletionProtectionEnabled: true` when the option is truthy.

- [ ] **Step 1: Write the failing tests**

Add inside the create-request `describe` block (the one with `let createTableParams` and `new instance.Table(...)`, next to the `streamOptions is enabled` test):

```javascript
it("Should call createTable with correct parameters when deletionProtection is true", async () => {
	const tableName = "Cat";
	const model = dynamoose.model(tableName, {"id": String});
	new instance.Table(tableName, [model], {"deletionProtection": true});
	await utils.set_immediate_promise();
	expect(createTableParams).toEqual({
		"AttributeDefinitions": [{"AttributeName": "id", "AttributeType": "S"}],
		"KeySchema": [{"AttributeName": "id", "KeyType": "HASH"}],
		"ProvisionedThroughput": {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1},
		"TableName": tableName,
		"DeletionProtectionEnabled": true
	});
});

it("Should call createTable without DeletionProtectionEnabled when deletionProtection is false", async () => {
	const tableName = "Cat";
	const model = dynamoose.model(tableName, {"id": String});
	new instance.Table(tableName, [model], {"deletionProtection": false});
	await utils.set_immediate_promise();
	expect(createTableParams).toEqual({
		"AttributeDefinitions": [{"AttributeName": "id", "AttributeType": "S"}],
		"KeySchema": [{"AttributeName": "id", "KeyType": "HASH"}],
		"ProvisionedThroughput": {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1},
		"TableName": tableName
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "deletionProtection"`
Expected: FAIL — first test errors because `createTableParams` lacks `DeletionProtectionEnabled` (also a TS error may surface on the unknown option before build; the build step will fail until Step 3 adds the type).

- [ ] **Step 3: Add the type, enum member, and default**

In `lib/Table/index.ts`, `TableOptions` interface, add after `streamOptions?: TableStreamOptions;`:

```typescript
	deletionProtection: boolean;
```

In `lib/Table/index.ts`, `TableUpdateOptions` enum, change the `streams` line to add the new member (keep trailing members comma-correct):

```typescript
	streams = "streams",
	deletionProtection = "deletionProtection"
```

In `lib/Table/defaults.ts`, `original` object, add after the `streamOptions` block (before the trailing commented lines):

```typescript
	},
	"deletionProtection": false
	// "serverSideEncryption": false,
```

(That merges into the existing `streamOptions: { ... }` — place `"deletionProtection": false` as a new top-level key.)

- [ ] **Step 4: Emit the field in `createTableRequest`**

In `lib/Table/utilities.ts`, inside `createTableRequest`, after the `tableClass` block (the `if (... === TableClass.infrequentAccess)` block, ~L68-70) add:

```typescript
	if (table.getInternalProperties(internalProperties).options.deletionProtection) {
		object.DeletionProtectionEnabled = true;
	}
```

- [ ] **Step 5: Update the doc comment**

In `lib/Table/index.ts`, the `@param options` table:
- In the `update` row, append `` `deletionProtection` `` to the list of updatable settings.
- Add a new row after the `tableClass` row:

```
	 * | deletionProtection | If Dynamoose should enable deletion protection on the table, blocking `DeleteTable` until disabled. | Boolean | false |
```

- In the default-object example (the fenced ```js block), add `"deletionProtection": false,` after the `"tableClass": "standard",` line.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "deletionProtection"`
Expected: PASS (2 passing).

- [ ] **Step 7: Commit**

```bash
git add packages/dynamoose/lib/Table/index.ts packages/dynamoose/lib/Table/defaults.ts packages/dynamoose/lib/Table/utilities.ts packages/dynamoose/test/Table.js
git commit -m "feat(Table): add deletionProtection option (create path)"
```

---

### Task 2: Deletion Protection — update path

**Files:**
- Modify: `packages/dynamoose/lib/Table/utilities.ts` (`updateTable` ~L166-283 — add a new block after the Streams block)
- Test: `packages/dynamoose/test/Table.js` (new `describe("Deletion Protection", ...)` sibling to `describe("Streams", ...)`)

**Interfaces:**
- Consumes: `TableUpdateOptions.deletionProtection`, `TableOptions.deletionProtection` (Task 1).
- Produces: `updateTable` issues `UpdateTable` with `DeletionProtectionEnabled` when the live table's `DeletionProtectionEnabled` differs from the option.

- [ ] **Step 1: Write the failing tests**

Add a new top-level `describe` inside `describe("Table", ...)`, next to `describe("Streams", ...)`:

```javascript
describe("Deletion Protection", () => {
	let updateTableParams = [];
	let describeTableFunction;

	beforeEach(() => {
		dynamoose.Table.defaults.set({"create": false, "waitForActive": false});
		updateTableParams = [];
		describeTableFunction = () => Promise.resolve({
			"Table": {
				"ProvisionedThroughput": {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1},
				"TableStatus": "ACTIVE"
			}
		});
		dynamoose.aws.ddb.set({
			"describeTable": () => describeTableFunction(),
			"updateTable": (params) => {
				updateTableParams.push(params);
				return Promise.resolve();
			},
			"listTagsOfResource": () => Promise.resolve({"Tags": []})
		});
	});

	afterEach(() => {
		dynamoose.aws.ddb.revert();
	});

	const updateOptions = [true, ["deletionProtection"]];

	updateOptions.forEach((updateOption) => {
		describe(`{"update": ${JSON.stringify(updateOption)}}`, () => {
			it("Should call updateTable to enable deletion protection", async () => {
				const tableName = "Cat";
				describeTableFunction = () => Promise.resolve({
					"Table": {
						"ProvisionedThroughput": {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1},
						"TableStatus": "ACTIVE",
						"DeletionProtectionEnabled": false
					}
				});
				const model = dynamoose.model(tableName, {"id": String});
				new dynamoose.Table(tableName, [model], {"deletionProtection": true, "update": updateOption});
				await utils.set_immediate_promise();
				expect(updateTableParams).toEqual([{"TableName": tableName, "DeletionProtectionEnabled": true}]);
			});

			it("Should call updateTable to disable deletion protection", async () => {
				const tableName = "Cat";
				describeTableFunction = () => Promise.resolve({
					"Table": {
						"ProvisionedThroughput": {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1},
						"TableStatus": "ACTIVE",
						"DeletionProtectionEnabled": true
					}
				});
				const model = dynamoose.model(tableName, {"id": String});
				new dynamoose.Table(tableName, [model], {"deletionProtection": false, "update": updateOption});
				await utils.set_immediate_promise();
				expect(updateTableParams).toEqual([{"TableName": tableName, "DeletionProtectionEnabled": false}]);
			});

			it("Should not call updateTable when deletion protection already matches", async () => {
				const tableName = "Cat";
				describeTableFunction = () => Promise.resolve({
					"Table": {
						"ProvisionedThroughput": {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1},
						"TableStatus": "ACTIVE",
						"DeletionProtectionEnabled": true
					}
				});
				const model = dynamoose.model(tableName, {"id": String});
				new dynamoose.Table(tableName, [model], {"deletionProtection": true, "update": updateOption});
				await utils.set_immediate_promise();
				expect(updateTableParams).toEqual([]);
			});
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "Deletion Protection"`
Expected: FAIL — `updateTableParams` is `[]` (enable/disable) because no diff block exists yet.

- [ ] **Step 3: Add the diff block to `updateTable`**

In `lib/Table/utilities.ts`, `updateTable`, after the closing `}` of the `// Streams` block (end of the function body, ~L282) add:

```typescript
	// Deletion Protection
	if (updateAll || (table.getInternalProperties(internalProperties).options.update as TableUpdateOptions[]).includes(TableUpdateOptions.deletionProtection)) {
		const tableDetails = (await getTableDetails(table)).Table;
		const expectedDeletionProtection = Boolean(table.getInternalProperties(internalProperties).options.deletionProtection);
		const currentDeletionProtection = Boolean(tableDetails.DeletionProtectionEnabled);

		if (currentDeletionProtection !== expectedDeletionProtection) {
			const object: DynamoDB.UpdateTableInput = {
				"TableName": table.getInternalProperties(internalProperties).name,
				"DeletionProtectionEnabled": expectedDeletionProtection
			};
			await ddb(instance, "updateTable", object);
			await waitForActive(table)();
		}
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "Deletion Protection"`
Expected: PASS (6 passing — 3 cases × 2 update options).

- [ ] **Step 5: Commit**

```bash
git add packages/dynamoose/lib/Table/utilities.ts packages/dynamoose/test/Table.js
git commit -m "feat(Table): reconcile deletionProtection on update"
```

---

### Task 3: PITR — type, enum, default, ddb overloads, helper, and setup step (enable/disable + create path)

**Files:**
- Modify: `packages/dynamoose/lib/aws/ddb/internal.ts` (add two `main` overloads after the `untagResource` overload)
- Modify: `packages/dynamoose/lib/Table/index.ts` (`TableStreamOptions` neighbour ~L559-562 → add `TablePointInTimeRecoveryOptions`; `TableOptions` interface; `TableUpdateOptions` enum; import line L11; setup flow ~L237-244; `@param options` doc)
- Modify: `packages/dynamoose/lib/Table/defaults.ts` (`original` object)
- Modify: `packages/dynamoose/lib/Table/utilities.ts` (new exported `updatePointInTimeRecovery`)
- Test: `packages/dynamoose/test/Table.js` (new `describe("Point In Time Recovery", ...)`)

**Interfaces:**
- Consumes: `ddb` wrapper (`../aws/ddb/internal`), `TableUpdateOptions` (Task 1).
- Produces:
  - `interface TablePointInTimeRecoveryOptions { enabled: boolean; recoveryPeriodInDays?: number; }`
  - `TableOptions.pointInTimeRecovery?: TablePointInTimeRecoveryOptions` (default `{ enabled: false }`)
  - `TableUpdateOptions.pointInTimeRecovery = "pointInTimeRecovery"`
  - `updatePointInTimeRecovery(table: Table): Promise<void>` — describe→diff→`updateContinuousBackups`; DynamoDB-Local-safe.

- [ ] **Step 1: Write the failing tests**

Add a new top-level `describe` inside `describe("Table", ...)`:

```javascript
describe("Point In Time Recovery", () => {
	let updateContinuousBackupsParams = [];
	let describeContinuousBackupsFunction;

	beforeEach(() => {
		dynamoose.Table.defaults.set({"create": false, "waitForActive": false});
		updateContinuousBackupsParams = [];
		describeContinuousBackupsFunction = () => Promise.resolve({
			"ContinuousBackupsDescription": {
				"ContinuousBackupsStatus": "ENABLED",
				"PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "DISABLED"}
			}
		});
		dynamoose.aws.ddb.set({
			"describeTable": () => Promise.resolve({
				"Table": {
					"ProvisionedThroughput": {"ReadCapacityUnits": 1, "WriteCapacityUnits": 1},
					"TableStatus": "ACTIVE"
				}
			}),
			"createTable": () => Promise.resolve(),
			"updateTable": () => Promise.resolve(),
			"listTagsOfResource": () => Promise.resolve({"Tags": []}),
			"describeContinuousBackups": () => describeContinuousBackupsFunction(),
			"updateContinuousBackups": (params) => {
				updateContinuousBackupsParams.push(params);
				return Promise.resolve();
			}
		});
	});

	afterEach(() => {
		dynamoose.aws.ddb.revert();
	});

	const updateOptions = [true, ["pointInTimeRecovery"]];

	updateOptions.forEach((updateOption) => {
		describe(`{"update": ${JSON.stringify(updateOption)}}`, () => {
			it("Should call updateContinuousBackups to enable when currently disabled", async () => {
				const tableName = "Cat";
				const model = dynamoose.model(tableName, {"id": String});
				new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true}, "update": updateOption});
				await utils.set_immediate_promise();
				expect(updateContinuousBackupsParams).toEqual([{
					"TableName": tableName,
					"PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": true}
				}]);
			});

			it("Should not call updateContinuousBackups when already matching", async () => {
				const tableName = "Cat";
				describeContinuousBackupsFunction = () => Promise.resolve({
					"ContinuousBackupsDescription": {
						"ContinuousBackupsStatus": "ENABLED",
						"PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "ENABLED"}
					}
				});
				const model = dynamoose.model(tableName, {"id": String});
				new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true}, "update": updateOption});
				await utils.set_immediate_promise();
				expect(updateContinuousBackupsParams).toEqual([]);
			});

			it("Should warn and skip when DynamoDB Local throws UnknownOperationException", async () => {
				const tableName = "Cat";
				const warnStub = jest.spyOn(console, "warn").mockImplementation(() => {});
				describeContinuousBackupsFunction = () => Promise.reject({"name": "UnknownOperationException"});
				const model = dynamoose.model(tableName, {"id": String});
				new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true}, "update": updateOption});
				await utils.set_immediate_promise();
				expect(updateContinuousBackupsParams).toEqual([]);
				expect(warnStub).toHaveBeenCalled();
				warnStub.mockRestore();
			});
		});
	});

	it("Should call updateContinuousBackups to disable when explicitly requested via the update array", async () => {
		const tableName = "Cat";
		describeContinuousBackupsFunction = () => Promise.resolve({
			"ContinuousBackupsDescription": {
				"ContinuousBackupsStatus": "ENABLED",
				"PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "ENABLED"}
			}
		});
		const model = dynamoose.model(tableName, {"id": String});
		new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": false}, "update": ["pointInTimeRecovery"]});
		await utils.set_immediate_promise();
		expect(updateContinuousBackupsParams).toEqual([{
			"TableName": tableName,
			"PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": false}
		}]);
	});

	it("Should enable point in time recovery after create when create is true", async () => {
		const tableName = "Cat";
		const model = dynamoose.model(tableName, {"id": String});
		new dynamoose.Table(tableName, [model], {"create": true, "waitForActive": false, "pointInTimeRecovery": {"enabled": true}});
		await utils.set_immediate_promise();
		expect(updateContinuousBackupsParams).toEqual([{
			"TableName": tableName,
			"PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": true}
		}]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "Point In Time Recovery"`
Expected: build FAIL first (unknown `pointInTimeRecovery` option type) — that is the expected failing state; Steps 3-7 add the type and behavior.

- [ ] **Step 3: Add ddb wrapper overloads**

In `lib/aws/ddb/internal.ts`, after the `untagResource` overload line, add:

```typescript
async function main (instance: Instance, method: "describeContinuousBackups", params: DynamoDB.DescribeContinuousBackupsCommandInput): Promise<DynamoDB.DescribeContinuousBackupsCommandOutput>;
async function main (instance: Instance, method: "updateContinuousBackups", params: DynamoDB.UpdateContinuousBackupsCommandInput): Promise<DynamoDB.UpdateContinuousBackupsCommandOutput>;
```

- [ ] **Step 4: Add the type, enum member, and default**

In `lib/Table/index.ts`, add after the `TableStreamOptions` interface (~L562):

```typescript
export interface TablePointInTimeRecoveryOptions {
	enabled: boolean;
	recoveryPeriodInDays?: number;
}
```

In `TableOptions`, add after `deletionProtection: boolean;` (from Task 1):

```typescript
	pointInTimeRecovery?: TablePointInTimeRecoveryOptions;
```

In `TableUpdateOptions`, extend the members (keep comma-correct):

```typescript
	deletionProtection = "deletionProtection",
	pointInTimeRecovery = "pointInTimeRecovery"
```

In `lib/Table/defaults.ts`, `original`, add after `"deletionProtection": false`:

```typescript
	"deletionProtection": false,
	"pointInTimeRecovery": {
		"enabled": false
	}
```

- [ ] **Step 5: Add the `updatePointInTimeRecovery` helper**

In `lib/Table/utilities.ts`, add a new exported function (e.g. after `updateTimeToLive`):

```typescript
export async function updatePointInTimeRecovery (table: Table): Promise<void> {
	const instance = table.getInternalProperties(internalProperties).instance;
	const pointInTimeRecovery = table.getInternalProperties(internalProperties).options.pointInTimeRecovery;
	const expectedEnabled = Boolean(pointInTimeRecovery && pointInTimeRecovery.enabled);
	const expectedPeriod = pointInTimeRecovery ? pointInTimeRecovery.recoveryPeriodInDays : undefined;

	try {
		const backups = await ddb(instance, "describeContinuousBackups", {
			"TableName": table.getInternalProperties(internalProperties).name
		});
		const description = backups.ContinuousBackupsDescription?.PointInTimeRecoveryDescription;
		const currentEnabled = description?.PointInTimeRecoveryStatus === "ENABLED";
		const currentPeriod = description?.RecoveryPeriodInDays;

		const enabledChanged = currentEnabled !== expectedEnabled;
		const periodChanged = expectedEnabled && typeof expectedPeriod === "number" && expectedPeriod !== currentPeriod;

		if (enabledChanged || periodChanged) {
			const specification: DynamoDB.PointInTimeRecoverySpecification = {
				"PointInTimeRecoveryEnabled": expectedEnabled
			};
			if (expectedEnabled && typeof expectedPeriod === "number") {
				specification.RecoveryPeriodInDays = expectedPeriod;
			}
			await ddb(instance, "updateContinuousBackups", {
				"TableName": table.getInternalProperties(internalProperties).name,
				"PointInTimeRecoverySpecification": specification
			});
		}
	} catch (error) {
		if (error.name === "UnknownOperationException") {
			console.warn(`Point-in-time recovery is not currently supported in DynamoDB Local. Skipping point-in-time recovery update for table: ${table.name}`); // eslint-disable-line no-console
		} else {
			throw error;
		}
	}
}
```

- [ ] **Step 6: Wire the setup-flow step**

In `lib/Table/index.ts` L11, add `updatePointInTimeRecovery` to the `./utilities` import:

```typescript
import {createTable, createTableRequest, updatePointInTimeRecovery, updateTable, updateTimeToLive, waitForActive} from "./utilities";
```

In the setup flow, insert **between** the `// Update Time To Live` block and the `// Update` block (~L240, after the `updateTimeToLive` push, before the `updateTable` push):

```typescript
				// Update Point In Time Recovery
				const pointInTimeRecoveryUpdateOption = this.getInternalProperties(internalProperties).options.update;
				const pointInTimeRecoveryEnabled = this.getInternalProperties(internalProperties).options.pointInTimeRecovery?.enabled;
				const updateIncludesPointInTimeRecovery = Array.isArray(pointInTimeRecoveryUpdateOption) && pointInTimeRecoveryUpdateOption.includes(TableUpdateOptions.pointInTimeRecovery);
				const createOrUpdateAllEngagesPointInTimeRecovery = (this.getInternalProperties(internalProperties).options.create || pointInTimeRecoveryUpdateOption === true) && pointInTimeRecoveryEnabled;
				if (updateIncludesPointInTimeRecovery || createOrUpdateAllEngagesPointInTimeRecovery) {
					setupFlow.push(() => updatePointInTimeRecovery(this));
				}
```

This mirrors TTL's `&& options.expires` opt-in: a bare `update: true` on a table that never engaged PITR (`enabled` falsy and no array include) does **not** push the step, so no existing `update: true` test starts calling `describeContinuousBackups`. Disabling PITR therefore requires the explicit `update: ["pointInTimeRecovery"]` form.

- [ ] **Step 7: Update the doc comment**

In `lib/Table/index.ts`, the `@param options` table:
- In the `update` row, append `` `pointInTimeRecovery` `` to the list of updatable settings.
- Add rows after the `streamOptions.type` row:

```
	 * | pointInTimeRecovery | An object containing settings for [Point-in-Time Recovery](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html). | Object | `{"enabled": false}` |
	 * | pointInTimeRecovery.enabled | If Dynamoose should enable point-in-time recovery (continuous backups) for the table. | Boolean | false |
	 * | pointInTimeRecovery.recoveryPeriodInDays | The recovery window in days (an integer between 1 and 35). Only used when `pointInTimeRecovery.enabled` is `true`; omitted uses the AWS default of 35. | Number | undefined |
```

- In the default-object example, add after the `streamOptions` block:

```
	 * 	"pointInTimeRecovery": {
	 * 		"enabled": false
	 * 	}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "Point In Time Recovery"`
Expected: PASS (8 passing — 3 looped cases × 2 update options, plus the explicit-array disable test and the create-path test).

- [ ] **Step 9: Commit**

```bash
git add packages/dynamoose/lib/aws/ddb/internal.ts packages/dynamoose/lib/Table/index.ts packages/dynamoose/lib/Table/defaults.ts packages/dynamoose/lib/Table/utilities.ts packages/dynamoose/test/Table.js
git commit -m "feat(Table): add pointInTimeRecovery option (enable/disable + create path)"
```

---

### Task 4: PITR — recovery period and construction validation

**Files:**
- Modify: `packages/dynamoose/lib/Table/index.ts` (constructor — add validation near the hashKey/rangeKey `InvalidParameter` checks ~L264-269)
- Test: `packages/dynamoose/test/Table.js` (extend `describe("Point In Time Recovery", ...)`)

**Interfaces:**
- Consumes: `TablePointInTimeRecoveryOptions.recoveryPeriodInDays`, `updatePointInTimeRecovery` (Task 3), `CustomError.InvalidParameter`.
- Produces: constructor throws `InvalidParameter` when `recoveryPeriodInDays` is provided and not an integer in `1..35`; the helper emits `RecoveryPeriodInDays` when enabling with a value.

- [ ] **Step 1: Write the failing tests**

Add inside `describe("Point In Time Recovery", ...)`, after the create-path test (these use the same `beforeEach` mocks):

```javascript
it("Should include RecoveryPeriodInDays when enabling with a recovery period", async () => {
	const tableName = "Cat";
	const model = dynamoose.model(tableName, {"id": String});
	new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true, "recoveryPeriodInDays": 7}, "update": ["pointInTimeRecovery"]});
	await utils.set_immediate_promise();
	expect(updateContinuousBackupsParams).toEqual([{
		"TableName": tableName,
		"PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": true, "RecoveryPeriodInDays": 7}
	}]);
});

it("Should call updateContinuousBackups when only the recovery period changes", async () => {
	const tableName = "Cat";
	describeContinuousBackupsFunction = () => Promise.resolve({
		"ContinuousBackupsDescription": {
			"ContinuousBackupsStatus": "ENABLED",
			"PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "ENABLED", "RecoveryPeriodInDays": 35}
		}
	});
	const model = dynamoose.model(tableName, {"id": String});
	new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true, "recoveryPeriodInDays": 7}, "update": ["pointInTimeRecovery"]});
	await utils.set_immediate_promise();
	expect(updateContinuousBackupsParams).toEqual([{
		"TableName": tableName,
		"PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": true, "RecoveryPeriodInDays": 7}
	}]);
});

it("Should not call updateContinuousBackups when the recovery period already matches", async () => {
	const tableName = "Cat";
	describeContinuousBackupsFunction = () => Promise.resolve({
		"ContinuousBackupsDescription": {
			"ContinuousBackupsStatus": "ENABLED",
			"PointInTimeRecoveryDescription": {"PointInTimeRecoveryStatus": "ENABLED", "RecoveryPeriodInDays": 7}
		}
	});
	const model = dynamoose.model(tableName, {"id": String});
	new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true, "recoveryPeriodInDays": 7}, "update": ["pointInTimeRecovery"]});
	await utils.set_immediate_promise();
	expect(updateContinuousBackupsParams).toEqual([]);
});

it("Should throw InvalidParameter when recoveryPeriodInDays is above 35", () => {
	const tableName = "Cat";
	const model = dynamoose.model(tableName, {"id": String});
	expect(() => new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true, "recoveryPeriodInDays": 36}})).toThrow("pointInTimeRecovery.recoveryPeriodInDays must be an integer between 1 and 35.");
});

it("Should throw InvalidParameter when recoveryPeriodInDays is below 1", () => {
	const tableName = "Cat";
	const model = dynamoose.model(tableName, {"id": String});
	expect(() => new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true, "recoveryPeriodInDays": 0}})).toThrow("pointInTimeRecovery.recoveryPeriodInDays must be an integer between 1 and 35.");
});

it("Should throw InvalidParameter when recoveryPeriodInDays is not an integer", () => {
	const tableName = "Cat";
	const model = dynamoose.model(tableName, {"id": String});
	expect(() => new dynamoose.Table(tableName, [model], {"pointInTimeRecovery": {"enabled": true, "recoveryPeriodInDays": 7.5}})).toThrow("pointInTimeRecovery.recoveryPeriodInDays must be an integer between 1 and 35.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "recovery period|recoveryPeriodInDays|RecoveryPeriodInDays"`
Expected: FAIL — the three "throw" tests do not throw (no validation yet). (The period-emitting tests already pass from Task 3's helper, which handles `RecoveryPeriodInDays`; confirm they pass here too.)

- [ ] **Step 3: Add construction validation**

In `lib/Table/index.ts`, in the constructor, immediately after the existing rangeKey `InvalidParameter` check (the block throwing `"rangeKey's for all models must match."`, ~L267-269), add:

```typescript
			const pointInTimeRecoveryOption = options.pointInTimeRecovery;
			if (pointInTimeRecoveryOption && pointInTimeRecoveryOption.recoveryPeriodInDays !== undefined) {
				const recoveryPeriodInDays = pointInTimeRecoveryOption.recoveryPeriodInDays;
				if (!Number.isInteger(recoveryPeriodInDays) || recoveryPeriodInDays < 1 || recoveryPeriodInDays > 35) {
					throw new CustomError.InvalidParameter("pointInTimeRecovery.recoveryPeriodInDays must be an integer between 1 and 35.");
				}
			}
```

(`options` here is the constructor's options argument, already in scope where the hashKey/rangeKey checks read `models`; `CustomError` is imported at the top of the file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js -t "Point In Time Recovery"`
Expected: PASS (14 passing — Task 3's 8 plus these 6).

- [ ] **Step 5: Commit**

```bash
git add packages/dynamoose/lib/Table/index.ts packages/dynamoose/test/Table.js
git commit -m "feat(Table): support pointInTimeRecovery.recoveryPeriodInDays with validation"
```

---

### Task 5: Documentation, changelog, and type tests

**Files:**
- Modify: `docs/docs_src/other/FAQ.md` (the `new Table()` IAM row)
- Modify: `PENDING_CHANGELOG.md` (`### Features`)
- Modify: `packages/dynamoose/test/types/Table.ts` (compile-only type fixtures)

**Interfaces:**
- Consumes: all options/enums from Tasks 1-4. No runtime behavior — this task is docs + type coverage.

- [ ] **Step 1: Add type-test fixtures**

In `packages/dynamoose/test/types/Table.ts`, after the `shouldSucceedWithTagsSetToEmptyObject` line, add:

```typescript
const shouldSucceedWithDeletionProtection = new dynamoose.Table("Table", [], {"deletionProtection": true});
const shouldSucceedWithPointInTimeRecovery = new dynamoose.Table("Table", [], {"pointInTimeRecovery": {"enabled": true}});
const shouldSucceedWithPointInTimeRecoveryPeriod = new dynamoose.Table("Table", [], {"pointInTimeRecovery": {"enabled": true, "recoveryPeriodInDays": 7}});
```

- [ ] **Step 2: Run type tests to verify they pass**

Run: `cd packages/dynamoose && npm run build && npm run test:types`
Expected: PASS (tsc reports no errors).

- [ ] **Step 3: Update the FAQ IAM table**

In `docs/docs_src/other/FAQ.md`, the `new Table()` row: append `` `describeContinuousBackups` `` and `` `updateContinuousBackups` `` to the IAM Permission cell, and append to the Notes cell:

```
`describeContinuousBackups` & `updateContinuousBackups` are only used if `create` is set to true with `pointInTimeRecovery.enabled`, or `update` is set to true or includes `pointInTimeRecovery`. Deletion protection uses `updateTable`, only when `update` is set to true or includes `deletionProtection`.
```

- [ ] **Step 4: Add changelog entries**

In `PENDING_CHANGELOG.md`, under `### Features`, add:

```
- Added support for enabling table deletion protection through the `deletionProtection` Table option (applied on create and reconciled on update)
- Added support for enabling point-in-time recovery through the `pointInTimeRecovery` Table option, including configuring the recovery window with `pointInTimeRecovery.recoveryPeriodInDays`
```

- [ ] **Step 5: Commit**

```bash
git add docs/docs_src/other/FAQ.md PENDING_CHANGELOG.md packages/dynamoose/test/types/Table.ts
git commit -m "docs(Table): document deletionProtection and pointInTimeRecovery options"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd packages/dynamoose && npm run build && npx jest test/Table.js`
Expected: PASS — all Table tests green, no regressions.

- [ ] **Step 2: Type tests**

Run: `cd packages/dynamoose && npm run test:types`
Expected: PASS.

- [ ] **Step 3: Lint**

Run (repo root): `npm run lint`
Expected: PASS — no errors/warnings (max-warnings 0).

- [ ] **Step 4: Fix any failures**

If any step fails, fix inline and re-run that step before proceeding. Do not commit a red build.
