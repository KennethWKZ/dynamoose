# Dynamoose Changelog

---

### Features

- Added support for enabling and configuring DynamoDB Streams through Table options
- Added support for enabling table deletion protection through the `deletionProtection` Table option (applied on create and reconciled on update)
- Added support for enabling point-in-time recovery through the `pointInTimeRecovery` Table option, including configuring the recovery window with `pointInTimeRecovery.recoveryPeriodInDays`

### Performance

- Improved the performance of converting DynamoDB items into `Model` instances — the work behind every `scan`, `query`, `get`, `batchGet`, and transaction read — by roughly 2.4x on deeply nested schemas. Schema type introspection (`getAttributeType`, `getAttributeTypeDetails`, `getAttributeValue`, and the attribute list) is now memoized per schema instead of being recomputed for every item, and a linear-time object flattening replaces a quadratic one on the conversion hot path. This is an internal optimization with no change to behavior or public API ([#1719](https://github.com/dynamoose/dynamoose/issues/1719))

### Bug Fixes

- Fixed `deep_copy` dropping sibling properties that share the same object reference (e.g. a single `Date` used for both `createdAt` and `updatedAt`, or a single address used for both `billingAddress` and `shippingAddress`). Circular reference detection now tracks only the current ancestor path rather than every object ever visited, which also removes an infinite-recursion risk on self-referencing arrays and a shared-reference leak on class instances containing circular properties
- Fixed conditions on a hash/range key attribute using an operator that is illegal in a DynamoDB `KeyConditionExpression` (`IN`, `NE`, `CONTAINS`, `NOT_CONTAINS`, `EXISTS`, `NOT_EXISTS`) being promoted into the key expression, causing DynamoDB to reject the query with `Invalid operator used in KeyConditionExpression`. Such conditions now remain `FilterExpression`. Promotion is gated by an allowlist (`EQ`, `LE`, `LT`, `GE`, `GT`, `BETWEEN`, `BEGINS_WITH`) shared with the multi-attribute key validation, so single-attribute range keys are protected too
- chore: consolidate to root lockfile and move AWS SDK to peerDependencies
