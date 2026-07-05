# Dynamoose Changelog

---

### Features

- Added support for enabling and configuring DynamoDB Streams through Table options

### Bug Fixes

- Fixed `deep_copy` dropping sibling properties that share the same object reference (e.g. a single `Date` used for both `createdAt` and `updatedAt`, or a single address used for both `billingAddress` and `shippingAddress`). Circular reference detection now tracks only the current ancestor path rather than every object ever visited, which also removes an infinite-recursion risk on self-referencing arrays and a shared-reference leak on class instances containing circular properties
- Fixed conditions on a hash/range key attribute using an operator that is illegal in a DynamoDB `KeyConditionExpression` (`IN`, `NE`, `CONTAINS`, `NOT_CONTAINS`, `EXISTS`, `NOT_EXISTS`) being promoted into the key expression, causing DynamoDB to reject the query with `Invalid operator used in KeyConditionExpression`. Such conditions now remain `FilterExpression`. Promotion is gated by an allowlist (`EQ`, `LE`, `LT`, `GE`, `GT`, `BETWEEN`, `BEGINS_WITH`) shared with the multi-attribute key validation, so single-attribute range keys are protected too
