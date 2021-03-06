var assert = require('assert')
var JsonSync = require('..')
var Networks = require('./network.js')

// Set up n nodes.
function setup(n, value) {
  var networks = new Networks()
  var network = []
  var node = []

  for (var i = 0; i < n; i++) {
    network.push(networks.addNode())
  }
  // We separate the addition of node so that we needn't send connect events.
  for (var i = 0; i < n; i++) {
    node.push(new JsonSync({
      network: network[i],
      value: JsonSync.cloneValue(value),
      machine: [i]}))
  }

  return {
    network: network,
    networks: networks,
    node: node
  }
}

var network, networks, node

;({network, networks, node} = setup(2, {}))
node[0].add('/hello', 'world')
networks.flush(0, 1)
assert.equal(node[1].content.hello, 'world',
  'One-way transmission of addition')

;({network, networks, node} = setup(2, {}))
node[1].remove('/hello')
networks.flush(1, 0)
assert.equal(node[1].content.hello, undefined,
  'One-way transmission of removal')

;({network, networks, node} = setup(2, {}))
node[0].add('/concurrent', 'update')
node[1].add('/concurrent', 'change')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[1].content.concurrent, 'update',
  'Concurrent two-way addition')

;({network, networks, node} = setup(2, {}))
node[0].remove('/concurrent')
node[1].remove('/concurrent')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[0].content.concurrent, undefined,
  'Concurrent two-way removal')

;({network, networks, node} = setup(2, {}))
node[0].add('/hello', 'world')
networks.flush(0, 1)
node[1].replace('/hello', 'there')
networks.flush(1, 0)
assert.equal(node[0].content.hello, 'there',
  'One-way transmission of object replacement')

;({network, networks, node} = setup(2, {}))
node[0].add('/hello', 'world')
node[0].localAdd(['hello'], 'there')
assert.equal(node[0].content.hello, 'world',
  "Adding existing keys don't perform a replacement")
node[0].localAdd([], 'world')
assert.notStrictEqual(node[0].content, 'world',
  "Adding the root when it exists doesn't perform a replacement")

;({network, networks, node} = setup(2, {}))
node[0].localReplace(['hello'], 'world')
assert.equal(node[0].content.hello, undefined,
  "Replacing an inexistent key doesn't perform an addition")
node[0].content = undefined
node[0].localReplace([], 'world')
assert.equal(node[0].content, undefined,
  "Replacing the root when it doesn't exist doesn't perform a replacement")

;({network, networks, node} = setup(2, {}))
node[0].replace('', {hello: {dear: 'world'}, hi: {my: 'dear'}})
networks.flush(0, 1)
node[0].move('/hello', '/hi/there')
node[1].move('/hi', '/hello/howdy')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[1].content.hi.there.dear, 'world',
  "Simultaneous moving")

;({network, networks, node} = setup(2, {}))
node[0].replace('', {hello: {}, hi: {my: 'dear'}})
networks.flush(0, 1)
node[0].move('', '/hello/world')
node[1].move('/hi', '')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[1].content.hi.my, 'dear',
  "Moving to a subtree or to an ancestor should fail")

;({network, networks, node} = setup(2, {}))
node[0].replace('', {hello: 'world'})
networks.flush(0, 1)
node[0].add('/hello/0', 'hello ')
node[1].add('/hello/-', '!')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[0].content.hello, 'hello world!',
  "Concurrent string addition")

;({network, networks, node} = setup(2, {}))
node[0].replace('', 'world')
node[0].add('/0', 'hello ')
assert.equal(node[0].content, 'hello world',
  "Root string addition")

;({network, networks, node} = setup(2, {}))
node[0].replace('', {hello: 'world'})
networks.flush(0, 1)
node[1].add('/hello/0', 'go')
node[0].remove('/hello/0', 3)
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[0].content.hello, 'gold',
  "Concurrent string removal and addition")

;({network, networks, node} = setup(2, {}))
var op = node[0].add('/hello', 'world')
networks.flush(0, 1)
node[1].replace('/hello', 'there')
networks.flush(1, 0)
node[0].replace('/hello', 'after', {after: op})
assert.equal(node[0].content.hello, 'there',
  "Atomic compound transactions don't allow concurrent operations within them")

;({network, networks, node} = setup(2, {}))
var op = node[0].add('/hello', 'world')
node[0].replace('/hello', 'one', {after: op})
assert.throws(function() {
  node[0].replace('/hello', 'two', {after: op})
}, "Atomic compound transactions must not allow duplicate identities")

;({network, networks, node} = setup(2, {}))
node[0].add('/hello', {})
networks.flush(0, 1)
node[0].remove('/hello')
node[1].add('/independent', ['prior operation'])
var op = node[1].add('/hola', 'mundo')
node[1].add('/hello/my', 'dear', {after: op})
node[1].add('/independent/-', 'posterior operation')
networks.flush(0, 1)
assert.equal(node[1].content.hola, undefined,
  "Atomic compound transactions must not partially apply")
assert.equal(node[1].content.independent[0], 'prior operation',
  "Unapplied atomic compound transactions must not block prior operations")
assert.equal(node[1].content.independent[1], 'posterior operation',
  "Unapplied atomic compound transactions must not block posterior operations")
