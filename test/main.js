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
    node.push(new JsonSync({
      network: network[i],
      value: JsonSync.cloneValue(value),
      machine: [0]}))
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
assert.equal(node[1].content.hello, 'world')
