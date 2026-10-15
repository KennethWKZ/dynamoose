import ddb from "./aws/ddb/internal";
import {randomUUID} from "crypto";
import * as DynamoDB from "@aws-sdk/client-dynamodb";
import utils from "./utils";
import Error from "./Error";
import {Model} from "./Model";
import ModelStore from "./ModelStore";
import {CallbackType} from "./General";
import {Item} from "./Item";
import Internal from "./Internal";
const {internalProperties, transactionModel} = Internal.General;
import {Table} from "./Table";
import {Instance} from "./Instance";

export enum TransactionReturnOptions {
	request = "request",
	items = "items"
}
enum TransactionType {
	get = "get",
	write = "write"
}
export interface TransactionSettings {
	return?: TransactionReturnOptions;
	type?: TransactionType;
	/**
	 * A token of 1 to 36 characters that DynamoDB uses to make a `write` transaction idempotent: for 10 minutes after a successful transaction, sending the same transaction again with the same token succeeds without writing anything again. Without it, the AWS SDK sends a new token with every call. DynamoDB compares the whole request, so the token only helps when exactly the same request is sent again. A model with `timestamps` writes the current time each time a request is built, so a transaction built again (for example by a redelivered Lambda event) and sent with a token that was already used fails with `IdempotentParameterMismatchException` for those 10 minutes, as does sending different transaction items with it. To make a handler idempotent, use a condition instead. With `retry` and no token, Dynamoose already sends its retries of one call with one token.
	 */
	clientRequestToken?: string;
	/**
	 * Sends the transaction again when DynamoDB cancels it because it conflicts with another request on the same item (a `TransactionCanceledException` with a `TransactionConflict` reason) or reports it as still in progress (`TransactionInProgressException`). A canceled transaction writes nothing, so it is safe to send again. A transaction in progress may still be applied, so every attempt sends the same `ClientRequestToken`, and DynamoDB applies the transaction at most once: your `clientRequestToken`, or one Dynamoose makes for this call (replaced after a cancellation). Any other error, including a failed condition, is thrown at once.
	 *
	 * `attempts` is how many times to send it again. Retry `n` waits a random time between 0 and `delay * 2^(n - 1)` milliseconds, but at most 20 seconds; `delay` defaults to `100`. After the last attempt, the last error is thrown.
	 *
	 * ```js
	 * await dynamoose.transaction([...], {"retry": {"attempts": 3, "delay": 500}});
	 * ```
	 */
	retry?: {attempts: number; delay?: number};
	/**
	 * DynamoDB does not return items from a write transaction, so by default a `write` transaction resolves with `null`. Set `returnItems` to `true` to resolve with an array that has one entry per object in `transactions`, in the same order:
	 *
	 * - `create` (`Put`): the item as stored, built from the request without reading it from DynamoDB.
	 * - `update` (`Update`): the item as stored after the transaction. Dynamoose reads every updated item back in one `transactGetItems` call after the write succeeds, which uses read capacity for each of them. The item is read after the write, so a change another request makes in between is included, and an item deleted in between is `undefined`.
	 * - `delete` (`Delete`) and `condition` (`ConditionCheck`): `undefined`.
	 *
	 * Every item looks the same as `Model.get` would return it: an instance of the model whose `Model.transaction` method built that request, with its `get` functions and `map` names applied. That differs from `Model.create`, which returns the item without its `get` functions applied. A written item is returned even if its `expires` time has passed. For an object you build yourself, or a copy of one a `Model.transaction` method returned, Dynamoose uses the first model of that table the item fits.
	 *
	 * `returnItems` can't be used when `return` is set to `request`.
	 *
	 * ```js
	 * const [charge, user, , product] = await dynamoose.transaction([
	 * 	Charge.transaction.create({"id": "charge1", "userid": "user1", "amount": 100}),
	 * 	User.transaction.update({"id": "user1"}, {"$ADD": {"balance": -100}}),
	 * 	Credit.transaction.delete({"id": "credit1"}),
	 * 	Product.transaction.update({"id": "product1"}, {"$ADD": {"inventory": -1}})
	 * ], {"returnItems": true});
	 *
	 * console.log(user.balance); // The balance stored after the transaction
	 * ```
	 *
	 * In TypeScript, you can pass the item types in the same order: `dynamoose.transaction<[Charge, User, undefined, Product]>(...)`. Dynamoose does not check them against the requests.
	 *
	 * If the write succeeds but the written items can't be returned (reading them back fails, or a `get` function throws), the promise rejects with an error whose `name` is `TransactionReadError`. Its `committed` property is `true` and its `cause` property is the original error. The data is saved, so don't retry the write: a retried `create` fails because the item exists, and a retried `$ADD` is applied twice.
	 */
	returnItems?: boolean;
	/**
	 * Set to `ALL_OLD` to have DynamoDB return the stored item when a write in the transaction fails its condition. Dynamoose passes it as `ReturnValuesOnConditionCheckFailure` on every `create` (`Put`), `update` (`Update`), `delete` (`Delete`) and `condition` (`ConditionCheck`) request that has a condition, unless the request already sets it. `NONE` is DynamoDB's default. DynamoDB doesn't use read capacity to return the item.
	 *
	 * If a condition fails, the transaction rejects with DynamoDB's `TransactionCanceledException` as before. Dynamoose adds a `conditionCheckFailureItems` property to that error: an array with one entry per object in `transactions`, in the same order. An entry is the stored item for a request whose condition failed while the item existed, as `Model.get` would return it, and `undefined` for every other request, including a failed condition on an item that doesn't exist. Dynamoose adds the property whenever DynamoDB returns a stored item, also for a request that sets `ReturnValuesOnConditionCheckFailure` itself. If a returned item can't be converted (for example a `get` function throws), the error is thrown without the property; the raw items are still in `CancellationReasons`.
	 *
	 * ```js
	 * try {
	 * 	await dynamoose.transaction([
	 * 		Charge.transaction.create({"id": "charge1", "amount": 100}),
	 * 		User.transaction.update({"id": "user1"}, {"$ADD": {"balance": -100}}, {"condition": new dynamoose.Condition("version").eq(3)})
	 * 	], {"returnValuesOnConditionCheckFailure": "ALL_OLD"});
	 * } catch (error) {
	 * 	const [existingCharge, user] = error.conditionCheckFailureItems ?? [];
	 * 	// `existingCharge` is set if charge1 already exists. `user` is set if user1 exists with another version.
	 * }
	 * ```
	 */
	returnValuesOnConditionCheckFailure?: DynamoDB.ReturnValuesOnConditionCheckFailure;
}

