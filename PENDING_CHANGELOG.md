# Dynamoose Changelog

---

### Features

- Added support for enabling and configuring DynamoDB Streams through Table options
- Added support for enabling table deletion protection through the `deletionProtection` Table option (applied on create and reconciled on update)
- Added support for enabling point-in-time recovery through the `pointInTimeRecovery` Table option, including configuring the recovery window with `pointInTimeRecovery.recoveryPeriodInDays`

### Bug Fixes

- Fixed `deep_copy` dropping sibling properties that share the same object reference (e.g. a single `Date` used for both `createdAt` and `updatedAt`, or a single address used for both `billingAddress` and `shippingAddress`). Circular reference detection now tracks only the current ancestor path rather than every object ever visited, which also removes an infinite-recursion risk on self-referencing arrays and a shared-reference leak on class instances containing circular properties
