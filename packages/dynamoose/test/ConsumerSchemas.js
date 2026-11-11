const dynamoose = require("../dist");
const CustomError = require("../dist/Error").default;

// Schemas copied from services that use this package, with their structure and settings as they are and neutral names and values. Each one saves a typical item and reads it back, so a change to how one of these shapes converts fails here before a release, not in a service.
// Every expected value was checked against the last release without known conversion bugs for these shapes.

const now = new Date("2026-11-12T00:00:00.000Z");
const nowN = {"N": "1794441600000"};

// Only `Date` is faked, so timestamps are fixed and every other timer still runs.
const fakeDate = () => jest.useFakeTimers({"now": now, "doNotFake": ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"]});

// Saves `input` and reads the item DynamoDB would return back through `Model.get`, as a service does.
async function roundTrip (Model, input, key) {
	const saved = (await new Model(input).save({"return": "request"})).Item;
	let getItemParams;
	dynamoose.aws.ddb.set({
		"getItem": async (params) => {
			getItemParams = params;
			return {"Item": saved};
		}
	});
	const read = await Model.get(key);
	// The item's own attributes, with Dates and Sets as the model returns them (`toJSON` would turn a Date into a string).
	return {saved, "read": {...read}, getItemParams};
}

describe("Consumer schemas", () => {
	beforeEach(() => {
		dynamoose.Table.defaults.set({"create": false, "waitForActive": false});
		fakeDate();
	});
	afterEach(() => {
		dynamoose.aws.ddb.revert();
		dynamoose.Table.defaults.set({});
		jest.useRealTimers();
	});

	describe("Nullable maps that share one schema, kept by saveUnknown", () => {
		const CashPickupDef = {
			"type": [dynamoose.type.NULL, Object],
			"schema": {
				"agentName": {"type": String, "required": true},
				"locationUrl": {"type": String, "required": true}
			}
		};
		const TransactionDef = {
			"orderCreatedAt": {"type": Date, "required": true},
			"payoutMethod": {"type": String, "enum": ["bank_account", "digital_wallet", "cash_pickup"], "required": true},
			"toCurrency": {"type": String, "required": true},
			"toAmount": {"type": Number, "required": true},
			"cashPickup": CashPickupDef
		};
		const RecipientDef = {
			"countryName": {"type": String, "required": true},
			"currencyCode": {"type": String, "required": true},
			"currencyName": {"type": String, "required": true},
			"fullName": {"type": String, "required": true},
			"nativeName": String,
			"accountNo": String,
			"accountName": String
		};
		const OrderDetailsDef = {
			"orderId": {"type": String, "hashKey": true},
			"sk": {"type": String, "rangeKey": true, "map": ["id"], "default": "DETAILS"},
			"orderType": {"type": String, "enum": ["TRANSFER", "EXCHANGE"], "required": true},
			"transaction": {"type": [dynamoose.type.NULL, Object], "schema": TransactionDef},
			"recipient": {"type": [dynamoose.type.NULL, Object], "schema": RecipientDef}
		};
		let Order;
		beforeEach(() => {
			Order = dynamoose.model("ConsumerOrder", new dynamoose.Schema(OrderDetailsDef, {"saveUnknown": ["transaction.**", "recipient.**"], "timestamps": true}));
			new dynamoose.Table("ConsumerOrder", [Order]);
		});

		const recipient = {"countryName": "Philippines", "currencyCode": "PHP", "currencyName": "Philippine Peso", "fullName": "Juan Dela Cruz", "accountNo": "1234567890"};
		const recipientM = {"M": {"countryName": {"S": "Philippines"}, "currencyCode": {"S": "PHP"}, "currencyName": {"S": "Philippine Peso"}, "fullName": {"S": "Juan Dela Cruz"}, "accountNo": {"S": "1234567890"}}};

		it("Should save and read the nested maps, with a Date and a nested nullable map", async () => {
			const transaction = {"orderCreatedAt": new Date("2026-11-01T08:00:00.000Z"), "payoutMethod": "cash_pickup", "toCurrency": "PHP", "toAmount": 1000.5, "cashPickup": {"agentName": "Agent One", "locationUrl": "https://example.com/agent-one"}};
			const {saved, read, getItemParams} = await roundTrip(Order, {"orderId": "ORDER-1", "orderType": "TRANSFER", transaction, recipient}, {"orderId": "ORDER-1", "sk": "DETAILS"});
			expect(saved).toEqual({
				"orderId": {"S": "ORDER-1"},
				"sk": {"S": "DETAILS"},
				"orderType": {"S": "TRANSFER"},
				"transaction": {"M": {
					"orderCreatedAt": {"N": "1793520000000"},
					"payoutMethod": {"S": "cash_pickup"},
					"toCurrency": {"S": "PHP"},
					"toAmount": {"N": "1000.5"},
					"cashPickup": {"M": {"agentName": {"S": "Agent One"}, "locationUrl": {"S": "https://example.com/agent-one"}}}
				}},
				"recipient": recipientM,
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(getItemParams).toEqual({"TableName": "ConsumerOrder", "Key": {"orderId": {"S": "ORDER-1"}, "sk": {"S": "DETAILS"}}});
			expect(read).toEqual({"orderId": "ORDER-1", "id": "DETAILS", "orderType": "TRANSFER", transaction, recipient, "createdAt": now, "updatedAt": now});
		});

		it("Should save and read null for the nullable maps", async () => {
			const transaction = {"orderCreatedAt": new Date("2026-11-01T08:00:00.000Z"), "payoutMethod": "bank_account", "toCurrency": "PHP", "toAmount": 20, "cashPickup": null};
			const {saved, read} = await roundTrip(Order, {"orderId": "ORDER-2", "orderType": "EXCHANGE", transaction, "recipient": null}, {"orderId": "ORDER-2", "sk": "DETAILS"});
			expect(saved).toEqual({
				"orderId": {"S": "ORDER-2"},
				"sk": {"S": "DETAILS"},
				"orderType": {"S": "EXCHANGE"},
				"transaction": {"M": {"orderCreatedAt": {"N": "1793520000000"}, "payoutMethod": {"S": "bank_account"}, "toCurrency": {"S": "PHP"}, "toAmount": {"N": "20"}, "cashPickup": {"NULL": true}}},
				"recipient": {"NULL": true},
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(read).toEqual({"orderId": "ORDER-2", "id": "DETAILS", "orderType": "EXCHANGE", transaction, "recipient": null, "createdAt": now, "updatedAt": now});
		});

		it("Should throw for a missing required attribute of a nullable map", () => {
			return expect(new Order({"orderId": "ORDER-3", "orderType": "TRANSFER", "transaction": {"payoutMethod": "bank_account", "toCurrency": "PHP", "toAmount": 1}}).save({"return": "request"})).rejects.toEqual(new CustomError.ValidationError("transaction.orderCreatedAt is a required property but has no value when trying to save item"));
		});

		it("Should throw for a value of a nullable map's attribute outside its enum", () => {
			return expect(new Order({"orderId": "ORDER-4", "orderType": "TRANSFER", "transaction": {"orderCreatedAt": new Date(0), "payoutMethod": "cheque", "toCurrency": "PHP", "toAmount": 1}}).save({"return": "request"})).rejects.toEqual(new CustomError.ValidationError("transaction.payoutMethod must equal [\"bank_account\",\"digital_wallet\",\"cash_pickup\"], but is set to cheque"));
		});
	});

	describe("Maps without a schema kept by saveUnknown, and lists of maps", () => {
		const RecipientSchema = {
			"to": {"type": String, "required": true},
			"ccEmails": {"type": Array, "schema": [String]},
			"files": {"type": Array, "schema": [String]},
			"attributesData": Object
		};
		const MessageStatusDef = {
			"messageId": {"type": String, "required": true, "hashKey": true},
			"userId": {"type": String, "required": true, "rangeKey": true, "index": [{"name": "userIdCreatedGI", "rangeKey": "createdAt"}, {"name": "userIdSentGI", "rangeKey": "isSent"}, {"name": "userIdChannelGI", "rangeKey": "channel"}]},
			"channel": {"type": String, "required": true, "enum": ["sms", "email", "app"], "index": [{"name": "channelCreatedGI", "rangeKey": "createdAt"}, {"name": "channelSentGI", "rangeKey": "isSent"}, {"name": "channelReferenceGI", "rangeKey": "referenceId"}, {"name": "channelTopicGI", "rangeKey": "topic"}]},
			"category": {"type": String, "enum": ["authentication", "reporting", "transactional", "promotional"]},
			"bulkId": {"type": String, "index": [{"name": "bulkIdCreatedGI", "rangeKey": "createdAt"}, {"name": "bulkIdSentGI", "rangeKey": "isSent"}, {"name": "bulkIdChannelGI", "rangeKey": "channel"}]},
			"isSent": {"type": Number, "default": 0},
			"isRead": {"type": Number, "default": 0},
			"isDeleted": {"type": Number, "default": 0},
			"senderName": {"type": String, "index": [{"name": "senderNameChannelGI", "rangeKey": "channel"}]},
			"sender": {"type": String, "index": [{"name": "senderChannelGI", "rangeKey": "channel"}]},
			"destination": {"type": String, "required": true, "index": [{"name": "destinationChannelGI", "rangeKey": "channel"}, {"name": "destinationSentGI", "rangeKey": "isSent"}]},
			"ccEmails": {"type": Array, "schema": [String]},
			"referenceId": String,
			"notificationId": String,
			"topic": {"type": String, "index": [{"name": "topicCreatedGI", "rangeKey": "createdAt"}, {"name": "topicSentGI", "rangeKey": "isSent"}]},
			"title": String,
			"body": String,
			"message": String,
			"files": {"type": Array, "schema": [String]},
			"data": Object,
			"webhookUrl": String,
			"notifyUrl": String,
			"bounce": [dynamoose.type.NULL, Object],
			"complaint": [dynamoose.type.NULL, Object],
			"delivery": [dynamoose.type.NULL, Object],
			"eumDelivery": [dynamoose.type.NULL, Object],
			"deliveryStatus": {"type": String, "enum": ["DELIVERED", "EXPIRED", "REJECTED", "UNDELIVERABLE", "UNKNOWN"]},
			"reject": [dynamoose.type.NULL, Object],
			"open": [dynamoose.type.NULL, Object],
			"click": {"type": Array, "schema": [Object]},
			"sentAt": Date,
			"readAt": Date,
			"deletedAt": Date,
			"createdDate": {"type": String, "index": [{"name": "messageCreatedGI", "rangeKey": "createdAt"}]}
		};
		const BulkNotificationDef = {
			"bulkId": {"type": String, "required": true, "hashKey": true, "default": () => "GENERATED-BULK-ID", "index": [{"name": "bulkIdCreatedGI", "rangeKey": "createdAt"}, {"name": "bulkIdStatusGI", "rangeKey": "status"}, {"name": "bulkIdReferenceGI", "rangeKey": "referenceId"}]},
			"channel": {"type": String, "required": true, "rangeKey": true, "enum": ["sms", "email", "app"], "index": [{"name": "channelCreatedGI", "rangeKey": "createdAt"}, {"name": "channelStatusGI", "rangeKey": "status"}, {"name": "channelReferenceGI", "rangeKey": "referenceId"}, {"name": "channelTopicGI", "rangeKey": "topic"}]},
			"category": {"type": String, "enum": ["authentication", "reporting", "transactional", "promotional"]},
			"status": {"type": String, "enum": ["pending", "processing", "completed", "cancelled", "failed"], "required": true},
			"description": {"type": String, "required": true},
			"referenceId": {"type": String, "index": [{"name": "referenceIdStatusGI", "rangeKey": "status"}]},
			"recipients": {"type": Array, "required": true, "schema": [{"type": Object, "schema": RecipientSchema}]},
			"topic": {"type": String, "required": true, "index": [{"name": "topicStatusGI", "rangeKey": "status"}, {"name": "topicScheduleGI", "rangeKey": "scheduleAt"}, {"name": "topicCompletedGI", "rangeKey": "completedAt"}]},
			"senderName": String,
			"sender": String,
			"title": String,
			"body": String,
			"message": String,
			"files": {"type": Array, "schema": [String]},
			"data": [dynamoose.type.NULL, Object],
			"webhookUrl": String,
			"notifyUrl": String,
			"scheduleId": String,
			"scheduleAt": Date,
			"processingAt": Date,
			"completedAt": Date,
			"createdDate": {"type": String, "index": [{"name": "bulkNotificationCreatedGI", "rangeKey": "createdAt"}]}
		};
		let Message, Bulk;
		beforeEach(() => {
			Message = dynamoose.model("ConsumerMessage", new dynamoose.Schema(MessageStatusDef, {"saveUnknown": ["data.*", "bounce.**", "complaint.**", "delivery.**", "eumDelivery.**", "reject.**", "open.**", "click.**"], "timestamps": true}));
			new dynamoose.Table("ConsumerMessage", [Message]);
			Bulk = dynamoose.model("ConsumerBulk", new dynamoose.Schema(BulkNotificationDef, {"saveUnknown": ["recipients.**", "data.*"], "timestamps": true}));
			new dynamoose.Table("ConsumerBulk", [Bulk]);
		});

		it("Should keep a provider's event maps and list of maps, and one level of a map saveUnknown names with *", async () => {
			const input = {
				"messageId": "MSG-1",
				"userId": "USER-1",
				"channel": "email",
				"destination": "user@example.com",
				"ccEmails": ["cc@example.com"],
				"title": "Receipt",
				"data": {"amount": "10.00", "meta": {"source": "app"}},
				"bounce": {"bounceType": "Permanent", "bouncedRecipients": [{"emailAddress": "user@example.com", "status": "5.1.1"}]},
				"delivery": null,
				"click": [{"link": "https://example.com/receipt", "linkTags": {"campaign": ["receipt"]}}],
				"sentAt": new Date("2026-11-10T09:30:00.000Z")
			};
			const {saved, read} = await roundTrip(Message, input, {"messageId": "MSG-1", "userId": "USER-1"});
			expect(saved).toEqual({
				"messageId": {"S": "MSG-1"},
				"userId": {"S": "USER-1"},
				"channel": {"S": "email"},
				"destination": {"S": "user@example.com"},
				"ccEmails": {"L": [{"S": "cc@example.com"}]},
				"title": {"S": "Receipt"},
				"data": {"M": {"amount": {"S": "10.00"}, "meta": {"M": {}}}},
				"bounce": {"M": {"bounceType": {"S": "Permanent"}, "bouncedRecipients": {"L": [{"M": {"emailAddress": {"S": "user@example.com"}, "status": {"S": "5.1.1"}}}]}}},
				"delivery": {"NULL": true},
				"click": {"L": [{"M": {"link": {"S": "https://example.com/receipt"}, "linkTags": {"M": {"campaign": {"L": [{"S": "receipt"}]}}}}}]},
				"sentAt": {"N": "1794303000000"},
				"isSent": {"N": "0"},
				"isRead": {"N": "0"},
				"isDeleted": {"N": "0"},
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(read).toEqual({...input, "data": {"amount": "10.00", "meta": {}}, "isSent": 0, "isRead": 0, "isDeleted": 0, "createdAt": now, "updatedAt": now});
		});

		it("Should save a list of maps with a schema, keep their unknown attributes, and fill a hash key's default function", async () => {
			const input = {
				"channel": "sms",
				"status": "pending",
				"description": "Rate alert",
				"topic": "rate-alert",
				"recipients": [
					{"to": "+15550100", "attributesData": {"name": "Ali", "rate": 3.21}, "locale": "en"},
					{"to": "+15550101", "files": ["https://example.com/a.pdf"]}
				],
				"data": null,
				"scheduleAt": new Date("2026-11-10T09:30:00.000Z")
			};
			const {saved, read} = await roundTrip(Bulk, input, {"bulkId": "GENERATED-BULK-ID", "channel": "sms"});
			expect(saved).toEqual({
				"bulkId": {"S": "GENERATED-BULK-ID"},
				"channel": {"S": "sms"},
				"status": {"S": "pending"},
				"description": {"S": "Rate alert"},
				"topic": {"S": "rate-alert"},
				"recipients": {"L": [
					{"M": {"to": {"S": "+15550100"}, "attributesData": {"M": {"name": {"S": "Ali"}, "rate": {"N": "3.21"}}}, "locale": {"S": "en"}}},
					{"M": {"to": {"S": "+15550101"}, "files": {"L": [{"S": "https://example.com/a.pdf"}]}}}
				]},
				"data": {"NULL": true},
				"scheduleAt": {"N": "1794303000000"},
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(read).toEqual({...input, "bulkId": "GENERATED-BULK-ID", "createdAt": now, "updatedAt": now});
		});
	});

	describe("Attribute names with dashes holding nested schemas", () => {
		const AdditionalInfoSchema = {
			"channelCode": String,
			"beneficiaryFirstName": String,
			"beneficiaryLastName": String,
			"beneficiaryPhoneNumber": String,
			"beneficiaryBankName": String,
			"beneficiaryAccountName": String,
			"senderCountryCode": String,
			"senderFirstName": String,
			"senderLastName": String,
			"senderPersonalId": String,
			"senderPersonalIdType": String,
			"remark": String
		};
		const PartnerIdrDetails = {
			"customerNumber": String,
			"additionalInfo": {"type": Object, "schema": AdditionalInfoSchema}
		};
		// A nested schema with an attribute named `type`.
		const PayerInfoSchema = {
			"type": String,
			"name": String,
			"enName": String,
			"idType": String,
			"idNo": String,
			"country": String,
			"province": String,
			"city": String,
			"address": String
		};
		const PartnerUsdDetails = {
			"reqOrderId": String,
			"orderStatus": String,
			"transOrderId": String,
			"purposes": String,
			"remitType": String,
			"receiveId": String,
			"payerInfo": {"type": Object, "schema": PayerInfoSchema}
		};
		const TransactionDetailsDef = {
			"txnId": {"type": String, "required": true, "hashKey": true},
			"sk": {"type": String, "rangeKey": true},
			"referenceId": {"type": String, "required": true, "index": [{"name": "referenceIdCreatedGI", "rangeKey": "createdAt"}]},
			"payoutId": {"type": String, "required": true},
			"status": {"type": String, "required": true, "enum": ["created", "authorizing", "processing", "completed", "failed", "pending_verification"]},
			"txnType": {"type": String, "required": true, "enum": ["payout", "refund"]},
			"totalAmount": {"type": Number, "required": true},
			"remainingAmount": Number,
			"amount": {"type": Number, "required": true},
			"currency": {"type": String, "required": true},
			"country": String,
			"paymentMethod": {"type": String, "enum": ["ibft", "instant", "digital_wallet"]},
			"accountType": String,
			"fromAccountNo": String,
			"toAccountNo": String,
			"bicCode": String,
			"accountTitle": String,
			"payoutPartner": String,
			"partnerTxnId": {"type": String, "index": [{"name": "partnerTxnIdCreatedGI", "rangeKey": "createdAt"}]},
			"partnerRefId": {"type": String, "index": [{"name": "partnerRefIdCreatedGI", "rangeKey": "createdAt"}]},
			"partnerTxnStatus": String,
			"partnerWebhookRes": Object,
			"remark": String,
			"paymentDescription": String,
			"webhookUrl": String,
			"webhookSecret": String,
			"webhookStatus": {"type": String, "enum": ["pending", "success", "failed"]},
			"webhookSentAt": Date,
			"statusChangedAt": Date,
			"response": Object,
			"error": Object,
			"manualUpdate": Object,
			"partner-idr": {"type": Object, "schema": PartnerIdrDetails},
			"partner-usd": {"type": Object, "schema": PartnerUsdDetails},
			"createdDate": {"type": String, "index": [{"name": "txnDetailsCreatedGI", "rangeKey": "createdAt"}]}
		};
		let Transaction;
		beforeEach(() => {
			Transaction = dynamoose.model("ConsumerTransaction", new dynamoose.Schema(TransactionDetailsDef, {"saveUnknown": ["partnerWebhookRes.**", "partner-idr.**", "partner-usd.**", "response.**", "error.**", "manualUpdate.**"], "timestamps": true}));
			new dynamoose.Table("ConsumerTransaction", [Transaction]);
		});

		const base = {"txnId": "TXN-1", "sk": "DETAILS", "referenceId": "REF-1", "payoutId": "PAYOUT-1", "status": "completed", "txnType": "payout", "totalAmount": 100, "amount": 100, "currency": "USD", "paymentMethod": "ibft"};
		const baseItem = {"txnId": {"S": "TXN-1"}, "sk": {"S": "DETAILS"}, "referenceId": {"S": "REF-1"}, "payoutId": {"S": "PAYOUT-1"}, "status": {"S": "completed"}, "txnType": {"S": "payout"}, "totalAmount": {"N": "100"}, "amount": {"N": "100"}, "currency": {"S": "USD"}, "paymentMethod": {"S": "ibft"}};

		it("Should save and read a dashed attribute's nested schema, keeping its unknown attributes and a nested attribute named type", async () => {
			const input = {
				...base,
				"partner-usd": {"reqOrderId": "R-1", "orderStatus": "SUCCESS", "payerInfo": {"type": "individual", "name": "Lee", "country": "US"}, "settlementBatch": "B-7"},
				"partnerWebhookRes": {"code": "00", "detail": {"ref": "P-1", "fees": [1.5, 0.5]}},
				"response": {"ok": true},
				"webhookSentAt": new Date("2026-11-10T09:30:00.000Z")
			};
			const {saved, read} = await roundTrip(Transaction, input, {"txnId": "TXN-1", "sk": "DETAILS"});
			expect(saved).toEqual({
				...baseItem,
				"partner-usd": {"M": {"reqOrderId": {"S": "R-1"}, "orderStatus": {"S": "SUCCESS"}, "payerInfo": {"M": {"type": {"S": "individual"}, "name": {"S": "Lee"}, "country": {"S": "US"}}}, "settlementBatch": {"S": "B-7"}}},
				"partnerWebhookRes": {"M": {"code": {"S": "00"}, "detail": {"M": {"ref": {"S": "P-1"}, "fees": {"L": [{"N": "1.5"}, {"N": "0.5"}]}}}}},
				"response": {"M": {"ok": {"BOOL": true}}},
				"webhookSentAt": {"N": "1794303000000"},
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(read).toEqual({...input, "createdAt": now, "updatedAt": now});
		});

		it("Should save and read a dashed attribute's map nested in its schema", async () => {
			const input = {...base, "partner-idr": {"customerNumber": "C-1", "additionalInfo": {"channelCode": "BANK", "beneficiaryFirstName": "Budi", "remark": "rent"}}};
			const {saved, read} = await roundTrip(Transaction, input, {"txnId": "TXN-1", "sk": "DETAILS"});
			expect(saved).toEqual({
				...baseItem,
				"partner-idr": {"M": {"customerNumber": {"S": "C-1"}, "additionalInfo": {"M": {"channelCode": {"S": "BANK"}, "beneficiaryFirstName": {"S": "Budi"}, "remark": {"S": "rent"}}}}},
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(read).toEqual({...input, "createdAt": now, "updatedAt": now});
		});
	});

	describe("Sets read back as lists, and nested schemas with enums", () => {
		const setAsList = (val) => val instanceof Set ? [...val] : val;
		const CoreProfileDef = {
			"type": Object,
			"schema": {
				"fullName": String,
				"dateOfBirth": String,
				"nationality": String,
				"entityType": {"type": String, "enum": ["person", "business"]},
				"seededByTrustGrade": {"type": String, "enum": ["direct", "third-party", "partner"]}
			}
		};
		const AuditStampDef = {
			"auditKind": {"type": String, "enum": ["merge-decision", "split-decision", "split-raise", "alias-transition", "distinct-parties-decision", "record-revision", "profile-image"], "index": {"name": "auditKindGI", "rangeKey": "createdAt"}},
			"auditRef": {"type": String, "index": {"name": "auditRefGI"}},
			"releaseId": String,
			"sourcePolicyVersion": String
		};
		const MasterEntityDef = {
			"pk": {"type": String, "hashKey": true, "required": true},
			"sk": {"type": String, "rangeKey": true, "required": true, "default": "ENTITY"},
			"masterEntityId": {"type": String, "required": true},
			"status": {"type": String, "enum": ["confirmed", "provisional"], "required": true, "default": "confirmed"},
			"coreProfile": CoreProfileDef,
			"mergedIntoMasterEntityId": String,
			"mergedByMergeId": String,
			"reversingMergeId": String,
			"seq": Number,
			"distinctFrom": {"type": Set, "schema": [String], "get": setAsList},
			"distinctVersion": {"type": Number},
			"refusalVersion": {"type": Number},
			"recordVersion": {"type": Number},
			"receivingMergeIds": {"type": Set, "schema": [String], "get": setAsList},
			"evidenceRefs": {"type": Array, "schema": [String]},
			...AuditStampDef
		};
		let Entity;
		beforeEach(() => {
			Entity = dynamoose.model("ConsumerEntity", new dynamoose.Schema(MasterEntityDef, {"timestamps": true}));
			new dynamoose.Table("ConsumerEntity", [Entity]);
		});

		it("Should save Sets, defaults and a nested schema, drop the nested schema's unknown attributes, and read Sets as lists", async () => {
			const input = {
				"pk": "MASTER#M-1",
				"masterEntityId": "M-1",
				"coreProfile": {"fullName": "Jane Roe", "dateOfBirth": "1990-01-31", "nationality": "US", "entityType": "person", "seededByTrustGrade": "direct", "nickname": "JR"},
				"seq": 3,
				"distinctFrom": ["M-2", "M-3"],
				"receivingMergeIds": new Set(["MERGE-1"]),
				"evidenceRefs": ["EV-1", "EV-2"],
				"auditKind": "merge-decision"
			};
			const {saved, read} = await roundTrip(Entity, input, {"pk": "MASTER#M-1", "sk": "ENTITY"});
			expect(saved).toEqual({
				"pk": {"S": "MASTER#M-1"},
				"sk": {"S": "ENTITY"},
				"masterEntityId": {"S": "M-1"},
				"status": {"S": "confirmed"},
				"coreProfile": {"M": {"fullName": {"S": "Jane Roe"}, "dateOfBirth": {"S": "1990-01-31"}, "nationality": {"S": "US"}, "entityType": {"S": "person"}, "seededByTrustGrade": {"S": "direct"}}},
				"seq": {"N": "3"},
				"distinctFrom": {"SS": ["M-2", "M-3"]},
				"receivingMergeIds": {"SS": ["MERGE-1"]},
				"evidenceRefs": {"L": [{"S": "EV-1"}, {"S": "EV-2"}]},
				"auditKind": {"S": "merge-decision"},
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(read).toEqual({
				"pk": "MASTER#M-1",
				"sk": "ENTITY",
				"masterEntityId": "M-1",
				"status": "confirmed",
				"coreProfile": {"fullName": "Jane Roe", "dateOfBirth": "1990-01-31", "nationality": "US", "entityType": "person", "seededByTrustGrade": "direct"},
				"seq": 3,
				"distinctFrom": ["M-2", "M-3"],
				"receivingMergeIds": ["MERGE-1"],
				"evidenceRefs": ["EV-1", "EV-2"],
				"auditKind": "merge-decision",
				"createdAt": now,
				"updatedAt": now
			});
		});
	});

	describe("Sets of JSON entries, defaults, and indexes over several attributes", () => {
		const tryParseJsonString = (str) => {
			try {
				return JSON.parse(str);
			} catch (error) {
				return str;
			}
		};
		const PaymentDef = {
			"pk": {"type": String, "hashKey": true, "required": true},
			"sk": {"type": String, "rangeKey": true, "required": true},
			"paymentId": {"type": String, "required": true},
			"payerUserId": {"type": String, "required": true},
			"sourceType": {"type": String, "required": true},
			"sourceId": {"type": String, "required": true},
			"provider": {"type": String, "required": true},
			"method": {"type": String, "required": true},
			"captureMethod": {"type": String, "required": true},
			"status": {"type": String, "required": true, "enum": ["created", "requires_action", "authorized", "authorization_cancelled", "capture_scheduled", "captured", "partially_captured", "refund_pending", "partially_refunded", "refunded"]},
			"currency": {"type": String, "required": true},
			"amountAuthorized": {"type": Number, "required": true},
			"amountCaptured": {"type": Number, "default": 0},
			"amountRefunded": {"type": Number, "default": 0},
			"providerPaymentId": {"type": String, "required": true, "index": {"name": "providerPaymentGI"}},
			"providerChargeId": String,
			"providerCaptureBefore": String,
			"cardBrand": String,
			"cardLast4": String,
			"scheduledCaptureAt": String,
			"captureDueKey": {"type": String, "index": {"name": "captureDueGI", "rangeKey": "scheduledCaptureAt"}},
			"settlementAttemptedAt": String,
			"settleDueKey": {"type": String, "index": {"name": "settleDueGI", "rangeKey": "settlementAttemptedAt"}},
			"settleDueCreditsReversal": {"type": Number, "default": 0},
			"settleDueCardRefund": {"type": Number, "default": 0},
			"settleDueCaregiverPayout": {"type": Number, "default": 0},
			"settleDueFeeCard": Number,
			"settleDueCaptureFirst": Boolean,
			"settleDueCreditGrant": Number,
			"settleDueFeeFromCredits": Number,
			"settleDueRefundAttempt": Number,
			"settleDueRefundAt": String,
			"refundFailures": {
				"type": Set,
				"schema": [String],
				"get": (val) => val instanceof Set ? [...val].map((entry) => typeof entry === "string" ? tryParseJsonString(entry) : entry) : val
			},
			"refundFailedKey": {"type": String, "index": {"name": "refundFailedGI", "rangeKey": "refundFailedAt"}},
			"refundFailedAt": {"type": Date},
			"captureNoticeClaimedAt": {"type": Date},
			"captureNoticeOutcome": {"type": String, "enum": ["sent", "skipped-cancelled", "notify-failed"]},
			"cancelSettledNoticeAt": {"type": Date},
			"exportMonth": String
		};
		const paymentSettings = {
			"timestamps": true,
			"indexes": {
				"global": [
					{"name": "sourceGI", "hashKey": ["sourceType", "sourceId"], "rangeKey": ["createdAt"]},
					{
						"name": "paymentMonthGI",
						"hashKey": ["exportMonth"],
						"rangeKey": ["createdAt", "paymentId"],
						"project": ["paymentId", "payerUserId", "sourceType", "sourceId", "provider", "method", "status", "currency", "amountAuthorized", "amountCaptured", "amountRefunded", "providerPaymentId", "providerChargeId", "createdAt"]
					}
				]
			}
		};
		let Payment, table;
		beforeEach(() => {
			Payment = dynamoose.model("ConsumerPayment", new dynamoose.Schema(PaymentDef, paymentSettings));
			table = new dynamoose.Table("ConsumerPayment", [Payment]);
		});

		it("Should save defaults and a Set of JSON entries, and read the entries back parsed", async () => {
			const input = {
				"pk": "PAYMENT#P-1",
				"sk": "PAYMENT",
				"paymentId": "P-1",
				"payerUserId": "U-1",
				"sourceType": "booking",
				"sourceId": "B-1",
				"provider": "card-provider",
				"method": "card",
				"captureMethod": "manual",
				"status": "refund_pending",
				"currency": "USD",
				"amountAuthorized": 120,
				"providerPaymentId": "pi_1",
				"refundFailures": [JSON.stringify({"refundId": "re_1", "reason": "expired_card"}), "not json"],
				"refundFailedKey": "REFUND_FAILED",
				"refundFailedAt": new Date("2026-11-10T09:30:00.000Z"),
				"exportMonth": "2026-11"
			};
			const {saved, read} = await roundTrip(Payment, input, {"pk": "PAYMENT#P-1", "sk": "PAYMENT"});
			expect(saved).toEqual({
				"pk": {"S": "PAYMENT#P-1"},
				"sk": {"S": "PAYMENT"},
				"paymentId": {"S": "P-1"},
				"payerUserId": {"S": "U-1"},
				"sourceType": {"S": "booking"},
				"sourceId": {"S": "B-1"},
				"provider": {"S": "card-provider"},
				"method": {"S": "card"},
				"captureMethod": {"S": "manual"},
				"status": {"S": "refund_pending"},
				"currency": {"S": "USD"},
				"amountAuthorized": {"N": "120"},
				"amountCaptured": {"N": "0"},
				"amountRefunded": {"N": "0"},
				"providerPaymentId": {"S": "pi_1"},
				"settleDueCreditsReversal": {"N": "0"},
				"settleDueCardRefund": {"N": "0"},
				"settleDueCaregiverPayout": {"N": "0"},
				"refundFailures": {"SS": ["{\"refundId\":\"re_1\",\"reason\":\"expired_card\"}", "not json"]},
				"refundFailedKey": {"S": "REFUND_FAILED"},
				"refundFailedAt": {"N": "1794303000000"},
				"exportMonth": {"S": "2026-11"},
				"createdAt": nowN,
				"updatedAt": nowN
			});
			expect(read).toEqual({
				...input,
				"amountCaptured": 0,
				"amountRefunded": 0,
				"settleDueCreditsReversal": 0,
				"settleDueCardRefund": 0,
				"settleDueCaregiverPayout": 0,
				"refundFailures": [{"refundId": "re_1", "reason": "expired_card"}, "not json"],
				"createdAt": now,
				"updatedAt": now
			});
		});

		it("Should create the table with the attribute and schema-level indexes, including keys over several attributes", async () => {
			const request = await table.create({"return": "request"});
			expect(request.AttributeDefinitions).toEqual(expect.arrayContaining([
				{"AttributeName": "pk", "AttributeType": "S"},
				{"AttributeName": "sk", "AttributeType": "S"},
				{"AttributeName": "sourceType", "AttributeType": "S"},
				{"AttributeName": "sourceId", "AttributeType": "S"},
				{"AttributeName": "createdAt", "AttributeType": "N"},
				{"AttributeName": "exportMonth", "AttributeType": "S"},
				{"AttributeName": "paymentId", "AttributeType": "S"},
				{"AttributeName": "providerPaymentId", "AttributeType": "S"},
				{"AttributeName": "captureDueKey", "AttributeType": "S"},
				{"AttributeName": "scheduledCaptureAt", "AttributeType": "S"},
				{"AttributeName": "settleDueKey", "AttributeType": "S"},
				{"AttributeName": "settlementAttemptedAt", "AttributeType": "S"},
				{"AttributeName": "refundFailedKey", "AttributeType": "S"},
				{"AttributeName": "refundFailedAt", "AttributeType": "N"}
			]));
			expect(request.AttributeDefinitions).toHaveLength(14);
			expect(request.KeySchema).toEqual([{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}]);
			const indexes = Object.fromEntries(request.GlobalSecondaryIndexes.map((index) => [index.IndexName, index]));
			expect(Object.keys(indexes).sort()).toEqual(["captureDueGI", "paymentMonthGI", "providerPaymentGI", "refundFailedGI", "settleDueGI", "sourceGI"]);
			expect(indexes.sourceGI.KeySchema).toEqual([{"AttributeName": "sourceType", "KeyType": "HASH"}, {"AttributeName": "sourceId", "KeyType": "HASH"}, {"AttributeName": "createdAt", "KeyType": "RANGE"}]);
			expect(indexes.sourceGI.Projection).toEqual({"ProjectionType": "ALL"});
			expect(indexes.paymentMonthGI.KeySchema).toEqual([{"AttributeName": "exportMonth", "KeyType": "HASH"}, {"AttributeName": "createdAt", "KeyType": "RANGE"}, {"AttributeName": "paymentId", "KeyType": "RANGE"}]);
			// The `project` list is sent as it is, key attributes included.
			expect(indexes.paymentMonthGI.Projection).toEqual({"ProjectionType": "INCLUDE", "NonKeyAttributes": paymentSettings.indexes.global[1].project});
			expect(indexes.captureDueGI.KeySchema).toEqual([{"AttributeName": "captureDueKey", "KeyType": "HASH"}, {"AttributeName": "scheduledCaptureAt", "KeyType": "RANGE"}]);
			expect(indexes.providerPaymentGI.KeySchema).toEqual([{"AttributeName": "providerPaymentId", "KeyType": "HASH"}]);
		});
	});
});
