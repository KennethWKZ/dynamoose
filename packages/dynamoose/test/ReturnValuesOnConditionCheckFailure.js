const dynamoose = require("../dist");
const util = require("util");
const CustomError = require("../dist/Error").default;

describe("returnValuesOnConditionCheckFailure", () => {
	const conditionFailed = (item) => Object.assign(new Error("The conditional request failed"), {"name": "ConditionalCheckFailedException", ...item ? {"Item": item} : {}});
	let User, calls, response;
	beforeEach(() => {
		dynamoose.Table.defaults.set({"create": false, "waitForActive": false});
		User = dynamoose.model("User", {"id": Number, "name": {"type": String, "get": (value) => value.toUpperCase()}, "version": Number});
		new dynamoose.Table("User", [User]);
		calls = {};
		response = {};
		const mock = (method) => (params) => {
			calls[method] = params;
			const result = response[method];
			return result instanceof Error ? Promise.reject(result) : Promise.resolve(result || {});
		};
		dynamoose.aws.ddb.set({"updateItem": mock("updateItem"), "putItem": mock("putItem"), "deleteItem": mock("deleteItem")});
	});
	afterEach(() => {
		dynamoose.Table.defaults.set({});
		dynamoose.aws.ddb.revert();
	});

	const condition = () => new dynamoose.Condition("version").eq(1);
	const operations = [
		{"name": "Model.update", "method": "updateItem", "run": (callType, settings) => callType.func(User.update).bind(User)({"id": 1}, {"name": "Tim"}, {"condition": condition(), ...settings})},
		{"name": "Model.create", "method": "putItem", "run": (callType, settings) => callType.func(User.create).bind(User)({"id": 1, "name": "Tim"}, {...settings})},
		{"name": "item.save", "method": "putItem", "run": (callType, settings) => {
			const item = new User({"id": 1, "name": "Tim"});
			return callType.func(item.save).bind(item)({"condition": condition(), ...settings});
		}},
		{"name": "Model.delete", "method": "deleteItem", "run": (callType, settings) => callType.func(User.delete).bind(User)({"id": 1}, {"condition": condition(), ...settings})}
	];
	const functionCallTypes = [
		{"name": "Promise", "func": (func) => func},
		{"name": "Callback", "func": (func) => util.promisify(func)}
	];

	operations.forEach((operation) => {
		describe(operation.name, () => {
			functionCallTypes.forEach((callType) => {
				describe(callType.name, () => {
					it("Should send ReturnValuesOnConditionCheckFailure", async () => {
						await operation.run(callType, {"returnValuesOnConditionCheckFailure": "ALL_OLD"});
						expect(calls[operation.method].ReturnValuesOnConditionCheckFailure).toEqual("ALL_OLD");
					});

					it("Should not send it without the setting", async () => {
						await operation.run(callType, {});
						expect(Object.keys(calls[operation.method])).not.toContain("ReturnValuesOnConditionCheckFailure");
					});

					it("Should add the stored item to the error when the condition fails", async () => {
						const error = conditionFailed({"id": {"N": "1"}, "name": {"S": "bob"}, "version": {"N": "4"}});
						response[operation.method] = error;
						const result = await operation.run(callType, {"returnValuesOnConditionCheckFailure": "ALL_OLD"}).catch((e) => e);
						expect(result).toBe(error);
						expect(result.conditionCheckFailureItem.constructor.name).toEqual("User");
						expect(result.conditionCheckFailureItem.toJSON()).toEqual({"id": 1, "name": "BOB", "version": 4});
					});

					it("Should throw the error unchanged when no item is returned", async () => {
						const error = conditionFailed();
						response[operation.method] = error;
						const result = await operation.run(callType, {"returnValuesOnConditionCheckFailure": "ALL_OLD"}).catch((e) => e);
						expect(result).toBe(error);
						expect(Object.keys(result)).not.toContain("conditionCheckFailureItem");
					});

					it("Should throw an error for an invalid value", async () => {
						const result = await operation.run(callType, {"returnValuesOnConditionCheckFailure": "ALL_NEW"}).catch((e) => e);
						expect(result).toEqual(new CustomError.InvalidParameter("Invalid returnValuesOnConditionCheckFailure option, please pass in \"ALL_OLD\" or \"NONE\"."));
					});
				});
			});
		});
	});

	it("Should throw the original error unchanged if the stored item can't be converted", async () => {
		const Strict = dynamoose.model("Strict", {"id": Number, "name": {"type": String, "get": () => {
			throw new Error("get failed");
		}}});
		new dynamoose.Table("Strict", [Strict]);
		const error = conditionFailed({"id": {"N": "1"}, "name": {"S": "bob"}});
		response.updateItem = error;
		const result = await Strict.update({"id": 1}, {"name": "Tim"}, {"returnValuesOnConditionCheckFailure": "ALL_OLD"}).catch((e) => e);
		expect(result).toBe(error);
		expect(Object.keys(result)).not.toContain("conditionCheckFailureItem");
	});

	describe("Model.transaction", () => {
		it("Should keep the setting on the update request of a transaction", async () => {
			const request = await User.transaction.update({"id": 1}, {"name": "Tim"}, {"condition": condition(), "returnValuesOnConditionCheckFailure": "ALL_OLD"});
			expect(request.Update.ReturnValuesOnConditionCheckFailure).toEqual("ALL_OLD");
			expect(Object.keys(request.Update)).not.toContain("ReturnValues");
		});

		it("Should keep the setting on the create and delete requests of a transaction", async () => {
			expect((await User.transaction.create({"id": 1}, {"returnValuesOnConditionCheckFailure": "ALL_OLD"})).Put.ReturnValuesOnConditionCheckFailure).toEqual("ALL_OLD");
			expect((await User.transaction.delete({"id": 1}, {"condition": condition(), "returnValuesOnConditionCheckFailure": "ALL_OLD"})).Delete.ReturnValuesOnConditionCheckFailure).toEqual("ALL_OLD");
		});
	});
});
