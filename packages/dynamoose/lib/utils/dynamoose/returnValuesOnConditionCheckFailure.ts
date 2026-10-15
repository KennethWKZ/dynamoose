import * as DynamoDB from "@aws-sdk/client-dynamodb";
import CustomError from "../../Error";
import {Item} from "../../Item";
import {Model} from "../../Model";

// Returns the `ReturnValuesOnConditionCheckFailure` request property for a write's `returnValuesOnConditionCheckFailure` setting, or nothing without the setting.
export function requestProperty (value: DynamoDB.ReturnValuesOnConditionCheckFailure | undefined): {ReturnValuesOnConditionCheckFailure?: DynamoDB.ReturnValuesOnConditionCheckFailure} {
	if (value === undefined) {
		return {};
	}
	if (value !== "ALL_OLD" && value !== "NONE") {
		throw new CustomError.InvalidParameter("Invalid returnValuesOnConditionCheckFailure option, please pass in \"ALL_OLD\" or \"NONE\".");
	}
	return {"ReturnValuesOnConditionCheckFailure": value};
}

// With `ReturnValuesOnConditionCheckFailure: ALL_OLD`, DynamoDB puts the stored item on the `ConditionalCheckFailedException` as `Item`. This adds it as `conditionCheckFailureItem`, converted like `Model.get` would, and returns the same error to throw. If it can't be converted, the error is returned without the property; the raw item stays in `Item`.
export async function addConditionCheckFailureItem (error: any, model: Model<Item>): Promise<any> {
	if (error?.name === "ConditionalCheckFailedException" && error.Item) {
		try {
			error.conditionCheckFailureItem = await new model.Item(error.Item, {"type": "fromDynamo"}).conformToSchema({"customTypesDynamo": true, "checkExpiredItem": false, "saveUnknown": true, "modifiers": ["get"], "type": "fromDynamo", "mapAttributes": true});
		} catch (conversionError) {} // eslint-disable-line no-empty
	}
	return error;
}
