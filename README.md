# JsonSync

*Transport-agnostic operation-rich peer-to-peer JSON synchronization*

Derived from the [Canop paper][].

[Canop paper]: https://github.com/espadrine/canop/blob/master/doc/paper.md

```js
var JsonSync = require('jsonsync')
var data = new JsonSync()
// Showing changes.
data.on('update', updateView)
// Sending a change to other nodes.
data.on('broadcast', diff => network.broadcast(diff))
// Receiving a change from a different node.
network.on('update', diff => data.patch(diff))
// Performing a local change.
data.add('/comments/-', "This article was flabberghasting.")
```

- Browser and Node.js
- Client-client, client-server, peer-to-peer networks
- Relies on [JSON Patch][]
- Supports atomic compound operations

[JSON Patch]: http://jsonpatch.com/

Please note that this is not ready for production. The protocol, in particular,
is subject to change. On the other hand, for demos and personal projects, go
right away!

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
- string add and remove: (planned) allows string editing.
- `arithmetic`: (planned) supports performing operations on numbers. For
  instance, `{op: "arithmetic", path: "/score", value: "max(2*x^2, y)",
  var: {y: "/minScore"}`.
