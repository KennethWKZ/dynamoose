/* eslint @typescript-eslint/no-unused-vars: 0 */

import * as dynamoose from "../../dist";
import {TransactionReturnOptions} from "../../dist/Transaction";
import {Item} from "../../dist/Item";

const model = dynamoose.model("User");

const shouldPassWithArrayOfTransactions = dynamoose.transaction([model.transaction.get("key")]);
// @ts-expect-error
const shouldFailWithNoArray = dynamoose.transaction(model.transaction.get("key"));

const shouldPassWithTransactionSettings = dynamoose.transaction([model.transaction.get("key")], {"return": TransactionReturnOptions.items});
// @ts-expect-error
const shouldFailWithInvalidTransactionSettings = dynamoose.transaction([model.transaction.get("key")], {"return": "bad"});

const shouldPassWithCallback = dynamoose.transaction(
	[model.transaction.get("key")],
	{"return": TransactionReturnOptions.items},
	(a, b) => {
		return;
	}
);

const shouldFailWithInvalidCallback = dynamoose.transaction(
	[model.transaction.get("key")],
	{"return": TransactionReturnOptions.items},
	// @ts-expect-error
	(a, b, c) => {
		return;
	}
);

const shouldPassWithCallbackInSecondArg = dynamoose.transaction([model.transaction.get("key")], (a, b) => {
	return;
});

class Account extends Item {
	id!: number;
	balance!: number;
}
const AccountModel = dynamoose.model<Account>("Account", {"id": Number, "balance": Number});

const shouldPassWithClientRequestToken = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"clientRequestToken": "token-1"});
const shouldPassWithRetry = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"retry": {"attempts": 3, "delay": 500}});
const shouldPassWithRetryAndReturnItems: Promise<[Account]> = dynamoose.transaction<[Account]>([AccountModel.transaction.create({"id": 1, "balance": 0})], {"retry": {"attempts": 3}, "returnItems": true});
// @ts-expect-error
const shouldFailWithRetryWithoutAttempts = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"retry": {"delay": 500}});

const shouldPassWithReturnItems: Promise<any[]> = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"returnItems": true});
const shouldPassWithReturnItemsAndItemTypes: Promise<[Account, Account | undefined]> = dynamoose.transaction<[Account, Account | undefined]>([AccountModel.transaction.create({"id": 1, "balance": 0}), AccountModel.transaction.delete({"id": 2})], {"returnItems": true});
async function shouldPassReadingTypedReturnItems (): Promise<number> {
	const [account] = await dynamoose.transaction<[Account]>([AccountModel.transaction.update({"id": 1}, {"$ADD": {"balance": 5}})], {"returnItems": true});
	return account.balance;
}
async function shouldFailReadingUnknownPropertyOfTypedReturnItems (): Promise<void> {
	const [account] = await dynamoose.transaction<[Account]>([AccountModel.transaction.update({"id": 1}, {"$ADD": {"balance": 5}})], {"returnItems": true});
	// @ts-expect-error
	account.notAnAttribute;
}
// @ts-expect-error
const shouldFailWithReturnItemsTypesThatAreNotItems = dynamoose.transaction<[string]>([AccountModel.transaction.create({"id": 1, "balance": 0})], {"returnItems": true});
// @ts-expect-error
const shouldFailWithInvalidReturnItems = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"returnItems": "yes"});
// @ts-expect-error
const shouldFailWithReturnItemsAndReturnRequest = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"return": TransactionReturnOptions.request, "returnItems": true});
const shouldPassWithReturnRequestAndReturnItemsFalse = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"return": TransactionReturnOptions.request, "returnItems": false});


const shouldPassWithReturnValuesOnConditionCheckFailure = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"returnValuesOnConditionCheckFailure": "ALL_OLD"});
const shouldPassWithReturnValuesOnConditionCheckFailureAndReturnItems: Promise<[Account]> = dynamoose.transaction<[Account]>([AccountModel.transaction.create({"id": 1, "balance": 0})], {"returnValuesOnConditionCheckFailure": "NONE", "returnItems": true});
const shouldPassWithReturnValuesOnConditionCheckFailureAndReturnRequest = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"return": TransactionReturnOptions.request, "returnValuesOnConditionCheckFailure": "ALL_OLD"});
// @ts-expect-error
const shouldFailWithInvalidReturnValuesOnConditionCheckFailure = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"returnValuesOnConditionCheckFailure": "ALL_NEW"});

// @ts-expect-error
const shouldFailWithInvalidClientRequestToken = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"clientRequestToken": 1});
const shouldPassWithRetryAndCallback = dynamoose.transaction([AccountModel.transaction.create({"id": 1, "balance": 0})], {"retry": {"attempts": 3}}, (a, b) => {
	return;
});
