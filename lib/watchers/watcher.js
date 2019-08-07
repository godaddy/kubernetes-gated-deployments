const AsyncLock = require('async-lock')
const JSONStream = require('json-stream')

const { StreamEvents, WatchEvents, WatcherStates, EVENT_LOCK } = require('./constants')

/**
 * Watcher abstraction for watching any kubernetes resource
 */
class Watcher {
  constructor () {
    this._activeResources = {}
    this._lock = new AsyncLock()
    this._state = WatcherStates.READY
  }

  /**
   * Extracts kubernetes resource metadata
   *
   * @param {Object} resource the kubernetes resource
   * @returns {Object} metadata including id, namespace, and resource version
   */
  _extractResourceMetadata (resource) {
    const { metadata: { name, namespace, resourceVersion } } = resource
    const id = `${namespace}_${name}`
    return { id, namespace, resourceVersion }
  }

  /**
   * Creates and returns a kubernetes watch stream
   */
  getStream () {
    throw new Error('Must be overridden')
  }

  /**
   * Invoked when the watch stream emits an end event
   */
  onEnd () {
    // Set an end event flag for all resources. This flag will be cleared on
    // all resources for which we receive an add event again when we create a
    // new stream. If this flag already exists for a resource, it means that it
    // was deleted during the period when a stream ended and restarted again.
    // Call delete for these resources.
    Object.entries(this._activeResources).forEach(([id, { resource, endEvent }]) => {
      if (endEvent) {
        this._onDeleted(resource)
      } else {
        this._activeResources[id].endEvent = true
      }
    })

    // If the watcher was stopped, don't restart. Only restart if the end event
    // was caused by the watch stream terminating automatically.
    if (this._state === WatcherStates.ENDED) return

    this.start()
  }

  /**
   * Invoked when an ADDED event is received. Added events are received when
   * either a resource is actually added or when a stream ends a new stream
   * starts. Only calls onAdded if a resource was actually added.
   *
   * @param {Object} resource the kubernetes resource
   */
  _onAdded (resource) {
    const { id, resourceVersion } = this._extractResourceMetadata(resource)
    // When a stream closes and a new stream starts, we get an added event for
    // all existing resources, so they could already exist.
    if (this._activeResources[id]) {
      // Clear the end event flag.
      delete this._activeResources[id].endEvent
      // Resources could be modified during the time when the stream closes and
      // a new stream is added. Check if resource version is the same and call
      // the modified event handler if they've changed.
      if (resourceVersion !== this._activeResources[id].resourceVersion) {
        this._onModified(resource)
      }
    } else {
      this._activeResources[id] = { resourceVersion, resource }
      this._lock.acquire(EVENT_LOCK, this.onAdded.bind(this, resource))
    }
  }

  /**
   * Invoked when a resource is actually added. Must be overridden in subclass.
   */
  onAdded () {
    throw new Error('Must be overridden')
  }

  /**
   * Invoked when a MODIFIED event is received. It updates activeResources and
   * calls onModified.
   *
   * @param {Object} resource the kubernetes resource
   */
  _onModified (resource) {
    const { id, resourceVersion } = this._extractResourceMetadata(resource)
    this._activeResources[id] = { resourceVersion, resource }
    this._lock.acquire(EVENT_LOCK, this.onModified.bind(this, resource))
  }

  /**
   * Invoked when a resource is modified. Must be overridden in subclass.
   */
  onModified () {
    throw new Error('Must be overridden')
  }

  /**
   * Invoked when a DELETED event is received. It updates activeResources and
   * calls onDeleted.
   *
   * @param {Object} resource the kubernetes resource
   */
  _onDeleted (resource) {
    const { id } = this._extractResourceMetadata(resource)
    delete this._activeResources[id]
    this._lock.acquire(EVENT_LOCK, this.onDeleted.bind(this, resource))
  }

  /**
   * Invoked when a resource is deleted. Must be overridden in subclass.
   */
  onDeleted () {
    throw new Error('Must be overridden')
  }

  /**
   * Creates the kubernetes watch stream and starts listening to events and
   * invokes the method corresponding to the event
   */
  start () {
    this._state = WatcherStates.RUNNING
    this.stream = this.getStream()

    this.stream.on(StreamEvents.END, this.onEnd.bind(this))

    const jsonStream = new JSONStream()
    this.stream.pipe(jsonStream)

    jsonStream.on(StreamEvents.DATA, event => {
      switch (event.type) {
        case WatchEvents.ADDED:
          this._onAdded(event.object)
          break
        case WatchEvents.MODIFIED:
          this._onModified(event.object)
          break
        case WatchEvents.DELETED:
          this._onDeleted(event.object)
          break
        default:
          break
      }
    })
  }

  /**
   * Aborts the watch stream and calls _onDeleted to clean up all resources
   */
  stop () {
    this._state = WatcherStates.ENDED
    if (this.stream) {
      this.stream.abort()
    }
    Object.entries(this._activeResources).forEach(([, { resource }]) => {
      this._onDeleted(resource)
    })
  }
}

module.exports = Watcher
