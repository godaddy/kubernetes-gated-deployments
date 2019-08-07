/* eslint-env mocha */
const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const moment = require('moment')

const { DecisionResults, Plugin } = require('./plugin')

chai.use(sinonChai)

const { expect } = chai

describe('Plugin', () => {
  describe('constructor', () => {
    it('sets the max time', () => {
      const plugin = new Plugin('', '', 20)
      expect(plugin._maxTime).to.equal(20)
    })
  })

  describe('onExperimentStart', () => {
    it('sets the start time', () => {
      const plugin = new Plugin()
      plugin.onExperimentStart(50)
      expect(plugin._startTime).to.equal(50)
    })
  })

  describe('onExperimentStop', () => {
    it('clears the start time', () => {
      const plugin = new Plugin()
      plugin.onExperimentStart(50)
      expect(plugin._startTime).to.equal(50)
      plugin.onExperimentStop()
      expect(plugin._startTime).to.equal(null)
    })
  })

  describe('onExperimentPoll', () => {
    it('does not compare time if maxTime is 0', async () => {
      const plugin = new Plugin('control', 'treatment', 0)
      plugin._poll = sinon.stub().resolves(DecisionResults.WAIT)
      plugin.onExperimentStart(moment().utc().subtract('60', 's'))

      const result = await plugin.onExperimentPoll()
      expect(result).to.equal(DecisionResults.WAIT)
      expect(plugin._poll).to.have.callCount(1)
    })

    it('passes the experiment when maxtime is reached', async () => {
      const plugin = new Plugin('control', 'treatment', 60)
      plugin._poll = sinon.stub().resolves(DecisionResults.WAIT)
      plugin.onExperimentStart(moment().utc().subtract('80', 's'))

      const result = await plugin.onExperimentPoll()
      expect(result).to.equal(DecisionResults.PASS)
      expect(plugin._poll).to.have.callCount(0)
    })

    it('defers to _poll when maxtime is not yet reached', async () => {
      const plugin = new Plugin('control', 'treatment', 60)
      plugin._poll = sinon.stub().resolves(DecisionResults.WAIT)
      plugin.onExperimentStart(moment().utc().subtract('30', 's'))

      const result = await plugin.onExperimentPoll()
      expect(result).to.equal(DecisionResults.WAIT)
      expect(plugin._poll).to.have.callCount(1)
    })
  })
})
