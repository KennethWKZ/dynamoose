# Dynamoose Changelog

---

### 🚨 Breaking Changes 🚨

- `Item.save` now applies custom type conversion to the item it resolves with, so custom typed attributes (such as `Date`) are returned in the same representation as `Model.get`. Previously `save` resolved with the underlying DynamoDB representation (for example a `number` for `Date` attributes) while `get` resolved with the custom type (a `Date` instance)

### Features

- Added support for enabling and configuring DynamoDB Streams through Table options
- Added a `merge` setting to `Model.update`. Passing `{"merge": true}` updates a nested object in place by writing each provided property to its own document path (`SET attr.sub = :v`), matching how a nested attribute update is expressed against DynamoDB directly, instead of replacing the whole attribute as a map. The default behavior is unchanged
- Added support for enabling table deletion protection through the `deletionProtection` Table option. It is applied on create, and on update it can only be turned on; turning it back off requires `update` to explicitly include `deletionProtection`
- Added support for enabling point-in-time recovery through the `pointInTimeRecovery` Table option, including configuring the recovery window with `pointInTimeRecovery.recoveryPeriodInDays`. As with deletion protection, `update: true` can only turn recovery on; turning it back off requires `update` to explicitly include `pointInTimeRecovery`

### Performance

- Improved performance of converting items returned from `scan` and `query` (~2x faster on large result sets). `Schema` now memoizes `attributes`, `getAttributeValue`, `getAttributeType`, and `getAttributeTypeDetails` per schema, and object flattening no longer re-walks each nested value's subtree to detect circular references
- Improved performance of items containing a long list of attributes with multiple possible types (~4x faster for a 800 element list). Building the type paths for such an item no longer copies the accumulated result once per element

### Bug Fixes

- Fixed `deep_copy` dropping sibling properties that share the same object reference (e.g. a single `Date` used for both `createdAt` and `updatedAt`, or a single address used for both `billingAddress` and `shippingAddress`). Circular reference detection now tracks only the current ancestor path rather than every object ever visited, which also removes an infinite-recursion risk on self-referencing arrays and a shared-reference leak on class instances containing circular properties
- Fixed `Model.update` corrupting arrays, Sets, and Buffers nested inside a map attribute. These values were traversed as if they were nested maps, which produced document paths keyed by array indices or byte offsets, and silently dropped Sets from the update entirely
- Fixed `Item.attributesWithSchema` throwing `node.forEach is not a function` when an object was supplied for an attribute the schema defines as an array
- Fixed `Model.update` rejecting partially specified nested attributes at the type level. Update bodies are now typed as `DeepPartial<T>`
- Fixed the `save` callback being invoked a second time when the supplied callback itself threw an error
- Fixed the `expires` TTL attribute being silently dropped from every model registered against a table after the first. A model attaching to an already-constructed table did not receive the TTL attribute injection the `Table` constructor performs, so its writes stored no TTL attribute at all while DynamoDB continued to report `TimeToLiveStatus: ENABLED`. Affected every table shared by two or more distinct `Schema` objects, across `create`, `transaction.create`, and `update`
- Fixed a global secondary index whose name is unchanged but whose key schema or projection changed being deleted without being recreated. Such an index was only restored on a later `initialize`, leaving the table without it in between. The delete and the recreate are now emitted in the same reconciliation pass, in that order
- Fixed `queriedCount` always being `undefined` on `Model.query` results. The count of items DynamoDB read before applying filters was looked up on the response as `QueriedCount`, a property the DynamoDB API never returns; the `Query` operation reports it as `ScannedCount`, the same as `Scan`. This affected `query.exec`, `query.all`, and `query.count`, in both the array and `count()` response shapes
- Fixed `dynamoose.transaction` get results skipping schema `get` modifiers. Items returned from a `transactGetItems` transaction now run attribute `get` functions the same as `Model.get`, `Model.batchGet`, `Model.query`, and `Model.scan`
- Fixed `Model.update` resolving with an item that skipped schema `get` modifiers. The item returned from the `updateItem` response now runs attribute `get` functions the same as `Model.get`, `Model.batchGet`, `Model.query`, and `Model.scan`
- Fixed `Model.batchGet`, `Model.update` and `dynamoose.transaction` get results not applying the schema `map`/`alias` settings. Items returned from these methods now use the mapped attribute names, the same as `Model.get`, `Model.query`, and `Model.scan`
- Fixed a mapped (`map`/`alias`) attribute being dropped from a returned item when its value was falsy (`0`, `false` or an empty string)
- Fixed `Model.batchGet` throwing `TypeError: Cannot read properties of undefined` when DynamoDB returned an expired item on a table with `expires.items.returnExpired` set to `false`. Expired items are now left out of the result, the same as `Model.query` and `Model.scan`
- Fixed `Model.batchGet` silently leaving out items whose key attribute has a `get` function. Requested keys were matched against the item after its `get` functions ran, so a key stored as `user#1` and returned as `1` never matched; keys are now matched against the item as DynamoDB returned it
- Fixed `Model.batchGet` silently leaving out items, and unprocessed keys, whose key is a `Buffer`. Key values were compared with `===`, which is never true for two `Buffer` instances; they are now compared by content
- Fixed `Date` and `Buffer` key values in `Model.get`, `Model.batchGet`, `Model.delete`, `Model.batchDelete`, `Model.update` and the `Model.transaction` methods. A `Date` or `Buffer` passed as the hash key sent an empty `Key` to DynamoDB, and a `Date` inside a key object threw `Unsupported type passed`. `Date` key values are now converted using the attribute's `storage` setting before the attribute's `set` function runs, the same as when saving an item (previously a key's `set` function received the `Date` itself), and the key types accept `Date` and `Buffer` values. `Model.batchDelete` also now reports unprocessed items whose key is a `Buffer`; key values were compared with `===`, which is never true for two `Buffer` instances

### Other

- Fixed intermittent CI failures in timing-based tests. Timestamp tests now check that the value falls between the time before and after the call instead of within 10ms of a single reading, and the `Scan`/`Query` `all` delay and `Table` TTL wait tests allow for timers firing about 1ms early
