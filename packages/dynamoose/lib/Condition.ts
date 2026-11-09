import {Item} from "./Item";
import CustomError from "./Error";
import utils from "./utils";
const OR = Symbol("OR");
// Marks a group (an array of conditions) that `not()` came before.
const NOT_GROUP = Symbol("NOT_GROUP");
// Marks a group that is a raw condition object (`parenthesis(new Condition({FilterExpression, ...}))`).
const RAW_GROUP = Symbol("RAW_GROUP");
import * as DynamoDB from "@aws-sdk/client-dynamodb";
import {ObjectType} from "./General";
import {ExpressionAttributeNameMap, ExpressionAttributeValueMap} from "./Types";
import Internal from "./Internal";
import {Model} from "./Model";
import {InternalPropertiesClass} from "./InternalPropertiesClass";
const {internalProperties} = Internal.General;

// A raw object has an expression, `ExpressionAttributeNames` and, unless the expression uses no values (`attribute_exists(#a)`), `ExpressionAttributeValues`.
const isRawConditionObject = (object): boolean => {
	const isObject = (value): boolean => Boolean(value) && typeof value === "object";
	const hasValues = "ExpressionAttributeValues" in object;
	return Object.keys(object).length === (hasValues ? 3 : 2) && isObject(object.ExpressionAttributeNames) && (!hasValues || isObject(object.ExpressionAttributeValues));
};
const rawConditionExpressionKeys = ["ConditionExpression", "FilterExpression"];

export type ConditionFunction = (condition: Condition) => Condition;
// One stored comparison: an object with the attribute as its only key. Every comparison is stored by `conditionEntry`, so each has exactly one key, which the code that reads them (`Object.entries(entry)[0]`) relies on.
type ConditionStorageType = {[key: string]: ConditionsConditionStorageObject} | typeof OR;
const conditionEntry = (attribute: string, type: ConditionComparisonComparatorDynamoName, value: any): ConditionStorageType => ({[attribute]: {type, value}});
export type ConditionStorageTypeNested = ConditionStorageType | Array<ConditionStorageTypeNested>;
type ConditionStorageSettingsConditions = ConditionStorageTypeNested[];
// TODO: the return value of the function below is incorrect. We need to add a property to the object that is a required string, where the property/key name is always equal to `settings.conditionString`
type ConditionRequestObjectResult = {ExpressionAttributeNames?: ExpressionAttributeNameMap; ExpressionAttributeValues?: ExpressionAttributeValueMap};

