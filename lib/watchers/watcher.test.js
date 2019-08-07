/* eslint-env mocha */
const AsyncLock = require('async-lock')
const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const stream = require('stream')

const { StreamEvents, WatchEvents, WatcherStates } = require('./constants')
const Watcher = require('./watcher')

chai.use(sinonChai)

const { expect } = chai

describe('Watcher', () => {
  describe('constructor', () => {
    it('sets activeResources and _state', () => {
      const watcher = new Watcher()

      expect(watcher._activeResources).to.deep.equal({})
      expect(watcher._lock).to.be.an.instanceOf(AsyncLock)
      expect(watcher._state).to.equal(WatcherStates.READY)
    })
  })

  describe('._extractResourceMetadata', () => {
    it('returns metadata', () => {
      const resource = {
        metadata: {
          name: 'test-resource',
          namespace: 'test-ns',
          resourceVersion: 12345
        }
      }

      const watcher = new Watcher()
      const metadata = watcher._extractResourceMetadata(resource)

      expect(metadata).to.deep.equal({
        id: 'test-ns_test-resource',
        namespace: 'test-ns',
        resourceVersion: 12345
      })
    })
  })

  describe('.onEnd', () => {
    let watcher

    beforeEach(() => {
      watcher = new Watcher()

      watcher._onDeleted = sinon.stub()
      watcher.start = sinon.stub()
    })

    it('restarts if no active resources exist', () => {
      watcher.onEnd()

      expect(watcher.start).to.have.callCount(1)
    })

    it('sets endEvent for all active resources', () => {
      watcher._activeResources = {
        r1: { resource: 'res1' },
        r2: { resource: 'res2' }
      }

      watcher.onEnd()

      expect(watcher._activeResources.r1.endEvent).to.equal(true)
      expect(watcher._activeResources.r2.endEvent).to.equal(true)
      expect(watcher.start).to.have.callCount(1)
    })

    it('calls _onDeleted for resources with endEvent already set', () => {
      watcher._activeResources = {
        r1: { resource: 'res1', endEvent: true },
        r2: { resource: 'res2' },
        r3: { resource: 'res3', endEvent: true }
      }

      watcher.onEnd()

      expect(watcher._activeResources.r2.endEvent).to.equal(true)
      expect(watcher._onDeleted).to.have.callCount(2)
      expect(watcher._onDeleted).to.have.been.calledWith('res1')
      expect(watcher._onDeleted).to.have.been.calledWith('res3')
      expect(watcher.start).to.have.callCount(1)
    })

    it('does not restart if watcher has already ended after calling _onDeleted', () => {
      watcher._state = WatcherStates.ENDED
      watcher._activeResources = {
        r1: { resource: 'res1', endEvent: true },
        r2: { resource: 'res2' },
        r3: { resource: 'res3', endEvent: true }
      }

      watcher.onEnd()

      expect(watcher._activeResources.r2.endEvent).to.equal(true)
      expect(watcher._onDeleted).to.have.callCount(2)
      expect(watcher._onDeleted).to.have.been.calledWith('res1')
      expect(watcher._onDeleted).to.have.been.calledWith('res3')
      expect(watcher.start).to.have.callCount(0)
    })
  })

  describe('._onAdded', () => {
    let watcher

    beforeEach(() => {
      watcher = new Watcher()

      watcher.onAdded = sinon.stub()
      watcher._onModified = sinon.stub()
    })

    it('calls onAdded for a new resource', () => {
      const resource = {
        metadata: {
          name: 'test-resource',
          namespace: 'test-ns',
          resourceVersion: 12345
        }
      }

      watcher._onAdded(resource)

      expect(watcher._activeResources).to.deep.equal({
        'test-ns_test-resource': {
          resourceVersion: 12345,
          resource
        }
      })
      expect(watcher.onAdded).to.have.been.calledWith(resource)
      expect(watcher._onModified).to.have.callCount(0)
    })

    it('clears endEvent flag for an already active resource', () => {
      const resource = {
        metadata: {
          name: 'test-resource',
          namespace: 'test-ns',
          resourceVersion: 12345
        }
      }
      watcher._activeResources = {
        'test-ns_test-resource': {
          resourceVersion: 12345,
          resource,
          endEvent: true
        }
      }

      watcher._onAdded(resource)

      expect(watcher._activeResources).to.deep.equal({
        'test-ns_test-resource': {
          resourceVersion: 12345,
          resource
        }
      })
      expect(watcher.onAdded).to.have.callCount(0)
      expect(watcher._onModified).to.have.callCount(0)
    })

    it('calls onModified for an already existing resource that is modified', () => {
      const resource = {
        metadata: {
          name: 'test-resource',
          namespace: 'test-ns',
          resourceVersion: 12345
        }
      }
      watcher._activeResources = {
        'test-ns_test-resource': {
          resourceVersion: 12343,
          resource,
          endEvent: true
        }
      }

      watcher._onAdded(resource)

      expect(watcher._activeResources).to.deep.equal({
        'test-ns_test-resource': {
          resourceVersion: 12343,
          resource
        }
      })
      expect(watcher.onAdded).to.have.callCount(0)
      expect(watcher._onModified).to.have.been.calledWith(resource)
    })
  })

  describe('._onModified', () => {
    let watcher

    beforeEach(() => {
      watcher = new Watcher()

      watcher.onModified = sinon.stub()
    })

    it('updates activeResources and calls onModified', () => {
      const resource = {
        metadata: {
          name: 'test-resource',
          namespace: 'test-ns',
          resourceVersion: 12345
        }
      }
      watcher._activeResources = {
        'test-ns_test-resource': {
          resourceVersion: 12343,
          resource,
          endEvent: true
        }
      }

      watcher._onModified(resource)

      expect(watcher._activeResources).to.deep.equal({
        'test-ns_test-resource': {
          resourceVersion: 12345,
          resource
        }
      })
      expect(watcher.onModified).to.have.been.calledWith(resource)
    })
  })

  describe('._onDeleted', () => {
    let watcher

    beforeEach(() => {
      watcher = new Watcher()

      watcher.onDeleted = sinon.stub()
    })

    it('updates activeResources and calls onDeleted', () => {
      const resource = {
        metadata: {
          name: 'test-resource',
          namespace: 'test-ns',
          resourceVersion: 12345
        }
      }
      watcher._activeResources = {
        'test-ns_test-resource': {
          resourceVersion: 12343,
          resource,
          endEvent: true
        }
      }

      watcher._onDeleted(resource)

      expect(watcher._activeResources).to.deep.equal({})
      expect(watcher.onDeleted).to.have.been.calledWith(resource)
    })
  })

  describe('.start', () => {
    let watcher, mockStream

    beforeEach(() => {
      watcher = new Watcher()
      mockStream = new stream.Readable()
      mockStream._read = () => {}

      watcher.getStream = sinon.stub().returns(mockStream)
      watcher._onAdded = sinon.stub()
      watcher._onModified = sinon.stub()
      watcher._onDeleted = sinon.stub()
      watcher.onEnd = sinon.stub()

      watcher.start()
      expect(watcher._state).to.equal(WatcherStates.RUNNING)
    })

    it('calls onAdded on ADDED event', () => {
      mockStream.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": {"some": "object1"}}`)

      expect(watcher._onAdded).to.have.been.calledWith({ some: 'object1' })
      expect(watcher._onModified).to.have.callCount(0)
      expect(watcher._onDeleted).to.have.callCount(0)
    })

    it('calls onModified on MODIFIED event', () => {
      mockStream.emit(StreamEvents.DATA, `{"type": "${WatchEvents.MODIFIED}", "object": {"some": "object2"}}`)

      expect(watcher._onModified).to.have.been.calledWith({ some: 'object2' })
      expect(watcher._onAdded).to.have.callCount(0)
      expect(watcher._onDeleted).to.have.callCount(0)
    })

    it('calls onDeleted on DELETED event', () => {
      mockStream.emit(StreamEvents.DATA, `{"type": "${WatchEvents.DELETED}", "object": {"some": "object3"}}`)

      expect(watcher._onDeleted).to.have.been.calledWith({ some: 'object3' })
      expect(watcher._onAdded).to.have.callCount(0)
      expect(watcher._onModified).to.have.callCount(0)
    })

    it('calls onEnd on end event', () => {
      mockStream.emit(StreamEvents.END)

      expect(watcher.onEnd).to.have.callCount(1)
    })
  })

  describe('.stop', () => {
    it('aborts stream and calls _onDeleted for all active resources', () => {
      const watcher = new Watcher()
      watcher._activeResources = {
        r1: { resource: 'res1' },
        r2: { resource: 'res2', endEvent: true }
      }
      watcher.onDeleted = sinon.stub()
      watcher._onDeleted = sinon.stub()

      watcher.stream = { abort: sinon.stub() }

      watcher.stop()

      expect(watcher._state).to.equal(WatcherStates.ENDED)
      expect(watcher.stream.abort).to.have.callCount(1)
      expect(watcher._onDeleted).to.have.callCount(2)
      expect(watcher._onDeleted).to.have.been.calledWith('res1')
      expect(watcher._onDeleted).to.have.been.calledWith('res2')
    })
  })
})
