# Dynamoose Changelog

---

### Features

- Added support for enabling and configuring DynamoDB Streams through Table options
- `$ADD` on a list attribute in `Model.update` and `Model.transaction.update` now creates the list when the item doesn't have it yet, or when the update creates the item. Before, such an update failed with `ValidationException: The provided expression refers to an attribute that does not exist in the item`. A list is now appended with `SET #a0 = list_append(if_not_exists(#a0, :v1), :v0)`, so a missing list starts out empty. When an update appends to a list, the request has one more value, an empty list (`{"L": []}`) numbered after the update's other values

### Bug Fixes

- Fixed `deep_copy` dropping sibling properties that share the same object reference (e.g. a single `Date` used for both `createdAt` and `updatedAt`, or a single address used for both `billingAddress` and `shippingAddress`). Circular reference detection now tracks only the current ancestor path rather than every object ever visited, which also removes an infinite-recursion risk on self-referencing arrays and a shared-reference leak on class instances containing circular properties
- Fixed `dynamoose.transaction` get results skipping schema `get` modifiers. Items returned from a `transactGetItems` transaction now run attribute `get` functions the same as `Model.get`, `Model.batchGet`, `Model.query`, and `Model.scan`
