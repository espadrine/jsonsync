// https://github.com/umdjs/umd/blob/master/templates/returnExports.js
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory)
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.JsonSync = factory()
  }
}(this, function() {

var nodejs = (typeof module === 'object' && module.exports)
var browser = !!this.window

// Main constructor.
// options:
// - network: object that must have:
//   - on('connect', function(node))
//   - on('disconnect', function(node))
//   - nodes: an array of Nodes
//   Nodes are objects that must have:
//   - send(string)
//   - on('receive', function(string))
// - machine: list of numbers identifying the current node in the network.
//   Collisions break your data's convergence guarantees, so beware.
//   Optional. It defaults to using whatever good source of randomness there is.
// - value: default JSON value.
var JsonSync = function(options) {
  options = options || {}

  this.network = options.network
  this.connectNode = this.connectNode.bind(this)
  this.protoReceive = this.protoReceive.bind(this)
  this.network.nodes.forEach(this.connectNode)
  this.network.on('connect', this.connectNode)

  // Local copy of the JSON data.
  // TODO: support direct edits like `data.content.comments.shift()` through
  // Proxies. We'd need to trap set() and deleteProperty().
  this.content = (options.value !== undefined)? options.value: null

  // Lamport timestamp.
  this.timestamp = 0

  // Local identifier. Used to ensure total order in operations in the Lamport
  // timestamps.
  this.machine = options.machine || rand128()

  // List of operations. Conforms to JSON Patch, with marks.
  this.history = []

  this.eventListeners = Object.create(null)
}

JsonSync.prototype = {
  newMark: function(after) {
    if (after !== undefined) {
      var mark = after.mark.slice()
      mark[mark.length - 1]++
    } else {
      var mark = [this.timestamp].concat(this.machine).concat([0])
      this.timestamp++
    }
    return mark
  },

  // The op is an operation from outside.
  updateTimestamp: function(op) {
    if (op.mark[0] >= this.timestamp) {
      this.timestamp = op.mark[0] + 1
    }
  },

  // Operations.
  // Adding an operation requires adding the localOperation and modifying
  // localPatch and invertOperation.

  // {op:'add', path, was}
  add: function(path, value, options) {
    options = options || {}
    // Ensure that this is a list of keys, even if given a JSON Pointer.
    if (typeof path === 'string') {
      path = pathFromJsonPointer(path)
    }
    var oldValue = cloneValue(this.get(path))

    // Here, a JSON Patch add must be creating a new key.
    // If the key already exists, it is a replacement.
    var parentValue = (path.length > 0)? this.get(path.slice(0, -1)): null
    var parent = Object(parentValue)
    if ((oldValue !== undefined) && (parentValue !== null) &&
        !(parent instanceof Array)) {
      return this.replace(path, value)
    }

    // Perform the change locally.
    if (!this.localAdd(path, value)) { return }

    // Transmit the change.
    var op = { op: 'add', path: path, value: value }
    this.insertOpInHistory(op, options)
    this.broadcast(this.protoDiff([op]))
    this.emit('localUpdate', [op])
    return op
  },

  // true if the operation changed the content.
  // path: list of keys.
  localAdd: function(path, value) {
    value = cloneValue(value)
    if (path.length === 0) {
      // We must not let an addition perform a replacement.
      if (this.content !== undefined) { return false }
      this.content = value
      return true
    }

    var target = this.getPath(path.slice(0, -1))
    if (target === undefined) { return false }
    var key = path[path.length - 1]

    target = Object(target)
    if (target instanceof Array) {
      if (key === '-') {
        key = target.length
      }
      key = +key
      if (key !== key) { return false }
      target.splice(key, 0, value)
    } else if (target instanceof String) {
      if (key === '-') {
        key = target.length
      }
      key = +key
      key = +key
      if (key !== key) { return false }
      target = target.slice(0, key) + String(value) + target.slice(key)
      var parentKey = path[path.length - 2]
      if (parentKey === undefined) {
        // The string is the root element.
        this.content = target
      } else {
        var targetParent = this.getPath(path.slice(0, -2))
        targetParent[parentKey] = target
      }
    } else {
      // We must not let an addition perform a key replacement.
      // However, that is a valid operation.
      if (target[key] !== undefined) { return false }
      target[key] = value
    }

    return true
  },

  // {op:'replace', path, value, was}
  replace: function(path, value, options) {
    options = options || {}
    // Ensure that this is a list of keys, even if given a JSON Pointer.
    if (typeof path === 'string') {
      path = pathFromJsonPointer(path)
    }
    var oldValue = cloneValue(this.get(path))

    // Perform the change locally.
    if (!this.localReplace(path, value)) { return }

    // Transmit the change.
    var op = { op: 'replace', path: path, value: value, was: oldValue }
    this.insertOpInHistory(op, options)
    this.broadcast(this.protoDiff([op]))
    this.emit('localUpdate', [op])
    return op
  },

  // true if the operation changed the content.
  // path: list of keys.
  localReplace: function(path, value) {
    value = cloneValue(value)
    if (path.length === 0) {
      // We must not let a replacement perform an addition.
      if (this.content === undefined) { return false }
      this.content = value
      return true
    }

    var target = this.getPath(path.slice(0, -1))
    if (target === undefined) { return false }
    var key = path[path.length - 1]

    target = Object(target)
    if (target instanceof Array) {
      if (key === '-') {
        key = target.length
      }
      key = +key
      if (key !== key) { return false }
      target[key] = value
    } else {
      // We must not let a replacement perform a key addition.
      // However, that is a valid operation.
      if (target[key] === undefined) { return false }
      target[key] = value
    }

    return true
  },

  // {op:'remove', path, was}
  remove: function(path, count, options) {
    if (count === undefined) {
      count = 1
    } else if (count !== undefined) {
      if (typeof count === 'object') {
        options = count
        count = 1
      } else if (typeof count !== 'number') { return
      } else { count = +count }
    }
    options = options || {}
    // Ensure that this is a list of keys, even if given a JSON Pointer.
    if (typeof path === 'string') {
      path = pathFromJsonPointer(path)
    }

    // If this is string edition, we fetch the old value within the string.
    var parentValue = (path.length > 0)? this.get(path.slice(0, -1)): null
    var parent = Object(parentValue)
    if ((parentValue !== null) && (parent instanceof String)) {
      var start = +path[path.length - 1]
      if (start !== start) { return }
      var oldValue = parentValue.slice(start, start + count)
    } else {
      var oldValue = cloneValue(this.get(path))
    }

    // Perform the change locally.
    if (!this.localRemove(path, count)) { return }

    // Transmit the change.
    var op = { op: 'remove', path: path }
    if (oldValue !== undefined) { op.was = oldValue }
    this.insertOpInHistory(op, options)
    this.broadcast(this.protoDiff([op]))
    this.emit('localUpdate', [op])
    return op
  },

  // true if the operation changed the content.
  // path: list of keys.
  // count: number of items to delete.
  localRemove: function(path, count) {
    // If count isn't a number or isn't positive, this is invalid.
    if (!(count > 0)) { return false }
    if (path.length === 0) {
      this.content = null
      return true
    }

    var target = this.getPath(path.slice(0, -1))
    if (target === undefined) { return false }
    var key = path[path.length - 1]

    target = Object(target)
    if (target instanceof Array) {
      if (key === '-') {
        key = target.length
      }
      key = +key
      if (key !== key) { return false }
      target.splice(key, 1)
    } else if (target instanceof String) {
      if (key === '-') {
        key = target.length
      }
      key = +key
      if (key !== key) { return false }
      target = target.slice(0, key) + target.slice(key + count)
      var parentKey = path[path.length - 2]
      if (parentKey === undefined) {
        // The string is the root element.
        this.content = target
      } else {
        var targetParent = this.getPath(path.slice(0, -2))
        targetParent[parentKey] = target
      }
    } else {
      delete target[key]
    }

    return true
  },

  // {op:'move', from, path}
  move: function(fromPath, path, options) {
    options = options || {}
    // Ensure that this is a list of keys, even if given a JSON Pointer.
    if (typeof fromPath === 'string') {
      fromPath = pathFromJsonPointer(fromPath)
    }
    if (typeof path === 'string') {
      path = pathFromJsonPointer(path)
    }
    // FIXME: when we have compound operations, convert an overriding move to a
    // remove followed by a move.

    if (!this.localMove(fromPath, path)) { return }

    // Transmit the change.
    var op = { op: 'move', from: fromPath, path: path }
    this.insertOpInHistory(op, options)
    this.broadcast(this.protoDiff([op]))
    this.emit('localUpdate', [op])
    return op
  },

  // true if the operation changed the content.
  // path: list of keys.
  localMove: function(fromPath, path) {
    var target = this.getPath(fromPath)
    if (target === undefined) { return false }
    // Preclude prefixes between fromPath and path.
    // This ensures that the target path exists when we move stuff to it,
    // and that the operation can be reversed.
    if (isPathPrefix(fromPath, path) || isPathPrefix(path, fromPath)) {
      return false
    }

    if (!this.localAdd(path, cloneValue(target))) { return false }
    if (!this.localRemove(fromPath, 1)) {
      this.localRemove(path, 1)
      return false
    }
    return true
  },

  // Give the JSON object corresponding to that JSON Pointer (or path).
  get: function(path) {
    var oldpath = path
    // Ensure that this is a list of keys, even if given a JSON Pointer.
    if (typeof path === 'string') {
      path = pathFromJsonPointer(path)
    }
    return this.getPath(path)
  },
  // Give the JSON object corresponding to that path (eg, ['key', 0]).
  getPath: function(path) {
    var target = this.content
    for (var i = 0; i < path.length; i++) {
      if (typeof target !== 'object') { return }
      target = target[path[i]]
    }
    return target
  },

  // Add a mark to op and insert it into the history.
  // op: operation, options: {after?}
  insertOpInHistory: function(op, options) {
    op.mark = this.newMark(options.after)
    if (options.after !== undefined) {
      this.applyPatch([op])
    } else {
      this.history.push(op)
    }
  },

  // Use this when we receive a diff from the network.
  // diff: list of operations.
  patch: function(diff) {
    diff = cloneValue(diff)
    var changes = this.applyPatch(diff)

    this.emit('update', changes)
  },
  applyPatch: function(diff) {
    // The diff is a list of operations, as per JSON Patch, with marks.
    // We assume that within a diff, marks are correctly ordered.
    // changes are a list of changes that will be sent to the view.
    var changes = []

    // We need to find the oldest point to which we must rollback.
    var rollbackPoint = this.findAtOrAfter(diff[0].mark)
    // If this is a compound operation, we need to go to the start of it.
    var op = this.history[rollbackPoint]
    while (op !== undefined && op.mark[op.mark.length - 1] > 0) {
      rollbackPoint--
      op = this.history[rollbackPoint]
    }

    changes = this.history.slice(rollbackPoint).reverse().map(invertOperation)

    var previousInsertionPoint = rollbackPoint
    for (var i = 0, diffLen = diff.length; i < diffLen; i++) {
      var op = diff[i]

      // We must insert it at the right position in history.
      var insertionPoint = this.history.length
      for (var j = previousInsertionPoint, histLen = this.history.length;
          j < histLen; j++) {
        var compared = lessThanMark(op.mark, this.history[j].mark)
        if (compared === 0) {
          if (lessThanMark(op.mark.slice(1, -1), this.machine) === 0) {
            // We are merging something that we already built into history.
            throw new Error("We created a new operation with the same " +
              "identifier as an operation we created previously")
          }
          continue  // Ignore already merged foreign operations.
        }
        if (compared < 0) {
          insertionPoint = j
          break
        }
      }

      changes = changes.concat(this.history
        .slice(previousInsertionPoint, insertionPoint))
      changes.push(op)

      this.history.splice(insertionPoint, 0, op)
      this.updateTimestamp(op)
      insertionPoint++
      previousInsertionPoint = insertionPoint
    }
    changes = changes.concat(this.history.slice(previousInsertionPoint))

    // Perform the changes locally.
    this.localPatch(changes)
    return changes
  },
  // Locate the index in history of the earliest change whose mark is ≥ mark.
  // If there are no such change, produce the length of the history.
  findAtOrAfter: function(mark) {
    for (var i = this.history.length - 1; i >= 0; i--) {
      var op = this.history[i]
      if (lessThanMark(op.mark, mark) < 0) { break }
    }
    return i + 1
  },

  // Perform changes to the local JSON object.
  // changes: list of operations.
  localPatch: function(changes, ignoreFailedTransactions) {
    for (var i = 0, changesLen = changes.length; i < changesLen; i++) {
      var op = changes[i]
      var path = op.path
      if (typeof path === 'string') {
        path = pathFromJsonPointer(path)
      }
      var wasApplied = false;
      if (op.op === 'add') {
        wasApplied = this.localAdd(path, op.value)
      } else if (op.op === 'replace') {
        wasApplied = this.localReplace(path, op.value)
      } else if (op.op === 'remove') {
        if (op.was !== undefined) {
          op.original = cloneValue(op)
          op.was = cloneValue(this.get(path))
          if (Object(op.was) instanceof String) {
            var count = op.was.length
          } else {
            var count = 1
          }
        }
        wasApplied = this.localRemove(path, count)
      } else if (op.op === 'move') {
        if (typeof op.from === 'string') {
          var fromPath = pathFromJsonPointer(op.from)
        } else { var fromPath = op.from }
        wasApplied = this.localMove(fromPath, path)
      }

      if (!wasApplied && !ignoreFailedTransactions) {
        var mark = op.mark[op.mark.length - 1]
        if (mark > 0) {
          var inverted = op.inverted
          // If inverted, the transaction looks like 4 3 2 (← op) 1 0.
          // Since we go backwards, the mark is incremented every time.
          var markDelta = inverted ? 1 : -1
          for (var j = i - 1; j > 0; j--) {
            op = changes[j]
            if (mark + markDelta === op.mark[op.mark.length - 1] &&
                op.inverted === inverted) {
              mark += markDelta
            } else { break }
          }
          j++
          // Part of the transaction already applied.
          var transactionStart = changes.slice(j, i)
          this.localPatch(transactionStart.reverse().map(invertOperation), true)
          // Reset those values.
          op = changes[i]
          mark = op.mark[op.mark.length - 1]
        }
        // This time, we go forward.
        var markDelta = op.inverted ? -1 : 1
        for (i++; i < changesLen; i++) {
          op = changes[i]
          if (mark + markDelta === op.mark[op.mark.length - 1]) {
            mark += markDelta
          } else { break }
        }
        i--  // Counterbalance the for loop's i++.
      }
    }
  },

  // Network-related actions.

  connectNode: function(node) {
    node.on('receive', this.protoReceive)
  },
  broadcast: function(str) {
    var networkLen = this.network.nodes.length
    for (var i = 0; i < networkLen; i++) {
      this.network.nodes[i].send('' + str)
    }
  },
  protoReceive: function(str) {
    var json = JSON.parse(str)
    if (json[0] === 1) {
      // 1 - Patch. Argument: a list of operations.
      var diff = json[1]
      this.patch(diff)
    }
  },
  // diff: list of operations.
  // FIXME: compactify representation.
  protoDiff: function(diff) {
    return JSON.stringify([1, diff])
  },

  // Event emission.

  on: function(event, callback) {
    if (typeof callback !== 'function') {
      throw new Error('Non-function callback')
    }
    if (this.eventListeners[event] === undefined) {
      this.eventListeners[event] = []
    }
    this.eventListeners[event].push(callback)
  },
  off: function(event, callback) {
    var eventListeners = this.eventListeners[event] || []
    for (var i = 0, len = eventListeners.length; i < len; i++) {
      if (eventListeners[i] === callback) {
        eventListeners.splice(i, 1)
        break
      }
    }
  },
  emit: function(event, data) {
    var eventListeners = this.eventListeners[event] || []
    for (var i = 0, len = eventListeners.length; i < len; i++) {
      eventListeners[i](data)
    }
  },
}

// Invert any JSON Patch operation.
// Returns undefined if it cannot.
var invertOperation = function(op) {
  if (op.op === 'add') {
    return { op: 'remove', path: op.path, was: op.value, inverted: !op.inverted }
  } else if (op.op === 'remove') {
    return { op: 'add', path: op.path, value: op.was, inverted: !op.inverted }
  } else if (op.op === 'replace') {
    return { op: 'replace', path: op.path, value: op.was, was: op.value, inverted: !op.inverted }
  } else if (op.op === 'move') {
    return { op: 'move', from: op.path, path: op.from, inverted: !op.inverted }
  }
}

var cloneValue = function(v) {
  if (v == null || typeof v === 'boolean' || typeof v === 'number'
      || typeof v === 'string') {
    return v
  } else if (Object(v) instanceof Array) {
    return v.slice().map(cloneValue)
  } else {
    return cloneObject(v)
  }
}
JsonSync.cloneValue = cloneValue

var cloneObject = function(obj) {
  var res = Object.create(null)
  for (var key in obj) {
    res[key] = cloneValue(obj[key])
  }
  return res
}

// Convert a JSON Pointer to a list.
var pathFromJsonPointer = function(pointer) {
  if (typeof pointer !== 'string') {
    throw new Error('pathFromJsonPointer() only supports strings, ' +
      'something else was given')
  }

  var parts = pointer.split('/').slice(1)
  return parts.map(function(part) {
    if (!/~/.test(part)) { return part }
    // It is important to end with the ~ replacement,
    // to avoid converting `~01` to a `/`.
    return part.replace(/~1/g, '/').replace(/~0/g, '~')
  })
}

var jsonPointerFromPath = function(path) {
  if (!(Object(path) instanceof Array)) {
    throw new Error('jsonPointerFromPath() only supports arrays, ' +
      'something else was given')
  }

  return '/' + path.map(function(part) {
    // It is important to start with the ~ replacement,
    // to avoid converting `/` to `~01`.
    return part.replace(/~/g, '~0').replace(/\//g, '~1')
  }).join('/')
}

// True if p1 is a prefix of p2.
// eg, ['foo'] is a prefix of ['foo', 'bar'].
function isPathPrefix(p1, p2) {
  var p1Len = p1.length
  var p2Len = p2.length
  // [] is not a prefix of [], ['foo'] isn't a prefix of ['foo'],
  // and obviously ['foo'] isn't a prefix of [].
  if (p1Len >= p2Len) { return false }
  for (var i = 0; i < p1Len; i++) {
    if (p1[i] !== p2[i]) { return false }
  }
  return true
}

// Mark is a list. Return the alphabetically-ordered lesser one:
// -1 if mark1 is smaller than mark2, 1 if it is higher, 0 otherwise.
function lessThanMark(mark1, mark2) {
  for (var i = 0; i < Math.min(mark1.length, mark2.length); i++) {
    if (mark1[i] < mark2[i]) {
      return -1;
    } else if (mark1[i] > mark2[i]) {
      return 1;
    } // else go on.
  }
  // We have gone through all of them, they are all equal.
  if (mark1.length < mark2.length) { return -1;
  } else if (mark1.length > mark2.length) { return 1;
  } else { return 0; }
}

// Random 128-bit represented as a list of numbers.
// Collision probability: below 0.5 for n < 2^64 = 18446744073709551616.
// To approximate for other probabilities:
// p = function(n, max) { return 1 - fact(max) / (Math.pow(max, n) * fact(max - n)); }
// Tailor expansion: p = function(n, max) { return 1 - Math.exp(-n*(n-1)/(max*2)); }
// Use n^2 instead of n*(n-1) and find n in terms of probability p:
// n = function(p, max) { return Math.sqrt(max * 2 * Math.log(1 / (1 - p))); }
var rand128 = function() {
  if (nodejs) {
    var randomBytes = require('crypto').randomBytes
    var buf = randomBytes(16)
    return [buf.readUInt32LE(0), buf.readUInt32LE(4),
            buf.readUInt32LE(8), buf.readUInt32LE(12)]
  } else if (browser && window.crypto && window.crypto.getRandomValues) {
    var buf = new Uint32Array(4)
    window.crypto.getRandomValues(buf)
    return [buf[0], buf[1], buf[2], buf[3]]
  }

  // If we have not found a good way to return yet, we will fall back on raw JS.
  // But it is absolutely not enough for our guarantee requirements.
  if (console && console.warn) {
    console.warn('JsonSync could not find any good source of entropy.')
  }

  return [
    rand32NoEntropy(), rand32NoEntropy(), rand32NoEntropy(), rand32NoEntropy()
  ]
}

var rand32NoEntropy = function() {
  return (Math.random() * 0xffffffff) >>> 0
}

return JsonSync
}));