interface ConditionComparisonType {
	name: ConditionComparisonComparatorName;
	typeName: ConditionComparisonComparatorDynamoName;
	not: ConditionComparisonComparatorDynamoName;
	multipleArguments?: boolean;
}
enum ConditionComparisonComparatorName {
	equals = "eq",
	notEquals = "ne",
	lessThan = "lt",
	lessThanEquals = "le",
	greaterThan = "gt",
	greaterThanEquals = "ge",
	beginsWith = "beginsWith",
	contains = "contains",
	exists = "exists",
	in = "in",
	between = "between"
}
enum ConditionComparisonComparatorDynamoName {
	equals = "EQ",
	notEquals = "NE",
	lessThan = "LT",
	lessThanEquals = "LE",
	greaterThan = "GT",
	greaterThanEquals = "GE",
	beginsWith = "BEGINS_WITH",
	contains = "CONTAINS",
	notContains = "NOT_CONTAINS",
	exists = "EXISTS",
	notExists = "NOT_EXISTS",
	in = "IN",
	notIn = "NOT_IN",
	between = "BETWEEN",
	notBetween = "NOT_BETWEEN",
	notBeginsWith = "NOT_BEGINS_WITH"
}
const types: ConditionComparisonType[] = [
	{"name": ConditionComparisonComparatorName.equals, "typeName": ConditionComparisonComparatorDynamoName.equals, "not": ConditionComparisonComparatorDynamoName.notEquals},
	{"name": ConditionComparisonComparatorName.notEquals, "typeName": ConditionComparisonComparatorDynamoName.notEquals, "not": ConditionComparisonComparatorDynamoName.equals},
	{"name": ConditionComparisonComparatorName.lessThan, "typeName": ConditionComparisonComparatorDynamoName.lessThan, "not": ConditionComparisonComparatorDynamoName.greaterThanEquals},
	{"name": ConditionComparisonComparatorName.lessThanEquals, "typeName": ConditionComparisonComparatorDynamoName.lessThanEquals, "not": ConditionComparisonComparatorDynamoName.greaterThan},
	{"name": ConditionComparisonComparatorName.greaterThan, "typeName": ConditionComparisonComparatorDynamoName.greaterThan, "not": ConditionComparisonComparatorDynamoName.lessThanEquals},
	{"name": ConditionComparisonComparatorName.greaterThanEquals, "typeName": ConditionComparisonComparatorDynamoName.greaterThanEquals, "not": ConditionComparisonComparatorDynamoName.lessThan},
	{"name": ConditionComparisonComparatorName.beginsWith, "typeName": ConditionComparisonComparatorDynamoName.beginsWith, "not": ConditionComparisonComparatorDynamoName.notBeginsWith},
	{"name": ConditionComparisonComparatorName.contains, "typeName": ConditionComparisonComparatorDynamoName.contains, "not": ConditionComparisonComparatorDynamoName.notContains},
	{"name": ConditionComparisonComparatorName.exists, "typeName": ConditionComparisonComparatorDynamoName.exists, "not": ConditionComparisonComparatorDynamoName.notExists},
	{"name": ConditionComparisonComparatorName.in, "typeName": ConditionComparisonComparatorDynamoName.in, "not": ConditionComparisonComparatorDynamoName.notIn},
	{"name": ConditionComparisonComparatorName.between, "typeName": ConditionComparisonComparatorDynamoName.between, "not": ConditionComparisonComparatorDynamoName.notBetween, "multipleArguments": true}
];
export type ConditionInitializer = Condition | ObjectType | string;

export interface BasicOperators<T = Condition> {
	and: () => T;
	or: () => T;
	not: () => T;
	parenthesis: (value: Condition | ConditionFunction) => T;
	group: (value: Condition | ConditionFunction) => T;
	where: (key: string) => T;
	filter: (key: string) => T;
	attribute: (key: string) => T;
	eq: (value: any) => T;
	ne: (value: any) => T;
	lt: (value: any) => T;
	le: (value: any) => T;
	gt: (value: any) => T;
	ge: (value: any) => T;
	beginsWith: (value: any) => T;
	contains: (value: any) => T;
	exists: () => T;
	in: (value: any) => T;
	between: (...values: any[]) => T;
}

export interface Condition extends BasicOperators { // eslint-disable-line @typescript-eslint/no-unsafe-declaration-merging
	where: (key: string) => Condition;
	filter: (key: string) => Condition;
	attribute: (key: string) => Condition;
	eq: (value: any) => Condition;
	ne: (value: any) => Condition;
	lt: (value: any) => Condition;
	le: (value: any) => Condition;
	gt: (value: any) => Condition;
	ge: (value: any) => Condition;
	beginsWith: (value: any) => Condition;
	contains: (value: any) => Condition;
	exists: () => Condition;
	in: (value: any) => Condition;
	between: (...values: any[]) => Condition;
}

type ConditionObject = {
	[key: string]: {
		type: ConditionComparisonComparatorDynamoName;
		value: any;
	}
} | typeof OR;

interface ConditionInternalProperties {
	requestObject: (model: Model<Item>, settings?: ConditionRequestObjectSettings) => Promise<ConditionRequestObjectResult>;
	settings?: {
		conditions?: ConditionObject[];
		pending?: {
			key?: string;
			not?: boolean;
			type?: ConditionComparisonType;
			value?: any;
		}; // represents the pending chain of filter data waiting to be attached to the `conditions` parameter. For example, storing the key before we know what the comparison operator is.
		raw?: ConditionInitializer;
	},
	comparisonChart: (model: Model<Item>) => Promise<any>;
}

