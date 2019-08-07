/* eslint-env mocha */
const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')

const newRelicPerformance = require('./newrelic-performance')
const pluginFactory = require('../plugins/plugin-factory')

chai.use(sinonChai)

const { expect } = chai

describe('PluginFactory', () => {
  describe('buildPluginsFromConfig', () => {
    it('builds all plugins specified in config', async () => {
      const newrelicStub = sinon.stub(newRelicPerformance, 'build').resolves('mockPluginClass')

      const result = await pluginFactory.buildPluginsFromConfig({
        namespace: 'mockNS',
        kubeClient: 'mockClient',
        logger: 'mockLogger',
        controlName: 'control',
        treatmentName: 'treatment',
        decisionPluginConfig: [{
          name: 'newRelicPerformance'
        }]
      })

      expect(result).to.deep.equal(['mockPluginClass'])
      expect(newrelicStub).to.have.been.calledWith({
        namespace: 'mockNS',
        kubeClient: 'mockClient',
        logger: 'mockLogger',
        controlName: 'control',
        treatmentName: 'treatment',
        config: { name: 'newRelicPerformance' }
      })
    })

    it('throws an error on an unknown plugin', () => {
      expect(() => pluginFactory.buildPluginsFromConfig({
        namespace: 'mockNS',
        kubeClient: 'mockClient',
        logger: 'mockLogger',
        decisionPluginConfig: [{
          name: 'foo'
        }]
      })).to.throw(Error)
    })
  })
})
