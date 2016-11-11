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

var situation = setup(2, {})
var networks = situation.networks
var network = situation.network
var node = situation.node

node[0].add('/hello', 'world')
networks.flush(0, 1)
assert.equal(node[1].content.hello, 'world',
  'One-way transmission of addition')

node[1].remove('/hello')
networks.flush(1, 0)
assert.equal(node[1].content.hello, undefined,
  'One-way transmission of removal')

node[0].add('/concurrent', 'update')
node[1].add('/concurrent', 'change')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[1].content.concurrent, 'update',
  'Concurrent two-way addition')

node[0].remove('/concurrent')
node[1].remove('/concurrent')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[0].content.concurrent, undefined,
  'Concurrent two-way removal')

node[0].add('/hello', 'world')
networks.flush(0, 1)
node[1].replace('/hello', 'there')
networks.flush(1, 0)
assert.equal(node[0].content.hello, 'there',
  'One-way transmission of object replacement')
node[0].remove('/hello')
networks.flush(0, 1)

node[0].add('/hello', 'world')
node[0].localAdd(['hello'], 'there')
assert.equal(node[0].content.hello, 'world',
  "Adding existing keys don't perform a replacement")
node[0].localAdd([], 'world')
assert.notStrictEqual(node[0].content, 'world',
  "Adding the root when it exists doesn't perform a replacement")
node[0].remove('/hello')
networks.flush(0, 1)

node[0].localReplace(['hello'], 'world')
assert.equal(node[0].content.hello, undefined,
  "Replacing an inexistent key doesn't perform an addition")
node[0].content = undefined
node[0].localReplace([], 'world')
assert.equal(node[0].content, undefined,
  "Replacing the root when it doesn't exist doesn't perform a replacement")
node[0].content = {}