export type GetTransactionInput = {Get: DynamoDB.GetItemInput};
export type CreateTransactionInput = {Put: DynamoDB.PutItemInput};
export type DeleteTransactionInput = {Delete: DynamoDB.DeleteItemInput};
export type UpdateTransactionInput = {Update: DynamoDB.UpdateItemInput};
export type ConditionTransactionInput = {ConditionCheck: DynamoDB.ConditionCheck};

type Transaction =
	GetTransactionInput |
	CreateTransactionInput |
	DeleteTransactionInput |
	UpdateTransactionInput |
	ConditionTransactionInput;

type TransactionValue = DynamoDB.GetItemInput | DynamoDB.PutItemInput | DynamoDB.DeleteItemInput | DynamoDB.UpdateItemInput | DynamoDB.ConditionCheck;

type Transactions = (Transaction | Promise<Transaction>)[];
type TransactionCallback = CallbackType<any, any>;
type TransactionReturnType = any;

// `returnItems` can't be combined with `return: "request"`, which sends nothing to DynamoDB.
type TransactionSettingsInput = Omit<TransactionSettings, "return" | "returnItems"> & ({return?: TransactionReturnOptions.items; returnItems?: boolean} | {return: TransactionReturnOptions.request; returnItems?: false});

/* Define overloads / signatures for Transaction method */
function Transaction<T extends (Item | undefined)[] = any[]> (transactions: Transactions, settings: TransactionSettingsInput & {returnItems: true}): Promise<T>;
function Transaction (transactions: Transactions): TransactionReturnType;
function Transaction (transactions: Transactions, settings: TransactionSettingsInput): TransactionReturnType;
function Transaction (transactions: Transactions, callback: TransactionCallback): TransactionReturnType;
function Transaction (transaction: Transactions, settings: TransactionSettingsInput, callback: TransactionCallback): TransactionReturnType;
function Transaction (transactions: Transactions, settings?: TransactionSettings | TransactionCallback, callback?: TransactionCallback): TransactionReturnType {
	settings = settings ?? {"return": TransactionReturnOptions.items};

	if (typeof settings === "function") {
		callback = settings;
		settings = {"return": TransactionReturnOptions.items};
	}
	if (typeof transactions === "function") {
		callback = transactions;
		transactions = null;
	}

	const promise = (async (): Promise<any> => {
		if (!Array.isArray(transactions) || transactions.length <= 0) {
			throw new Error.InvalidParameter("You must pass in an array with items for the transactions parameter.");
		}

		const transactionObjects = await Promise.all(transactions);

		const {returnValuesOnConditionCheckFailure, clientRequestToken} = settings;
		if (returnValuesOnConditionCheckFailure !== undefined && !["ALL_OLD", "NONE"].includes(returnValuesOnConditionCheckFailure)) {
			throw new Error.InvalidParameter("Invalid returnValuesOnConditionCheckFailure option, please pass in \"ALL_OLD\" or \"NONE\".");
		}
		if (clientRequestToken !== undefined) {
			if (typeof clientRequestToken !== "string" || clientRequestToken.length < 1 || clientRequestToken.length > 36) {
				throw new Error.InvalidParameter("clientRequestToken must be a string of 1 to 36 characters.");
			}
			const isGetTransaction = settings.type ? settings.type === TransactionType.get : transactionObjects.every((transaction) => Object.keys(transaction)[0] === "Get");
			if (isGetTransaction) {
				throw new Error.InvalidParameter("clientRequestToken can only be used with a write transaction.");
			}
		}
		const retry = settings.retry ?? {"attempts": 0};
		if (!Number.isInteger(retry?.attempts) || retry.attempts < 0 || retry.delay !== undefined && !(typeof retry.delay === "number" && retry.delay >= 0)) {
			throw new Error.InvalidParameter("retry.attempts must be a whole number of 0 or more, and retry.delay a number of milliseconds of 0 or more.");
		}

		const transactionParams = {
			// Copies the requests that get the setting, so the objects passed in are unchanged.
			"TransactItems": returnValuesOnConditionCheckFailure === undefined ? transactionObjects : transactionObjects.map((transaction) => {
				const [[key, value]] = Object.entries(transaction) as [string, TransactionValue & {ConditionExpression?: string; ReturnValuesOnConditionCheckFailure?: string}][];
				if (key === "Get" || !value.ConditionExpression || value.ReturnValuesOnConditionCheckFailure !== undefined) {
					return transaction;
				}
				return {[key]: {...value, "ReturnValuesOnConditionCheckFailure": returnValuesOnConditionCheckFailure}} as Transaction;
			}),
			...clientRequestToken !== undefined ? {"ClientRequestToken": clientRequestToken} : {}
		};

		if (settings.return === TransactionReturnOptions.request) {
			if (settings.returnItems) {
				throw new Error.InvalidParameter("returnItems can't be used when return is set to request, because no request is sent to DynamoDB.");
			}
			return transactionParams;
		}

		let transactionType: "transactGetItems" | "transactWriteItems";
		if (settings.type) {
			switch (settings.type) {
			case TransactionType.get:
				transactionType = "transactGetItems";
				break;
			case TransactionType.write:
				transactionType = "transactWriteItems";
				break;
			default:
				throw new Error.InvalidParameter("Invalid type option, please pass in \"get\" or \"write\".");
			}
		} else {
			transactionType = transactionObjects.map((a) => Object.keys(a)[0]).every((key) => key === "Get") ? "transactGetItems" : "transactWriteItems";
		}

		const tableNames: string[] = transactionObjects.map((a) => (Object.values(a)[0] as TransactionValue).TableName);
		const uniqueTableNames = utils.unique_array_elements(tableNames);
		const tables: (Table | undefined)[] = uniqueTableNames.map((name) => ModelStore.forTableName(name)?.[0].getInternalProperties(internalProperties).table());
		const validTables: Table[] = tables.filter((table) => table !== undefined);
		tables.forEach((table, index) => {
			if (!table) {
				throw new Error.InvalidParameter(`Table "${uniqueTableNames[index]}" not found. Please register the table with dynamoose before using it in transactions.`);
			}
		});
		await Promise.all(tables.map((table) => table.getInternalProperties(internalProperties).pendingTaskPromise()));

		const instance: Instance = tables.reduce((instance: Instance, table: Table): Instance => {
			const tableInstance = table.getInternalProperties(internalProperties).instance;
			if (!instance) {
				return tableInstance;
			}

			if (tableInstance !== instance) {
				throw new Error.InvalidParameter("You must use a single Dynamoose instance for all tables in a transaction.");
			}

			return instance;
		}, undefined);

		// Builds the item for a stored attribute map, with the given model or, for requests not built by a model, the model that fits the item.
		const toItem = async (attributes: any, tableName: string, knownModel?: Model<Item>, checkExpiredItem = true): Promise<Item | undefined> => {
			// DynamoDB returns an empty response for a key that has no item.
			if (!attributes) {
				return undefined;
			}
			const table: Table = validTables.find((table) => table.name === tableName);
			const model: Model<Item> = knownModel ?? await table.getInternalProperties(internalProperties).modelForObject(Item.fromDynamo(attributes));
			return new model.Item(attributes, {"type": "fromDynamo"}).conformToSchema({"customTypesDynamo": true, "checkExpiredItem": checkExpiredItem, "saveUnknown": true, "modifiers": ["get"], "type": "fromDynamo", "mapAttributes": true});
		};

		// A transaction DynamoDB canceled for a conflict, or reports as in progress, wrote nothing, so it can be sent again.
		const isRetryable = (error: any): boolean => error?.name === "TransactionInProgressException" || error?.name === "TransactionCanceledException" && Array.isArray(error.CancellationReasons) && error.CancellationReasons.some((reason: DynamoDB.CancellationReason) => reason?.Code === "TransactionConflict");
		// Without a token the AWS SDK sends a new one with every call. A transaction reported as in progress may still be applied, so sending it again with a new token could apply it twice. Retries keep one token, which DynamoDB applies at most once.
		const generatesToken = transactionType === "transactWriteItems" && retry.attempts > 0 && clientRequestToken === undefined;
		let sentParams = generatesToken ? {...transactionParams, "ClientRequestToken": randomUUID()} : transactionParams;
		let result: any;
		for (let attempt = 1; ; attempt++) {
			try {
				// TODO: remove `as any` here (https://stackoverflow.com/q/61111476/894067)
				result = await ddb(instance, transactionType as any, sentParams as any);
				break;
			} catch (error) {
				if (attempt <= retry.attempts && isRetryable(error)) {
					// A canceled transaction is finished and wrote nothing, so a token Dynamoose made is replaced. A token the caller passed is always kept.
					if (generatesToken && error?.name === "TransactionCanceledException") {
						sentParams = {...sentParams, "ClientRequestToken": randomUUID()};
					}
					await utils.timeout(Math.random() * Math.min(20000, (retry.delay ?? 100) * 2 ** (attempt - 1)));
					continue;
				}
				// With `ReturnValuesOnConditionCheckFailure: ALL_OLD`, a cancellation reason holds the stored item of a request whose condition failed.
				const reasons: DynamoDB.CancellationReason[] | undefined = error?.name === "TransactionCanceledException" ? error.CancellationReasons : undefined;
				if (Array.isArray(reasons) && reasons.some((reason) => reason?.Item)) {
					try {
						error.conditionCheckFailureItems = await Promise.all(reasons.map((reason, index) => reason?.Item ? toItem(reason.Item, tableNames[index], transactionObjects[index][transactionModel], false) : undefined));
					} catch (conversionError) {} // eslint-disable-line no-empty
				}
				throw error;
			}
		}
		if (result.Responses) {
			return Promise.all(result.Responses.map((item: any, index: number) => toItem(item.Item, tableNames[index])));
		}
		if (!settings.returnItems || transactionType !== "transactWriteItems") {
			return null;
		}

		// DynamoDB doesn't return items from a write transaction. A `create` already holds the whole item it wrote; an `update` has to be read back.
		// The write is saved at this point, so any failure from here on is reported as a `TransactionReadError`, never as a failed write.
		// Written items are returned even if their expiry time has passed, because they are stored.
		try {
			const updates = transactionObjects.map((transaction, index) => ({"update": (transaction as UpdateTransactionInput).Update, index})).filter(({update}) => update);
			const updatedItems: any[] = updates.length > 0 ? (await ddb(instance, "transactGetItems", {"TransactItems": updates.map(({update}) => ({"Get": {"TableName": update.TableName, "Key": update.Key}}))}) as any).Responses : [];
			return await Promise.all(transactionObjects.map((transaction, index) => {
				const model: Model<Item> | undefined = transaction[transactionModel];
				if ((transaction as CreateTransactionInput).Put) {
					return toItem((transaction as CreateTransactionInput).Put.Item, tableNames[index], model, false);
				}
				const updateIndex = updates.findIndex((update) => update.index === index);
				return updateIndex >= 0 ? toItem(updatedItems[updateIndex].Item, tableNames[index], model, false) : undefined;
			}));
		} catch (error) {
			throw new Error.TransactionReadError(error);
		}
	})();

	if (callback) {
		promise.then((result) => callback(null, result)).catch((error) => callback(error));
	} else {
		return promise;
	}
}

export default Transaction;
