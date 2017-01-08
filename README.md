# JsonSync

*Transport-agnostic operation-rich peer-to-peer JSON synchronization*

Derived from the [Canop paper][].

[Canop paper]: https://github.com/espadrine/canop/blob/master/doc/paper.md

```js
var JsonSync = require('jsonsync')
// network must have network.on('connect', function(node))
// and network.on('disconnect', function(node)),
// network.nodes must be an array of Nodes,
// which have node.send(string), node.on('receive', function(string)).
var data = new JsonSync({network: network})
// Showing changes.
data.on('update', updateView)
// Performing a local change.
data.add('/comments/-', "This article was flabberghasting.")
data.remove('/comments/0')
```

- Browser and Node.js
- Client-client, client-server, peer-to-peer networks
- Relies on [JSON Patch][]
- Supports atomic compound operations

[JSON Patch]: http://jsonpatch.com/

Please note that this is not ready for production. The protocol, in particular,
is subject to change. On the other hand, for demos and personal projects, go
right away!

## API

- `.add(path, value)` on objects, lists and strings.
- `.remove(path, optional count)` on objects, lists and strings.
  `count` is only meaningful for strings.
- `.replace(path, value)` on objects and lists.
- `.move(fromPath, toPath)` on objects and lists.
- `data.on('update', function callback(changes))`: runs the callback every time
  a foreign change in the data occurs. `changes` is a [JSON Patch][].

To perform an atomic compound transaction, ie. a sequence of operations that:

1. must happen in that order with no concurrent operation inserted within them,
2. must not partially apply; all operations must modify the data as intended:

```js
var value = data.get(origin)
var op = data.remove(origin)             // First operation
data.replace(target, value, {after: op}) // Second operation
```

## Cons

Currently, we do not guarantee intention preservation. Operations are not
rebased to readjust indices based on concurrent operations. This precludes its
use for character-by-character concurrent text editing. There is hope, however.

There is no lazy loading of huge lists. You get the whole JSON, and it has to be
fully loaded on your node. If some JSON objects are too big, you can separate
them into several JsonSync objects. For instance, if you have a chat app, you
would have a separate object for each 10k messages, and your app could fetch the
previous batch if it needs to go further in history.

Currently, you need to keep (and download) the whole history. We will make it
possible in the future to also support automatic deletion of history that all
nodes have in common, but if you enable that, it will preclude normal offline
editing. (You will be able to do offline editing by performing a [JSON diff][]
when you reconnect, but your operations may be severely
non-intention-preserving, requiring manual verification.)

[JSON diff]: https://github.com/espadrine/json-diff

## Integration

    ┌──────────┐ action ┌───────┐
    │CONTROLLER├───────→│       │ broadcast ┌─────────┐
    └──────────┘        │ JSON  │←─────────→│ NETWORK │
    ┌──────────┐ update │ MODEL │           └─────────┘
    │   VIEW   │←───────┤       │
    └──────────┘        └───────┘

## JSON Patch extensions used

- `mark`: a list of integers providing a unique timestamp.
- `was`: stores the old value of a destructive operation. It allows performing
  undo without having to recompute everything from the beginning.
- string add and remove: allows string editing.
- `arithmetic`: (planned) supports performing operations on numbers. For
  instance, `{op: "arithmetic", path: "/score", value: "max(2*x^2, y)",
  var: {y: "/minScore"}`.

**Warnings**: (mostly designed to ensure operational reversibility)

1. The use of the `add` operation on objects is strictly meant for the
   addition of a brand new key. JSON operations that perform an add on an object
   where the key already exists perform no modification. Use `replace` to update
   the value of a key.
2. The `copy` and `move` operations must not have `path` be a proper prefix of
   the `from` location; ie., a location cannot be moved nor copied to one of its
   ancestors. Similarly, they must not have `from` be a proper prefix of the
   `path` location. (For move operations, the latter
   [is already enforced][rfc6902 move] by the JSON Patch specification.)
   Finally, they must never overwrite a value.

[rfc6902 move]: https://tools.ietf.org/html/rfc6902#section-4.4

## TODO

- Rebase indices (for strings first, and for lists).
