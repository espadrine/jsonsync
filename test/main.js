var assert = require('assert')
var JsonSync = require('..')
var Networks = require('./network.js')

var networks = new Networks()
var network1 = networks.addNode()
var network2 = networks.addNode()

var jsonsync1 = new JsonSync({network: network1, value: {}, machine: [0]})
var jsonsync2 = new JsonSync({network: network2, value: {}, machine: [1]})

jsonsync1.add('/hello', 'world')
assert.equal(jsonsync2.content.hello, 'world')
