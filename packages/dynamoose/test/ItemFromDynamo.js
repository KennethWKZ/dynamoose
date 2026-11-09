const dynamoose = require("../dist");
const CustomError = require("../dist/Error").default;

describe("model.itemFromDynamo", () => {
	let User;
	beforeEach(() => {
		dynamoose.Table.defaults.set({"create": false, "waitForActive": false});
		User = dynamoose.model("User", new dynamoose.Schema({
			"id": Number,
			"name": {"type": String, "get": (value) => value.toUpperCase()},
			"seen": {"type": {"value": Date, "settings": {"storage": "iso"}}},
			"tags": {"type": Set, "schema": [String]},
			"nick": {"type": String, "map": "nickname"}
		}, {"timestamps": true}));
		new dynamoose.Table("User", [User]);
	});
	afterEach(() => {
		dynamoose.Table.defaults.set({});
	});

	const image = {
		"id": {"N": "1"},
		"name": {"S": "bob"},
		"seen": {"S": "2023-11-14T22:13:20.000Z"},
		"tags": {"SS": ["a", "b"]},
		"nick": {"S": "bobby"},
		"createdAt": {"N": "1700000000000"},
		"updatedAt": {"N": "1700000000000"}
	};

	it("Should be a function", () => {
		expect(User.itemFromDynamo).toBeInstanceOf(Function);
	});

	it("Should convert a DynamoDB item like Model.get does", async () => {
		const item = await User.itemFromDynamo(image);
		expect(item).toBeInstanceOf(User);
		expect(item.id).toEqual(1);
		expect(item.name).toEqual("BOB");
		expect(item.seen).toEqual(new Date(1700000000000));
		expect(item.createdAt).toEqual(new Date(1700000000000));
		expect(item.tags).toEqual(new Set(["a", "b"]));
		expect(item.nickname).toEqual("bobby");
	});

	it("Should convert an item whose expires time has passed", async () => {
		const Session = dynamoose.model("Session", {"id": String}, {"expires": 1000});
		new dynamoose.Table("Session", [Session], {"expires": 1000});
		const item = await Session.itemFromDynamo({"id": {"S": "s1"}, "ttl": {"N": "1"}});
		expect(item.id).toEqual("s1");
	});

	it("Should convert binary values a Lambda event has as base64 strings", async () => {
		const File = dynamoose.model("File", {"id": String, "data": Buffer, "parts": {"type": Set, "schema": [Buffer]}, "list": {"type": Array, "schema": [Buffer]}});
		new dynamoose.Table("File", [File]);
		const item = await File.itemFromDynamo({"id": {"S": "f1"}, "data": {"B": "aGk="}, "parts": {"BS": ["YQ==", "Yg=="]}, "list": {"L": [{"B": "aGk="}]}});
		expect(item.data).toEqual(Buffer.from("hi"));
		expect(item.parts).toEqual(new Set([Buffer.from("a"), Buffer.from("b")]));
		expect(item.list).toEqual([Buffer.from("hi")]);
	});

	it("Should convert binary values inside a map a Lambda event has as base64 strings", async () => {
		const File = dynamoose.model("File", {"id": String, "meta": {"type": Object, "schema": {"blob": Buffer, "name": String, "inner": {"type": Object, "schema": {"blob": Buffer}}}}});
		new dynamoose.Table("File", [File]);
		const item = await File.itemFromDynamo({"id": {"S": "f1"}, "meta": {"M": {"blob": {"B": "aGk="}, "name": {"S": "a"}, "inner": {"M": {"blob": {"B": "Yg=="}}}}}});
		expect(item.meta).toEqual({"blob": Buffer.from("hi"), "name": "a", "inner": {"blob": Buffer.from("b")}});
	});

	it("Should keep binary values that are already bytes, as in an AWS SDK item", async () => {
		const File = dynamoose.model("File", {"id": String, "data": Buffer, "parts": {"type": Set, "schema": [Buffer]}});
		new dynamoose.Table("File", [File]);
		const item = await File.itemFromDynamo({"id": {"S": "f1"}, "data": {"B": new Uint8Array([104, 105])}, "parts": {"BS": [new Uint8Array([97]), new Uint8Array([98])]}});
		expect(Buffer.from(item.data)).toEqual(Buffer.from("hi"));
		expect([...item.parts].map((part) => Buffer.from(part))).toEqual([Buffer.from("a"), Buffer.from("b")]);
	});

	it("Should return undefined for an empty image", async () => {
		expect(await User.itemFromDynamo(undefined)).toEqual(undefined);
	});

	it("Should throw an error for something that isn't a DynamoDB item", async () => {
		await expect(User.itemFromDynamo({"id": 1})).rejects.toEqual(new CustomError.InvalidParameter("itemFromDynamo takes an item in DynamoDB's format, such as {\"id\": {\"N\": \"1\"}}."));
	});

	it("Should throw an error for a DynamoDB item with a null value inside", async () => {
		const error = new CustomError.InvalidParameter("itemFromDynamo takes an item in DynamoDB's format, such as {\"id\": {\"N\": \"1\"}}.");
		await expect(User.itemFromDynamo({"id": {"N": "1"}, "a": {"M": null}})).rejects.toEqual(error);
		await expect(User.itemFromDynamo({"id": {"N": "1"}, "a": {"L": [null]}})).rejects.toEqual(error);
		await expect(User.itemFromDynamo({"id": {"N": "1"}, "a": {"M": {"b": {"S": null}}}})).rejects.toEqual(error);
	});

	it("Should not change the image passed in", async () => {
		const copy = JSON.parse(JSON.stringify(image));
		await User.itemFromDynamo(copy);
		expect(copy).toEqual(image);
	});
});
