/* eslint-env mocha */
const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')

const DeploymentWatcher = require('./deployment-watcher')
const GatedDeploymentWatcher = require('./gated-deployment-watcher')
const pluginFactory = require('../plugins/plugin-factory')

chai.use(sinonChai)

const { expect } = chai

describe('GatedDeploymentWatcher', () => {
  describe('constructor', () => {
    it('sets fields on instance', () => {
      const watcher = new GatedDeploymentWatcher({
        kubeClient: 'mockkubeclient',
        logger: 'mocklogger',
        pollerIntervalMilliseconds: 5000
      })

      expect(watcher).to.be.an('object')
      expect(watcher._kubeClient).to.equal('mockkubeclient')
      expect(watcher._logger).to.equal('mocklogger')
      expect(watcher._pollerIntervalMilliseconds).to.equal(5000)
      expect(watcher._deploymentWatchers).to.deep.equal({})
    })
  })

  describe('getStream', () => {
    it('returns gated deployment watch stream', () => {
      const watcher = new GatedDeploymentWatcher({
        kubeClient: {
          apis: {
            'kubernetes-client.io': {
              v1: { watch: { gateddeployments: { getStream: sinon.stub().returns('stream') } } }
            }
          }
        },
        logger: 'mocklogger',
        pollerIntervalMilliseconds: 5000
      })

      expect(watcher.getStream()).to.equal('stream')
    })
  })

  describe('_createDeploymentWatcher', () => {
    let watcher, loggerInfoStub, loggerErrorStub
    const gatedDeployment = {
      metadata: {
        name: 'testgd',
        namespace: 'testgdns'
      },
      deploymentDescriptor: {
        control: {
          name: 'control'
        },
        treatment: {
          name: 'treatment'
        },
        decisionPlugins: 'mockPluginConfig'
      }
    }
    const expectedId = 'testgdns_testgd'

    beforeEach(() => {
      loggerInfoStub = sinon.stub()
      loggerErrorStub = sinon.stub()
      watcher = new GatedDeploymentWatcher({
        kubeClient: 'kubeclient',
        logger: {
          info: loggerInfoStub,
          error: loggerErrorStub
        },
        controllerNamespace: 'controllerNs'
      })
    })

    afterEach(() => {
      sinon.restore()
    })

    it('creates, sets and starts deployment watcher', async () => {
      const pluginFactoryStub = sinon.stub(pluginFactory, 'buildPluginsFromConfig').resolves(['mockPlugin'])
      const startStub = sinon.stub(DeploymentWatcher.prototype, 'start')

      await watcher._createDeploymentWatcher(gatedDeployment)

      expect(watcher._deploymentWatchers).to.have.property(expectedId)
      expect(watcher._deploymentWatchers[expectedId]).to.be.an.instanceOf(DeploymentWatcher)
      expect(pluginFactoryStub).to.have.been.calledWith({
        namespace: 'controllerNs',
        kubeClient: 'kubeclient',
        logger: watcher._logger,
        controlName: gatedDeployment.deploymentDescriptor.control.name,
        treatmentName: gatedDeployment.deploymentDescriptor.treatment.name,
        decisionPluginConfig: 'mockPluginConfig'
      })
      expect(startStub).to.have.callCount(1)
    })

    it('logs error if creating deployment watcher fails', async () => {
      const pluginFactoryStub = sinon.stub(pluginFactory, 'buildPluginsFromConfig').rejects()
      const startStub = sinon.stub(DeploymentWatcher.prototype, 'start')

      await watcher._createDeploymentWatcher(gatedDeployment)

      expect(watcher._deploymentWatchers).to.deep.equal({})
      expect(pluginFactoryStub).to.have.been.calledWith({
        namespace: 'controllerNs',
        kubeClient: 'kubeclient',
        logger: watcher._logger,
        controlName: gatedDeployment.deploymentDescriptor.control.name,
        treatmentName: gatedDeployment.deploymentDescriptor.treatment.name,
        decisionPluginConfig: 'mockPluginConfig'
      })
      expect(loggerErrorStub).to.have.callCount(1)
      expect(startStub).to.have.callCount(0)
    })
  })

  describe('_removeDeploymentWatcher', () => {
    let watcher, loggerInfoStub, loggerWarnStub
    const gatedDeployment = {
      metadata: {
        name: 'testgd',
        namespace: 'testgdns'
      },
      deploymentDescriptor: {
        newRelic: {}
      }
    }
    const expectedId = 'testgdns_testgd'

    beforeEach(() => {
      loggerInfoStub = sinon.stub()
      loggerWarnStub = sinon.stub()
      watcher = new GatedDeploymentWatcher({
        kubeClient: 'kubeclient',
        logger: {
          info: loggerInfoStub,
          warn: loggerWarnStub
        }
      })
    })

    it('stops and removes deployment watcher', () => {
      const stopStub = sinon.stub()
      watcher._deploymentWatchers = {
        [expectedId]: { stop: stopStub },
        anotherId: 'another watcher'
      }

      watcher._removeDeploymentWatcher(gatedDeployment)

      expect(watcher._deploymentWatchers).to.deep.equal({ anotherId: 'another watcher' })
      expect(stopStub).to.have.callCount(1)
    })

    it('warns if deployment watcher with id not found', () => {
      const stopStub = sinon.stub()
      watcher._deploymentWatchers = {
        anotherId: { stop: stopStub }
      }

      watcher._removeDeploymentWatcher(gatedDeployment)

      expect(watcher._deploymentWatchers).to.deep.equal({ anotherId: { stop: stopStub } })
      expect(stopStub).to.have.callCount(0)
      expect(loggerWarnStub).to.have.callCount(1)
    })
  })

  describe('onAdded', () => {
    it('creates deployment watcher', () => {
      const watcher = new GatedDeploymentWatcher({})
      const gatedDeployment = { gated: 'deploy' }
      watcher._createDeploymentWatcher = sinon.stub().resolves()
      watcher._removeDeploymentWatcher = sinon.stub()

      expect(watcher.onAdded(gatedDeployment)).to.be.an.instanceOf(Promise)
      expect(watcher._createDeploymentWatcher).to.have.been.calledWith(gatedDeployment)
      expect(watcher._removeDeploymentWatcher).to.have.callCount(0)
    })
  })

  describe('onModified', () => {
    it('removes and creates deployment watcher', () => {
      const watcher = new GatedDeploymentWatcher({})
      const gatedDeployment = { gated: 'deploy' }
      watcher._createDeploymentWatcher = sinon.stub().resolves()
      watcher._removeDeploymentWatcher = sinon.stub()

      expect(watcher.onModified(gatedDeployment)).to.be.an.instanceOf(Promise)
      expect(watcher._createDeploymentWatcher).to.have.been.calledWith(gatedDeployment)
      expect(watcher._removeDeploymentWatcher).to.have.been.calledWith(gatedDeployment)
    })
  })

  describe('onDeleted', () => {
    it('removes deployment watcher', () => {
      const watcher = new GatedDeploymentWatcher({})
      const gatedDeployment = { gated: 'deploy' }
      watcher._createDeploymentWatcher = sinon.stub()
      watcher._removeDeploymentWatcher = sinon.stub()

      watcher.onDeleted(gatedDeployment)

      expect(watcher._createDeploymentWatcher).to.have.callCount(0)
      expect(watcher._removeDeploymentWatcher).to.have.been.calledWith(gatedDeployment)
    })
  })
})
