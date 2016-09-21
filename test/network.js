// Simulate a network.
var channel = function() {
  var end1 = {receive: function(){}}, end2 = {receive: function(){}}
  end1.send = function(str) { end2.receive(str) }
  end1.on = function(evt, listn) { end1[evt] = listn }
  end2.send = function(str) { end1.receive(str) }
  end2.on = function(evt, listn) { end2[evt] = listn }
  return [end1, end2]
}

// Each "real" node has its own Network object.
// The Networks object sets up their interaction.
var Networks = function() {
  this.networks = []  // List of {nodes, on()}, with nodes {send(), receive()}.
  this.messages = []  // The first index is the sender, the second the receiver.
                      // They map to lists of strings to be sent.
  this.send = []      // Same two-index design, giving the node's real send().
}
Networks.prototype = {
  addNode: function() {
    var self = this
    var j = self.networks.length
    self.send[j] = []
    self.messages[j] = []
    var nodes = self.networks.map(function(network, i) {
      var chan = channel()
      self.send[i][j] = chan[0].send
      self.send[j][i] = chan[1].send
      self.messages[i][j] = []
      self.messages[j][i] = []
      chan[0].send = function(str) { self.messages[i][j].push(str) }
      chan[1].send = function(str) { self.messages[j][i].push(str) }
      network.nodes.push(chan[0])
      return chan[1]
    })
    var network = {nodes: nodes, on: function(){}}
    self.networks.push(network)
    return network
  },
  // Flush messages from node a to b.
  flush: function(a, b) {
    var msgs = this.messages[a][b]
    for (var i = 0; i < msgs.length; i++) {
      this.send[a][b](msgs[i])
    }
    this.messages[a][b] = []
  }
}

module.exports = Networks