export class Condition extends InternalPropertiesClass<ConditionInternalProperties> { // eslint-disable-line @typescript-eslint/no-unsafe-declaration-merging
	/**
	 * This function creates a condition. A string starts a comparison on that attribute (`new dynamoose.Condition("name").eq("Bob")`), and without an argument you start one with `where(key)`. An object compares each of its attributes: a value compares with `eq` (`{"name": "Bob"}`), and an object names its comparison (`{"age": {"gt": 5}}`). A condition is copied. A raw DynamoDB condition object (a `ConditionExpression` or `FilterExpression` with `ExpressionAttributeNames` and, when it uses values, `ExpressionAttributeValues`) is used as it is, and condition methods called on it are ignored.
	 * @param object The attribute to start a comparison on, an object of comparisons, a condition to copy, or a raw DynamoDB condition object.
	 * @returns Condition
	 */
	constructor (object?: ConditionInitializer) {
		super();

		this.setInternalProperties(internalProperties, {
			"requestObject": async (model: Model<Item>, settings: ConditionRequestObjectSettings = {"conditionString": "ConditionExpression", "conditionStringType": "string"}): Promise<ConditionRequestObjectResult> => {
				const toDynamo = async (key: string, value: ObjectType): Promise<DynamoDB.AttributeValue> => {
					const newObj = await Item.objectFromSchema({[key]: value}, model, {"type": "toDynamo", "modifiers": ["set"], "typeCheck": false, "mapAttributes": true, "customTypesDynamo": true});
					// The schema's `set` setting can add attributes to the object, so the value is the one under `key`. `key` is a raw condition's placeholder or an attribute name already resolved from its alias, so `mapAttributes` doesn't rename it.
					let newValue = newObj[key];
					// A nested path (`meta.when`) is a property name above, so its attribute is only found from the nested object.
					if (newValue instanceof Date && key.includes(".")) {
						const nestedObj = await Item.objectFromSchema(utils.object.set({}, key, value), model, {"type": "toDynamo", "modifiers": ["set"], "typeCheck": false, "mapAttributes": true, "customTypesDynamo": true});
						newValue = utils.object.get(nestedObj, key);
					}
					// A Date is converted by the attribute's Date type (milliseconds, seconds or ISO string). Any other attribute has no stored form for it.
					if (newValue instanceof Date) {
						throw new CustomError.InvalidParameter(`The condition value for "${key}" is a Date, but "${key}" isn't a Date attribute in the schema, so Dynamoose doesn't know how it is stored. Pass date.getTime() or date.toISOString() instead.`);
					}
					// DynamoDB rejects an expression that uses a value placeholder without a value.
					if (newValue === undefined) {
						throw new CustomError.InvalidParameter(`The condition on "${key}" has no value (it is undefined).`);
					}
					return Item.objectToDynamo(newValue, {"type": "value"});
				};

				const rawRequestObject = async (raw: ObjectType): Promise<ObjectType> => {
					const [expressionKey] = Object.keys(raw).filter((key) => key !== "ExpressionAttributeNames" && key !== "ExpressionAttributeValues");
					// A condition expression and a filter expression have the same syntax, so either one is used for whichever the request needs. Any other key would leave the request without the condition.
					if (!rawConditionExpressionKeys.includes(expressionKey)) {
						throw new CustomError.InvalidParameter(`A raw condition object must have a "ConditionExpression" or "FilterExpression" property, but it has "${expressionKey}".`);
					}
					// Builds a new object, because callers merge their own names and values into the result.
					const {ExpressionAttributeNames, ExpressionAttributeValues} = raw;
					// Every `:value` placeholder in the expression needs a value, which DynamoDB would otherwise reject.
					const missingValue = (raw[expressionKey].match(/:\w+/gu) || []).find((placeholder) => (ExpressionAttributeValues || {})[placeholder] === undefined);
					if (missingValue) {
						throw new CustomError.InvalidParameter(`The raw condition has no value for "${missingValue}" (it is undefined).`);
					}
					return utils.async_reduce(Object.entries(ExpressionAttributeValues || {}), async (obj, entry) => {
						const [key, value] = entry;
						if (!Item.isDynamoValue(value)) {
							obj.ExpressionAttributeValues[key] = await toDynamo(key, value);
						}
						return obj;
					}, {
						[settings.conditionString]: raw[expressionKey],
						// DynamoDB rejects an empty map, so an expression without names (`id = :id`) or values (`attribute_exists(#a)`) leaves it out.
						...Object.keys(ExpressionAttributeNames).length > 0 ? {"ExpressionAttributeNames": {...ExpressionAttributeNames}} : {},
						...Object.keys(ExpressionAttributeValues || {}).length > 0 ? {"ExpressionAttributeValues": {...ExpressionAttributeValues}} : {}
					});
				};
				// Dynamoose numbers its own names and values (`#a0`, `:v0`), so it starts after the ones a raw condition uses, and neither replaces the other.
				// It also adds suffixes to that number (`#a0_0` for a document path, `:v0_1` for BETWEEN and IN), so a raw `:v0_1` reserves 0 as well.
				const rawIndexes = (input: ConditionStorageSettingsConditions): number[] => input.reduce((indexes: number[], entry) => {
					if (!Array.isArray(entry)) {
						return indexes;
					}
					if (!entry[RAW_GROUP]) {
						return [...indexes, ...rawIndexes(entry)];
					}
					const {ExpressionAttributeNames, ExpressionAttributeValues} = entry[RAW_GROUP];
					return [...indexes, ...[...Object.keys(ExpressionAttributeNames), ...Object.keys(ExpressionAttributeValues || {})].map((key) => (/^(?:#a|:v)(\d+)(?:_\d+)?$/).exec(key)).filter(Boolean).map((match) => parseInt(match[1]) + 1)];
				}, []);

				const {raw} = this.getInternalProperties(internalProperties).settings;
				if (raw && typeof raw === "object" && isRawConditionObject(raw)) {
					if (settings.index) {
						settings.index.set(Math.max(settings.index.start || 0, ...rawIndexes([Object.assign([], {[RAW_GROUP]: raw})])));
					}
					return rawRequestObject(raw as ObjectType);
				} else if (this.getInternalProperties(internalProperties).settings.conditions.length === 0) {
					return {};
				}

				let index = (settings.index || {}).start || 0;
				const setIndex = (i: number): void => {
					index = i; (settings.index || {"set": utils.empty_function}).set(i);
				};
				setIndex(Math.max(index, ...rawIndexes(this.getInternalProperties(internalProperties).settings.conditions)));
				async function main (input: ConditionStorageSettingsConditions): Promise<ConditionRequestObjectResult> {
					return utils.async_reduce(input, async (object: ConditionRequestObjectResult, entry: ConditionStorageTypeNested, i: number, arr: any[]) => {
						let expression = "";
						if (Array.isArray(entry)) {
							const result = entry[RAW_GROUP] ? await rawRequestObject(entry[RAW_GROUP]) : await main(entry);
							// Two raw conditions can't give one name or value placeholder different meanings.
							["ExpressionAttributeNames", "ExpressionAttributeValues"].forEach((property) => {
								Object.entries(result[property] || {}).forEach(([key, value]) => {
									if (key in object[property] && JSON.stringify(object[property][key]) !== JSON.stringify(value)) {
										throw new CustomError.InvalidParameter(`The raw condition uses "${key}" for ${JSON.stringify(value)}, but the condition already uses it for ${JSON.stringify(object[property][key])}. Give each raw condition its own placeholders.`);
									}
								});
							});
							const newData = utils.merge_objects.main({"combineMethod": "object_combine"})({...result}, {...object});
							const returnObject = utils.object.pick(newData, ["ExpressionAttributeNames", "ExpressionAttributeValues"]);

							// A raw condition is one expression, so it is a group of one part.
							const groupExpression = entry[RAW_GROUP] && settings.conditionStringType === "array" ? [result[settings.conditionString]] : result[settings.conditionString];
							expression = settings.conditionStringType === "array" ? groupExpression : `(${groupExpression})`;
							if (entry[NOT_GROUP] && settings.conditionStringType !== "array") {
								expression = `NOT ${expression}`;
							}
							object = {...object, ...returnObject};
						} else if (entry !== OR) {
							const keyConditionObj = Object.entries(entry)[0];
							const key = await model.getInternalProperties(internalProperties).dynamoPropertyForAttribute(keyConditionObj[0]);
							const condition = keyConditionObj[1];
							const {value} = condition;
							const keys = {"name": `#a${index}`, "value": `:v${index}`};
							setIndex(++index);

							const keyParts = key.split(".");
							if (keyParts.length === 1) {
								object.ExpressionAttributeNames[keys.name] = key;
							} else {
								keys.name = keyParts.reduce((finalName, part, index) => {
									const name = `${keys.name}_${index}`;
									object.ExpressionAttributeNames[name] = part;
									finalName.push(name);
									return finalName;
								}, []).join(".");
							}
							// `IN` and `BETWEEN` convert each of their values, and `EXISTS` has none.
							if (["IN", "NOT_IN", "BETWEEN", "NOT_BETWEEN"].includes(condition.type)) {
								// Without a list there are no values to convert, which DynamoDB would otherwise reject.
								if (value === undefined) {
									throw new CustomError.InvalidParameter(`The condition on "${key}" has no value (it is undefined).`);
								}
							} else if (!["EXISTS", "NOT_EXISTS"].includes(condition.type)) {
								object.ExpressionAttributeValues[keys.value] = await toDynamo(key, value);
							}

							switch (condition.type) {
							case "EQ":
							case "NE":
								expression = `${keys.name} ${condition.type === "EQ" ? "=" : "<>"} ${keys.value}`;
								break;
							case "IN":
							case "NOT_IN":
								expression = `${keys.name} IN (${value.map((_v: any, i: number) => `${keys.value}_${i + 1}`).join(", ")})`;
								// DynamoDB has no `NOT IN`, so the comparison is negated as a whole. The same goes for `BETWEEN` and `begins_with` below.
								expression = condition.type === "NOT_IN" ? `NOT (${expression})` : expression;
								await Promise.all(value.map(async (valueItem: any, i: number) => {
									object.ExpressionAttributeValues[`${keys.value}_${i + 1}`] = await toDynamo(key, valueItem);
								}));
								break;
							case "GT":
							case "GE":
							case "LT":
							case "LE":
								expression = `${keys.name} ${condition.type.startsWith("G") ? ">" : "<"}${condition.type.endsWith("E") ? "=" : ""} ${keys.value}`;
								break;
							case "BETWEEN":
							case "NOT_BETWEEN":
								expression = `${condition.type === "NOT_BETWEEN" ? "NOT (" : ""}${keys.name} BETWEEN ${keys.value}_1 AND ${keys.value}_2${condition.type === "NOT_BETWEEN" ? ")" : ""}`;
								object.ExpressionAttributeValues[`${keys.value}_1`] = await toDynamo(key, value[0]);
								object.ExpressionAttributeValues[`${keys.value}_2`] = await toDynamo(key, value[1]);
								break;
							case "CONTAINS":
							case "NOT_CONTAINS":
								expression = `${condition.type === "NOT_CONTAINS" ? "NOT " : ""}contains (${keys.name}, ${keys.value})`;
								break;
							case "EXISTS":
							case "NOT_EXISTS":
								expression = `attribute_${condition.type === "NOT_EXISTS" ? "not_" : ""}exists (${keys.name})`;
								break;
							case "BEGINS_WITH":
							case "NOT_BEGINS_WITH": {
								// DynamoDB rejects `begins_with` with any other operand (`Incorrect operand type for operator or function`).
								const [valueType] = Object.keys(object.ExpressionAttributeValues[keys.value]);
								if (valueType !== "S" && valueType !== "B") {
									throw new CustomError.InvalidParameter(`The beginsWith condition on "${key}" needs a string or binary value, but the value has the DynamoDB type ${valueType}.`);
								}
								expression = `${condition.type === "NOT_BEGINS_WITH" ? "NOT " : ""}begins_with (${keys.name}, ${keys.value})`;
								break;
							}
							}
						} else {
							return object;
						}

						// In an array, a negated group is the item "NOT" followed by the group, which is joined as `NOT (...)`.
						const conditionStringNewItems: string[] = Array.isArray(entry) && entry[NOT_GROUP] && settings.conditionStringType === "array" ? ["NOT", expression] : [expression];
						if (object[settings.conditionString].length > 0) {
							conditionStringNewItems.unshift(` ${arr[i - 1] === OR ? "OR" : "AND"} `);
						}
						conditionStringNewItems.forEach((item) => {
							if (typeof object[settings.conditionString] === "string") {
								object[settings.conditionString] = `${object[settings.conditionString]}${item}`;
							} else {
								object[settings.conditionString].push(Array.isArray(item) ? item : item.trim());
							}
						});

						return object;
					}, {[settings.conditionString]: settings.conditionStringType === "array" ? [] : "", "ExpressionAttributeNames": {}, "ExpressionAttributeValues": {}});
				}

				// DynamoDB rejects an empty `ExpressionAttributeNames` or `ExpressionAttributeValues`, so an empty one is left out. A value in them is kept as it is, even an empty list, map or binary value, which is a value DynamoDB compares with.
				const requestObject = await main(this.getInternalProperties(internalProperties).settings.conditions);
				return Object.entries(requestObject).reduce((result, [key, value]) => {
					if (typeof value !== "object" || Object.keys(value).length > 0) {
						result[key] = value;
					}
					return result;
				}, {});
			},
			"comparisonChart": (model: Model<Item>): Promise<any> => {
				const comparisonChart = this.getInternalProperties(internalProperties).settings.conditions.reduce((res, item) => {
					const myItem = Object.entries(item)[0];
					// A raw condition in a group has no attribute to compare.
					if (!myItem) {
						return res;
					}
					const key = myItem[0];
					res[key] = {"type": (myItem[1] as any).type};
					return res;
				}, {});

				return Item.objectFromSchema(comparisonChart, model, {"type": "toDynamo", "typeCheck": false, "mapAttributes": true});
			}
		});

		if (object instanceof Condition) {
			this.setInternalProperties(internalProperties, {
				...this.getInternalProperties(internalProperties),
				"settings": {...object.getInternalProperties(internalProperties).settings}
			});
		} else {
			this.setInternalProperties(internalProperties, {
				...this.getInternalProperties(internalProperties),
				"settings": {
					"conditions": [],
					"pending": {} // represents the pending chain of filter data waiting to be attached to the `conditions` parameter. For example, storing the key before we know what the comparison operator is.
				}
			});

			if (typeof object === "object") {
				if (!isRawConditionObject(object)) {
					Object.keys(object).forEach((key) => {
						const value = object[key];
						// `{"id": {"le": 5}}` names its comparison; any other value (`{"id": 5}`, a Date, `undefined`, `null`) is compared with `eq`.
						const isComparisonObject = value !== null && typeof value === "object" && Object.keys(value).length > 0;
						const valueType = isComparisonObject ? Object.keys(value)[0] : "eq";
						const comparisonType = types.find((item) => item.name === valueType);

						if (!comparisonType) {
							throw new CustomError.InvalidFilterComparison(`The type: ${valueType} is invalid.`);
						}

						this.getInternalProperties(internalProperties).settings.conditions.push(conditionEntry(key, comparisonType.typeName, isComparisonObject ? value[valueType] : value));
					});
				}
			} else if (object) {
				const internalPropertiesObject = this.getInternalProperties(internalProperties);
				internalPropertiesObject.settings.pending.key = object;
				this.setInternalProperties(internalProperties, internalPropertiesObject);
			}

			const internalPropertiesObject = this.getInternalProperties(internalProperties);
			internalPropertiesObject.settings.raw = object;
			this.setInternalProperties(internalProperties, internalPropertiesObject);
		}

		return this;
	}

	/**
	 * This function specifies an `OR` join between two conditions, as opposed to the default `AND`. The condition will return `true` if either condition is met.
	 *
	 * ```js
	 * new dynamoose.Condition().where("id").eq(1).or().where("name").eq("Bob"); // id = 1 OR name = Bob
	 * ```
	 * @returns Condition
	 */
	or (): Condition {
		this.getInternalProperties(internalProperties).settings.conditions.push(OR);
		return this;
	}
	/**
	 * This function has no behavior and is only used to increase readability of your conditional. This function can be omitted with no behavior change to your code.
	 *
	 * ```js
	 * // The two condition objects below are identical
	 * new dynamoose.Condition().where("id").eq(1).and().where("name").eq("Bob");
	 * new dynamoose.Condition().where("id").eq(1).where("name").eq("Bob");
	 * ```
	 * @returns Condition
	 */
	and (): Condition {
		return this;
	}
	/**
	 * This function sets the condition to use the opposite comparison type for the given condition. You can find the list opposite comparison types below.
	 *
	 * | Original | Opposite |
	 * |---|---|
	 * | equals (EQ) | not equals (NE) |
	 * | less than or equals (LE) | greater than (GT) |
	 * | less than (LT) | greater than or equals (GE) |
	 * | null (NULL) | not null (NOT_NULL) |
	 * | contains (CONTAINS) | not contains (NOT_CONTAINS) |
	 * | exists (EXISTS) | not exists (NOT_EXISTS) |
	 * | in (IN) | `NOT (attribute IN (...))` |
	 * | between (BETWEEN) | `NOT (attribute BETWEEN a AND b)` |
	 * | begins with (BEGINS_WITH) | `NOT begins_with (attribute, value)` |
	 *
	 * Used before `condition.parenthesis()` or `condition.group()`, `not()` negates the whole group: `NOT (...)`.
	 *
	 * A negated condition can't be a key condition, so on a key attribute of the index a query uses it goes in the `FilterExpression`, which DynamoDB rejects (`Filter Expression can only contain non-primary key attributes`). Use it on other attributes, or in a scan.
	 *
	 * ```js
	 * new dynamoose.Condition().where("id").not().eq(1); // Retrieve all objects where id does NOT equal 1
	 * new dynamoose.Condition().where("id").not().in([1, 2]); // NOT (id IN (1, 2))
	 * new dynamoose.Condition().not().parenthesis((condition) => condition.where("status").eq("closed").or().where("archived").eq(true)); // NOT (status = closed OR archived = true)
	 * ```
	 * @returns Condition
	 */
	not (): Condition {
		this.getInternalProperties(internalProperties).settings.pending.not = !this.getInternalProperties(internalProperties).settings.pending.not;
		return this;
	}

	/**
	 * This function takes in a `Condition` instance as a parameter and uses that as a group. This lets you specify the priority of the conditional. You can also pass a function into the `condition` parameter and Dynamoose will call your function with one argument which is a condition instance that you can return to specify the group.
	 *
	 * ```js
	 * // The two condition objects below are identical
	 * new dynamoose.Condition().where("id").eq(1).and().parenthesis(new dynamoose.Condition().where("name").eq("Bob")); // id = 1 AND (name = Bob)
	 * new dynamoose.Condition().where("id").eq(1).and().parenthesis((condition) => condition.where("name").eq("Bob")); // id = 1 AND (name = Bob)
	 * ```
	 *
	 * `condition.group` is an alias to this method.
	 * @param condition A new Condition instance or a function. If a function is passed, it will be called with one argument which is a condition instance that you can return to specify the group.
	 * @returns Condition
	 */
	parenthesis (condition: Condition | ConditionFunction): Condition {
		condition = typeof condition === "function" ? condition(new Condition()) : condition;
		const {conditions, raw} = condition.getInternalProperties(internalProperties).settings;
		const {pending} = this.getInternalProperties(internalProperties).settings;
		// A raw condition has no conditions of its own, only its expression, so the group keeps the raw object.
		const group = raw && typeof raw === "object" && isRawConditionObject(raw) ? Object.assign([], {[RAW_GROUP]: raw}) : conditions;
		// `not()` before a group negates the whole group.
		this.getInternalProperties(internalProperties).settings.conditions.push((pending.not ? Object.assign(group === conditions ? [...conditions] : group, {[NOT_GROUP]: true}) : group) as any);
		delete pending.not;
		return this;
	}
	/**
	 * This function takes in a `Condition` instance as a parameter and uses that as a group. This lets you specify the priority of the conditional. You can also pass a function into the `condition` parameter and Dynamoose will call your function with one argument which is a condition instance that you can return to specify the group.
	 *
	 * ```js
	 * // The two condition objects below are identical
	 * new dynamoose.Condition().where("id").eq(1).and().group(new dynamoose.Condition().where("name").eq("Bob")); // id = 1 AND (name = Bob)
	 * new dynamoose.Condition().where("id").eq(1).and().group((condition) => condition.where("name").eq("Bob")); // id = 1 AND (name = Bob)
	 * ```
	 *
	 * `condition.parenthesis` is an alias to this method.
	 * @param condition A new Condition instance or a function. If a function is passed, it will be called with one argument which is a condition instance that you can return to specify the group.
	 * @returns Condition
	 */
	group (condition: Condition | ConditionFunction): Condition {
		return this.parenthesis(condition);
	}
}

interface ConditionsConditionStorageObject {
	type: ConditionComparisonComparatorDynamoName;
	value: any;
}

function finalizePending (instance: Condition): void {
	const pending = instance.getInternalProperties(internalProperties).settings.pending;

	let dynamoNameType: ConditionComparisonComparatorDynamoName;
	// Every comparison has a negated form, so `not()` can precede any of them.
	if (pending.not === true) {
		dynamoNameType = pending.type.not;
	} else {
		dynamoNameType = pending.type.typeName;
	}

	instance.getInternalProperties(internalProperties).settings.conditions.push(conditionEntry(pending.key, dynamoNameType, pending.value));

	instance.getInternalProperties(internalProperties).settings.pending = {};
}

Condition.prototype.where = Condition.prototype.filter = Condition.prototype.attribute = function (this: Condition, key: string): Condition {
	this.getInternalProperties(internalProperties).settings.pending = {key};
	return this;
};
// Each comparison in `types` is added to the prototype here, so TypeScript only knows it from its declaration in `BasicOperators` (which `Condition`, `Query` and `Scan` extend). This type is `never` when a comparison isn't declared there, so the assignment below fails to compile instead of leaving the method untyped.
type DeclaredComparisonName = Exclude<`${ConditionComparisonComparatorName}`, keyof BasicOperators> extends never ? ConditionComparisonComparatorName : never;
types.forEach((type) => {
	const name: DeclaredComparisonName = type.name;
	Condition.prototype[name] = function (this: Condition, ...args: any[]): Condition {
		this.getInternalProperties(internalProperties).settings.pending.value = type.multipleArguments ? args : args[0];
		this.getInternalProperties(internalProperties).settings.pending.type = type;
		finalizePending(this);
		return this;
	};
});

interface ConditionRequestObjectSettings {
	conditionString: string;
	index?: {
		start: number;
		set: (newIndex: number) => void;
	};
	conditionStringType: "array" | "string";
}
