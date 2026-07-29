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
