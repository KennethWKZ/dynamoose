import * as obj from "js-object-utilities";
import {IndexItem} from "../../Schema";
import Internal from "../../Internal";
import {Table} from "../../Table";
import deep_copy from "../deep_copy";
const {internalProperties} = Internal.General;

export enum TableIndexChangeType {
	add = "add",
	delete = "delete"
}

export interface ModelIndexAddChange {
	type: TableIndexChangeType.add;
	spec: IndexItem;
}
export interface ModelIndexDeleteChange {
	type: TableIndexChangeType.delete;
	name: string;
}

const index_changes = async (table: Table, existingIndexes = []): Promise<(ModelIndexAddChange | ModelIndexDeleteChange)[]> => {
	const output: (ModelIndexAddChange | ModelIndexDeleteChange)[] = [];
	const expectedIndexes = await table.getInternalProperties(internalProperties).getIndexes();
	const tableThroughput = table.getInternalProperties(internalProperties).options.throughput;

	// Indexes to delete
	const identicalProperties: string[] = ["IndexName", "KeySchema", "Projection", "ProvisionedThroughput"]; // This array represents the properties in the indexes that should match between existingIndexes (from DynamoDB) and expectedIndexes. This array will not include things like `IndexArn`, `ItemCount`, etc, since those properties do not exist in expectedIndexes

	if (tableThroughput === "ON_DEMAND") {
		// remove `ProvisionedThroughput` property from properties to compare against
		// because `ProvisionedThroughput` is not set on index schema in case of `ON_DEMAND` throughput
		// meaning `ProvisionedThroughput` is implicitly inherited from the table
		identicalProperties.pop();
	}

	const sanitizeIndex = (index: IndexItem) => {
		if (Array.isArray(index.Projection.NonKeyAttributes)) {
			index.Projection.NonKeyAttributes.sort();
		}
		return index;
	};

	const deleteIndexes: ModelIndexDeleteChange[] = existingIndexes.filter((index) => {
		const cleanedIndex = deep_copy(index);
		obj.entries(cleanedIndex).forEach(([key, value]) => {
			if (value === undefined) {
				obj.delete(cleanedIndex, key);
			}
		});

		return !(expectedIndexes.GlobalSecondaryIndexes || []).find((searchIndex) => obj.equals(
			sanitizeIndex(obj.pick(cleanedIndex, identicalProperties) as any),
			sanitizeIndex(obj.pick(searchIndex as any, identicalProperties) as any)
		));
	}).map((index) => ({"name": index.IndexName as string, "type": TableIndexChangeType.delete}));
	output.push(...deleteIndexes);

	// Indexes to create
	// An index needs (re)creating when it is not already present in DynamoDB in its expected form.
	// That covers a brand-new index, and a same-name index whose KeySchema/Projection changed: the
	// latter was queued for deletion above, so we recreate it in the same reconciliation pass rather
	// than only on the next `initialize` (two-run convergence). `updateTable` applies the changes
	// sequentially — the delete runs and waits for active before the create — which satisfies
	// DynamoDB's one-GSI-change-per-`updateTable` limit.
	const deletedIndexNames = deleteIndexes.map((index) => index.name);
	const createIndexes: ModelIndexAddChange[] = (expectedIndexes.GlobalSecondaryIndexes || []).filter((index) => {
		const existsInTable = existingIndexes.some((existingIndex) => existingIndex.IndexName === index.IndexName);
		const queuedForDelete = deletedIndexNames.includes(index.IndexName as string);
		return !existsInTable || queuedForDelete;
	}).map((index) => ({
		"type": TableIndexChangeType.add,
		"spec": index
	}));
	output.push(...createIndexes);

	return output;
};

export default index_changes;
