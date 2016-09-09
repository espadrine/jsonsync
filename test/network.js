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
var Networks = function() { this.networks = [] }
Networks.prototype = {
  addNode: function() {
    var nodes = this.networks.map(function(network) {
      var chan = channel()
      network.nodes.push(chan[0])
      return chan[1]
    })
    var network = {nodes: nodes, on: function(){}}
    this.networks.push(network)
    return network
  }
}

module.exports = Networks
