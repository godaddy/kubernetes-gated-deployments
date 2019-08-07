/* eslint-env mocha */
const chai = require('chai')
const clone = require('clone')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const stream = require('stream')

const { EVENT_LOCK, StreamEvents, WatchEvents } = require('./constants')
const Watcher = require('./watcher')

chai.use(sinonChai)

const { expect } = chai

describe('Watcher', () => {
  describe('integration tests', () => {
    let watcher, mockStream1, mockStream2, mockStream3, objects

    beforeEach(() => {
      watcher = new Watcher()
      mockStream1 = new stream.Readable()
      mockStream1._read = () => {}
      mockStream1.abort = sinon.stub().callsFake(() => { mockStream1.emit(StreamEvents.END) })
      mockStream2 = new stream.Readable()
      mockStream2._read = () => {}
      mockStream2.abort = sinon.stub().callsFake(() => { mockStream2.emit(StreamEvents.END) })
      mockStream3 = new stream.Readable()
      mockStream3._read = () => {}
      mockStream3.abort = sinon.stub().callsFake(() => { mockStream3.emit(StreamEvents.END) })
      watcher.getStream = sinon.stub().onCall(0).returns(mockStream1)
        .onCall(1).returns(mockStream2)
        .onCall(2).returns(mockStream3)

      sinon.spy(watcher, '_onAdded')
      sinon.spy(watcher, '_onModified')
      sinon.spy(watcher, '_onDeleted')
      sinon.spy(watcher, 'onEnd')
      sinon.spy(watcher, 'start')
      watcher.onAdded = sinon.stub()
      watcher.onModified = sinon.stub()
      watcher.onDeleted = sinon.stub()
      watcher.start()

      objects = [{
        metadata: {
          name: 'object1',
          namespace: 'ns1',
          resourceVersion: 1
        }
      }, {
        metadata: {
          name: 'object2',
          namespace: 'ns2',
          resourceVersion: 1
        }
      }]
    })

    it('adds new resources and marks them on stream end', async () => {
      const expectedResources = {
        'ns1_object1': {
          resourceVersion: 1,
          resource: objects[0],
          endEvent: true
        },
        'ns2_object2': {
          resourceVersion: 1,
          resource: objects[1],
          endEvent: true
        }
      }

      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[1])}}\n`)
      mockStream1.emit(StreamEvents.END)

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(watcher._onAdded).to.have.been.calledWith(objects[0])
      expect(watcher._onAdded).to.have.been.calledWith(objects[1])
      expect(watcher.onAdded).to.have.been.calledWith(objects[0])
      expect(watcher.onAdded).to.have.been.calledWith(objects[1])
      expect(watcher._onModified).to.have.callCount(0)
      expect(watcher._onDeleted).to.have.callCount(0)
      expect(watcher._activeResources).to.deep.equal(expectedResources)
    })

    it('updates existing resource for modified event', async () => {
      const modifiedObject = clone(objects[0])
      modifiedObject.metadata.resourceVersion = 2
      const expectedResources = {
        'ns1_object1': {
          resourceVersion: 2,
          resource: modifiedObject
        }
      }

      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.MODIFIED}", "object": ${JSON.stringify(modifiedObject)}}\n`)

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(watcher._onAdded).to.have.been.calledWith(objects[0])
      expect(watcher.onAdded).to.have.been.calledWith(objects[0])
      expect(watcher._onModified).to.have.been.calledWith(modifiedObject)
      expect(watcher.onModified).to.have.been.calledWith(modifiedObject)
      expect(watcher._activeResources).to.deep.equal(expectedResources)
    })

    it('removes existing resource for deleted event', async () => {
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.DELETED}", "object": ${JSON.stringify(objects[0])}}\n`)

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(watcher._onAdded).to.have.been.calledWith(objects[0])
      expect(watcher.onAdded).to.have.been.calledWith(objects[0])
      expect(watcher._onDeleted).to.have.been.calledWith(objects[0])
      expect(watcher.onDeleted).to.have.been.calledWith(objects[0])
      expect(watcher._activeResources).to.deep.equal({})
    })

    it('handles duplicate added events when stream ends and a new stream starts', async () => {
      const expectedResources = {
        'ns1_object1': {
          resourceVersion: 1,
          resource: objects[0]
        },
        'ns2_object2': {
          resourceVersion: 1,
          resource: objects[1]
        }
      }

      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[1])}}\n`)
      mockStream1.emit(StreamEvents.END)
      mockStream2.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream2.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[1])}}\n`)

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(watcher._onAdded.getCall(0)).to.have.been.calledWith(objects[0])
      expect(watcher._onAdded.getCall(1)).to.have.been.calledWith(objects[1])
      expect(watcher._onAdded.getCall(2)).to.have.been.calledWith(objects[0])
      expect(watcher._onAdded.getCall(3)).to.have.been.calledWith(objects[1])
      expect(watcher.onAdded).to.have.callCount(2)
      expect(watcher._onModified).to.have.callCount(0)
      expect(watcher._activeResources).to.deep.equal(expectedResources)
    })

    it('handles resources that are modified after stream ends and before new stream starts', async () => {
      const modifiedObject = clone(objects[0])
      modifiedObject.metadata.resourceVersion = 2
      const expectedResources = {
        'ns1_object1': {
          resourceVersion: 2,
          resource: modifiedObject
        }
      }

      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.END)
      mockStream2.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(modifiedObject)}}\n`)

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(watcher._onAdded.getCall(0)).to.have.been.calledWith(objects[0])
      expect(watcher._onAdded.getCall(1)).to.have.been.calledWith(modifiedObject)
      expect(watcher.onAdded).to.have.callCount(1)
      expect(watcher.onAdded).to.have.been.calledWith(objects[0])
      expect(watcher._onModified).to.have.been.calledWith(modifiedObject)
      expect(watcher._activeResources).to.deep.equal(expectedResources)
    })

    it('handles resources that are deleted after stream ends and before new stream starts', async () => {
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.END)
      mockStream2.emit(StreamEvents.END)

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(watcher.onEnd).to.have.callCount(2)
      expect(watcher._onDeleted).to.have.been.calledWith(objects[0])
      expect(watcher._activeResources).to.deep.equal({})
      expect(watcher.start).to.have.callCount(3)
      expect(watcher.getStream).to.have.callCount(3)
    })

    it('does not restart watcher if watcher is stopped', async () => {
      watcher.stop()

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(mockStream1.abort).to.have.been.calledWith()
      expect(watcher.onEnd).to.have.callCount(1)
      expect(watcher.start).to.have.callCount(1)
      expect(watcher.getStream).to.have.callCount(1)
    })

    it('handles resources that are deleted after stream ends and before new stream starts, when watcher is stopped', async () => {
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.END)
      watcher.stop()

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(mockStream1.abort).to.have.callCount(0)
      expect(mockStream2.abort).to.have.been.calledWith()
      expect(watcher.onEnd).to.have.callCount(2)
      expect(watcher._onDeleted).to.have.been.calledWith(objects[0])
      expect(watcher._activeResources).to.deep.equal({})
      expect(watcher.start).to.have.callCount(2)
      expect(watcher.getStream).to.have.callCount(2)
    })

    it('stops stream and cleans up activeResources if stopped', async () => {
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      watcher.stop()

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(mockStream1.abort).to.have.been.calledWith()
      expect(watcher._onDeleted).to.have.been.calledWith(objects[0])
      expect(watcher.onDeleted).to.have.been.calledWith(objects[0])
      expect(watcher._activeResources).to.deep.equal({})
    })

    it('handles events synchronously', async () => {
      const state = { val: 1 }
      watcher.onAdded = sinon.stub().callsFake(async () => {
        const stateVal = state.val
        await new Promise(resolve => setTimeout(resolve, 50))
        state.val = stateVal * 2
      })
      watcher.onModified = sinon.stub().callsFake(async () => {
        const stateVal = state.val
        await new Promise(resolve => setTimeout(resolve, 50))
        state.val = stateVal * 2
      })

      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.ADDED}", "object": ${JSON.stringify(objects[0])}}\n`)
      mockStream1.emit(StreamEvents.DATA, `{"type": "${WatchEvents.MODIFIED}", "object": ${JSON.stringify(objects[0])}}\n`)
      watcher.stop()

      await watcher._lock.acquire(EVENT_LOCK, () => {})

      expect(state.val).to.equal(4)
    })
  })
})
