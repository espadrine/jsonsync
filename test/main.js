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
assert.equal(node[0].content.concurrent, 'change',
  'Concurrent two-way addition')

node[0].remove('/concurrent')
node[1].remove('/concurrent')
networks.flush(0, 1)
networks.flush(1, 0)
assert.equal(node[0].content.concurrent, undefined,
  'Concurrent two-way removal')
