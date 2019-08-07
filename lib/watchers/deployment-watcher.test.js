/* eslint-env mocha */
const chai = require('chai')
const clone = require('clone')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
const moment = require('moment')

const analysis = require('../analysis')
const { DEPLOYMENT_ANNOTATION_NAME, EXPERIMENT_ANNOTATION_NAME } = require('./constants')
const DeploymentHelper = require('../deployment-helper')
const DeploymentWatcher = require('./deployment-watcher')
const { DecisionResults } = require('../plugins/plugin')

chai.use(sinonChai)

const { expect } = chai

describe('DeploymentWatcher', () => {
  const deploymentDescriptor = {
    control: {
      name: 'example-rest-service-control',
      testPath: '/shopper/products'
    },
    treatment: {
      name: 'example-rest-service-treatment',
      testPath: '/shopper/products'
    },
    newRelic: {
      appName: 'nr-app'
    },
    experiment: {
      minSamples: 10,
      maxTime: 5
    }
  }
  let deploymentHelper, logger, mockPlugin

  beforeEach(() => {
    deploymentHelper = {
      updatePodSpec: sinon.stub().resolves(),
      kill: sinon.stub().resolves(),
      setAnnotation: sinon.stub().resolves(),
      isPodSpecIdentical: sinon.stub(),
      getPodSpecHash: sinon.stub().returns('hash')
    }
    logger = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    }
    mockPlugin = {
      build: sinon.stub().resolves(),
      onExperimentStart: sinon.stub(),
      onExperimentStop: sinon.stub(),
      onExperimentPoll: sinon.stub().resolves()
    }
  })

  describe('constructor', () => {
    it('sets fields on instance', () => {
      const watcher = new DeploymentWatcher({
        kubeClient: 'mockkubeclient',
        logger: 'mocklogger',
        deploymentDescriptor: 'mockdd',
        namespace: 'ns',
        plugins: ['mockplugin'],
        pollerIntervalMilliseconds: 5000,
        gatedDeploymentId: 'mockgd'
      })

      expect(watcher).to.be.an('object')
      expect(watcher._kubeClient).to.equal('mockkubeclient')
      expect(watcher._logger).to.equal('mocklogger')
      expect(watcher._deploymentDescriptor).to.equal('mockdd')
      expect(watcher._namespace).to.equal('ns')
      expect(watcher._plugins).to.deep.equal(['mockplugin'])
      expect(watcher._pollerIntervalMilliseconds).to.equal(5000)
      expect(watcher._gatedDeploymentId).to.equal('mockgd')
      expect(watcher._experiment).to.deep.equal({
        startTime: null,
        pollerInterval: null,
        treatmentPodSpec: null
      })
      expect(watcher._deploymentHelper).to.be.an.instanceOf(DeploymentHelper)
    })
  })

  describe('getStream', () => {
    it('returns gated deployment watch stream', () => {
      const watcher = new DeploymentWatcher({
        kubeClient: {
          apis: { apps: { v1: { watch: { namespaces: sinon.stub().returns({
            deploy: sinon.stub().returns({
              getStream: sinon.stub().returns('stream')
            })
          }) } } } }
        },
        logger: 'mocklogger',
        deploymentDescriptor: { treatment: { name: 'treatment' } },
        namespace: 'ns',
        pollerIntervalMilliseconds: 5000
      })

      expect(watcher.getStream()).to.equal('stream')
    })
  })

  describe('_validateAndGetExperimentAnnotation', () => {
    const constructDeployment = annotationVal => ({
      metadata: {
        annotations: {
          [EXPERIMENT_ANNOTATION_NAME]: annotationVal
        }
      }
    })
    const watcher = new DeploymentWatcher({})

    it('returns empty object if annotation is not set', () => {
      const treatmentDeployment = constructDeployment()
      treatmentDeployment.metadata.annotations = {}

      expect(watcher._validateAndGetExperimentAnnotation(treatmentDeployment)).to.deep.equal({})
    })

    it('returns empty object if annotation is set to null', () => {
      const treatmentDeployment = constructDeployment(null)

      expect(watcher._validateAndGetExperimentAnnotation(treatmentDeployment)).to.deep.equal({})
    })

    it('returns empty object if annotation is invalid', () => {
      const treatmentDeployment = constructDeployment('invalid')

      expect(watcher._validateAndGetExperimentAnnotation(treatmentDeployment)).to.deep.equal({})
    })

    it('returns empty object if annotation does not contain required fields', () => {
      const treatmentDeployment = constructDeployment(JSON.stringify({ some: 'field' }))

      expect(watcher._validateAndGetExperimentAnnotation(treatmentDeployment)).to.deep.equal({})
    })

    it('returns empty object if annotation does not have a valid time', () => {
      const treatmentDeployment = constructDeployment(JSON.stringify({
        startTime: 'invalid',
        podSpecHash: 'foo'
      }))

      expect(watcher._validateAndGetExperimentAnnotation(treatmentDeployment)).to.deep.equal({})
    })

    it('returns annotation object on valid annotation value', () => {
      const startTime = moment.utc().toISOString()
      const podSpecHash = 'foo'
      const treatmentDeployment = constructDeployment(JSON.stringify({
        startTime, podSpecHash
      }))

      const annotation = watcher._validateAndGetExperimentAnnotation(treatmentDeployment)

      expect(annotation.startTime.toISOString()).to.equal(startTime)
      expect(annotation.podSpecHash).to.equal(podSpecHash)
    })
  })

  describe('_isEligibleForExperiment', () => {
    let controlDeployment, treatmentDeployment, watcher

    beforeEach(() => {
      controlDeployment = {
        spec: {
          replicas: 2
        }
      }

      treatmentDeployment = clone(controlDeployment)

      watcher = new DeploymentWatcher({
        deploymentDescriptor
      })
      watcher._deploymentHelper = deploymentHelper
      watcher._deploymentHelper.get = sinon.stub().resolves({ body: controlDeployment })
    })

    it('returns false if replicas are positive and specs are same', async () => {
      watcher._deploymentHelper.isPodSpecIdentical.returns(true)

      expect(await watcher._isEligibleForExperiment(treatmentDeployment)).to.equal(false)
      expect(watcher._deploymentHelper.isPodSpecIdentical).to.have.been.calledOnceWith(controlDeployment, treatmentDeployment)
    })

    it('returns true if replicas are positive and specs are different', async () => {
      watcher._deploymentHelper.isPodSpecIdentical.returns(false)

      expect(await watcher._isEligibleForExperiment(treatmentDeployment)).to.equal(true)
      expect(watcher._deploymentHelper.isPodSpecIdentical).to.have.been.calledOnceWith(controlDeployment, treatmentDeployment)
    })
  })

  describe('_startExperiment', () => {
    let clock, watcher

    const zeroReplicaDeploy = { spec: { replicas: 0, template: { spec: 'zeroPodSpec' } } }
    const ineligibleDeploy = { spec: { replicas: 2, template: { spec: 'ineligible' } } }
    const eligibleDeploy = { spec: { replicas: 2, template: { spec: 'eligible' } } }
    const invalidDeploy = { spec: { replicas: 2, template: { spec: 'invalid' } } }

    beforeEach(() => {
      clock = sinon.useFakeTimers()

      watcher = new DeploymentWatcher({
        kubeClient: 'kubeclient',
        deploymentDescriptor,
        pollerIntervalMilliseconds: 5000,
        plugins: [mockPlugin],
        logger
      })
      watcher._deploymentHelper = deploymentHelper
      watcher._isEligibleForExperiment = sinon.stub().resolves(false)
      watcher._isEligibleForExperiment.withArgs(eligibleDeploy).resolves(true)
      watcher._isEligibleForExperiment.withArgs(invalidDeploy).rejects('error')
      watcher._killTreatment = sinon.stub().resolves()
      watcher._poll = sinon.stub().resolves()
    })

    afterEach(() => {
      watcher._clearExperiment()
      clock.restore()
    })

    it('does not start experiment if treatment replicas is zero', async () => {
      await watcher._startExperiment(zeroReplicaDeploy)

      expect(watcher._isEligibleForExperiment).to.have.been.callCount(0)
      expect(watcher._killTreatment).to.have.been.callCount(0)
      expect(watcher._experiment).to.deep.equal({
        startTime: null,
        pollerInterval: null,
        treatmentPodSpec: null
      })
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, null)
    })

    it('does not start experiment and kills treatment if treatment deployment is not eligible', async () => {
      await watcher._startExperiment(ineligibleDeploy)

      expect(watcher._isEligibleForExperiment).to.have.been.calledOnceWith(ineligibleDeploy)
      expect(watcher._killTreatment).to.have.been.calledOnceWith(analysis.results.noHarm)
      expect(watcher._experiment).to.deep.equal({
        startTime: null,
        pollerInterval: null,
        treatmentPodSpec: null
      })
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, null)
    })

    it('starts experiment if treatment deployment is eligible and sets experiment annotation', async () => {
      await watcher._startExperiment(eligibleDeploy)

      clock.tick(10000)

      expect(watcher._isEligibleForExperiment).to.have.been.calledOnceWith(eligibleDeploy)
      expect(watcher._experiment.startTime.utcOffset()).to.equal(0)
      expect(watcher._experiment.treatmentPodSpec).to.equal(eligibleDeploy.spec.template.spec)
      expect(watcher._experiment.pollerInterval).to.be.an('object')
      expect(watcher._poll).to.have.callCount(2)
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, JSON.stringify({
          startTime: watcher._experiment.startTime.toISOString(),
          podSpecHash: 'hash'
        })
      )
    })

    it('continues existing experiment from experiment annotation if pod spec matches', async () => {
      watcher._validateAndGetExperimentAnnotation = sinon.stub().returns({
        startTime: moment.utc('2019-07-10T22:50:18.234Z'),
        podSpecHash: 'hash'
      })

      await watcher._startExperiment(eligibleDeploy)

      expect(watcher._isEligibleForExperiment).to.have.been.calledOnceWith(eligibleDeploy)
      expect(watcher._experiment.startTime.toISOString()).to.equal('2019-07-10T22:50:18.234Z')
      expect(watcher._experiment.treatmentPodSpec).to.equal(eligibleDeploy.spec.template.spec)
      expect(watcher._experiment.pollerInterval).to.be.an('object')
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, JSON.stringify({
          startTime: '2019-07-10T22:50:18.234Z',
          podSpecHash: 'hash'
        })
      )
    })

    it('starts new experiment if pod spec in experiment annotation does not match', async () => {
      watcher._validateAndGetExperimentAnnotation = sinon.stub().returns({
        startTime: moment.utc('2019-07-10T22:50:18.234Z'),
        podSpecHash: 'hash2'
      })

      await watcher._startExperiment(eligibleDeploy)

      expect(watcher._isEligibleForExperiment).to.have.been.calledOnceWith(eligibleDeploy)
      expect(watcher._experiment.startTime.utcOffset()).to.equal(0)
      expect(watcher._experiment.treatmentPodSpec).to.equal(eligibleDeploy.spec.template.spec)
      expect(watcher._experiment.pollerInterval).to.be.an('object')
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, JSON.stringify({
          startTime: watcher._experiment.startTime.toISOString(),
          podSpecHash: 'hash'
        })
      )
    })

    it('catches and logs error if eligibility check throws', async () => {
      await watcher._startExperiment(invalidDeploy)

      expect(watcher._isEligibleForExperiment).to.have.been.calledOnceWith(invalidDeploy)
      expect(watcher._experiment).to.deep.equal({
        startTime: null,
        pollerInterval: null,
        treatmentPodSpec: null
      })
      expect(watcher._logger.error).to.have.callCount(1)
    })

    it('starts experiment for all plugins', async () => {
      await watcher._startExperiment(eligibleDeploy)

      expect(mockPlugin.onExperimentStart).to.have.been.calledOnceWith(watcher._experiment.startTime)
    })
  })

  describe('._clearExperiment', () => {
    let watcher

    beforeEach(() => {
      watcher = new DeploymentWatcher({
        kubeClient: 'kubeclient',
        deploymentDescriptor,
        pollerIntervalMilliseconds: 5000,
        plugins: [mockPlugin],
        logger
      })
      watcher._deploymentHelper = deploymentHelper
    })

    it('does nothing if no experiment is running', async () => {
      await watcher._clearExperiment()

      expect(watcher._logger.info).to.have.callCount(0)
      expect(deploymentHelper.setAnnotation).to.have.been.callCount(0)
    })

    it('clears experiment if it is running and sets experiment annotation to null', async () => {
      const pollerInterval = setInterval(() => {}, 1000)
      watcher._experiment = {
        startTime: moment.utc(),
        pollerInterval,
        treatmentPodSpec: 'treatment-pod-spec'
      }

      await watcher._clearExperiment()

      expect(watcher._experiment).to.deep.equal({
        startTime: null,
        pollerInterval: null,
        treatmentPodSpec: null
      })
      expect(pollerInterval._destroyed).to.equal(false)
      expect(mockPlugin.onExperimentStop).to.have.callCount(1)
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, null)
    })

    it('catches and logs error if setting experiment annotation fails', async () => {
      const pollerInterval = setInterval(() => {}, 1000)
      watcher._experiment = {
        startTime: moment.utc(),
        pollerInterval,
        treatmentPodSpec: 'treatment-pod-spec'
      }
      deploymentHelper.setAnnotation = sinon.stub().rejects()

      await watcher._clearExperiment()

      expect(watcher._experiment).to.deep.equal({
        startTime: null,
        pollerInterval: null,
        treatmentPodSpec: null
      })
      expect(pollerInterval._destroyed).to.equal(false)
      expect(mockPlugin.onExperimentStop).to.have.callCount(1)
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, null)
      expect(watcher._logger.error).to.have.callCount(1)
    })
  })

  describe('._killTreatment', () => {
    it('kills treatment and sets status annotation', async () => {
      const watcher = new DeploymentWatcher({
        deploymentDescriptor,
        logger
      })
      watcher._deploymentHelper = deploymentHelper

      await watcher._killTreatment('annotation')

      expect(deploymentHelper.kill).to.have.been.calledOnceWith(deploymentDescriptor.treatment.name)
      expect(deploymentHelper.setAnnotation).to.have.been.calledOnceWith(
        deploymentDescriptor.treatment.name, DEPLOYMENT_ANNOTATION_NAME, 'annotation')
    })
  })

  describe('._passExperiment', () => {
    it('updates the control to treatment spec, kills treatment with noHarm annotation', async () => {
      const watcher = new DeploymentWatcher({
        deploymentDescriptor,
        logger
      })
      watcher._deploymentHelper = deploymentHelper
      watcher._killTreatment = sinon.stub()
      watcher._experiment = {
        treatmentPodSpec: 'some-spec'
      }
      watcher._clearExperiment = sinon.stub().resolves()

      await watcher._passExperiment()

      expect(deploymentHelper.updatePodSpec).to.have.been.calledOnceWith(deploymentDescriptor.control.name, 'some-spec')
      expect(watcher._killTreatment).to.have.been.calledOnceWith(analysis.results.noHarm)
      expect(watcher._clearExperiment).to.have.been.calledOnceWith()
    })
  })

  describe('._failExperiment', () => {
    it('kills treatment with harm annotation', async () => {
      const watcher = new DeploymentWatcher({
        deploymentDescriptor,
        logger
      })
      watcher._killTreatment = sinon.stub().resolves()
      watcher._clearExperiment = sinon.stub().resolves()

      await watcher._failExperiment()

      expect(watcher._killTreatment).to.have.been.calledOnceWith(analysis.results.harm)
      expect(watcher._clearExperiment).to.have.been.calledOnceWith()
    })
  })

  describe('._poll', () => {
    let watcher
    let anotherMockPlugin

    beforeEach(() => {
      anotherMockPlugin = {
        onExperimentPoll: sinon.stub().resolves()
      }
      watcher = new DeploymentWatcher({
        logger,
        deploymentDescriptor,
        plugins: [mockPlugin, anotherMockPlugin]
      })
      watcher._passExperiment = sinon.stub()
      watcher._failExperiment = sinon.stub()
      watcher._experiment = {
        startTime: moment.utc()
      }
    })

    afterEach(() => {
      sinon.restore()
    })

    it('passes experiment if all plugins return PASS', async () => {
      mockPlugin.onExperimentPoll.resolves(DecisionResults.PASS)
      anotherMockPlugin.onExperimentPoll.returns(DecisionResults.PASS)

      await watcher._poll()

      expect(watcher._passExperiment).to.have.callCount(1)
      expect(watcher._failExperiment).to.have.callCount(0)
    })

    it('fails experiment if any plugins return FAIL', async () => {
      mockPlugin.onExperimentPoll.resolves(DecisionResults.PASS)
      anotherMockPlugin.onExperimentPoll.returns(DecisionResults.FAIL)

      await watcher._poll()

      expect(watcher._passExperiment).to.have.callCount(0)
      expect(watcher._failExperiment).to.have.callCount(1)
    })

    it('fails experiment if plugins return FAIL/WAIT', async () => {
      mockPlugin.onExperimentPoll.resolves(DecisionResults.FAIL)
      anotherMockPlugin.onExperimentPoll.returns(DecisionResults.WAIT)

      await watcher._poll()

      expect(watcher._passExperiment).to.have.callCount(0)
      expect(watcher._failExperiment).to.have.callCount(1)
    })

    it('does nothing if plugins return all WAIT', async () => {
      mockPlugin.onExperimentPoll.resolves(DecisionResults.WAIT)
      anotherMockPlugin.onExperimentPoll.resolves(DecisionResults.WAIT)

      await watcher._poll()

      expect(watcher._passExperiment).to.have.callCount(0)
      expect(watcher._failExperiment).to.have.callCount(0)
    })

    it('does nothing if plugins return some WAIT', async () => {
      mockPlugin.onExperimentPoll.resolves(DecisionResults.PASS)
      anotherMockPlugin.onExperimentPoll.resolves(DecisionResults.WAIT)

      await watcher._poll()

      expect(watcher._passExperiment).to.have.callCount(0)
      expect(watcher._failExperiment).to.have.callCount(0)
    })

    it('treats an error as a WAIT, with a PASS', async () => {
      mockPlugin.onExperimentPoll.resolves(DecisionResults.PASS)
      anotherMockPlugin.onExperimentPoll.rejects('Oh no!')

      await watcher._poll()

      expect(watcher._passExperiment).to.have.callCount(0)
      expect(watcher._failExperiment).to.have.callCount(0)
      expect(watcher._logger.error).to.have.callCount(1)
    })

    it('treats an error as a WAIT, with a FAIL', async () => {
      mockPlugin.onExperimentPoll.resolves(DecisionResults.FAIL)
      anotherMockPlugin.onExperimentPoll.rejects('Oh no!')

      await watcher._poll()

      expect(watcher._passExperiment).to.have.callCount(0)
      expect(watcher._failExperiment).to.have.callCount(1)
      expect(watcher._logger.error).to.have.callCount(1)
    })
  })

  describe('.onAdded', () => {
    it('starts experiment', () => {
      const watcher = new DeploymentWatcher({})
      watcher._startExperiment = sinon.stub().resolves()

      expect(watcher.onAdded('fake-deployment')).to.be.an.instanceOf(Promise)
      expect(watcher._startExperiment).to.have.been.calledOnceWith('fake-deployment')
      expect(watcher._previous).to.equal('fake-deployment')
    })
  })

  describe('.onModified', () => {
    const deployment = {
      annotation: '1',
      spec: {
        replicas: 4
      }
    }
    it('clears and starts experiment if no previous deployment', async () => {
      const watcher = new DeploymentWatcher({})
      watcher._clearExperiment = sinon.stub().resolves()
      watcher._startExperiment = sinon.stub().resolves()

      await watcher.onModified(deployment)

      expect(watcher._clearExperiment).to.have.been.calledOnceWith()
      expect(watcher._startExperiment).to.have.been.calledOnceWith(deployment)
    })

    it('clears and starts experiment if previous exists and treatment replicas changes', async () => {
      const watcher = new DeploymentWatcher({})
      watcher._previous = {
        annotation: '1',
        spec: {
          replicas: 2
        }
      }
      watcher._clearExperiment = sinon.stub().resolves()
      watcher._startExperiment = sinon.stub().resolves()
      watcher._deploymentHelper = deploymentHelper
      watcher._deploymentHelper.isPodSpecIdentical.returns(true)

      await watcher.onModified(deployment)

      expect(watcher._clearExperiment).to.have.been.calledOnceWith()
      expect(watcher._startExperiment).to.have.been.calledOnceWith(deployment)
      expect(watcher._previous).to.equal(deployment)
    })

    it('clears and starts experiment if previous exists and treatment pod spec changes', async () => {
      const watcher = new DeploymentWatcher({})
      const previous = {
        spec: {
          replicas: 4
        }
      }
      watcher._previous = previous
      watcher._clearExperiment = sinon.stub().resolves()
      watcher._startExperiment = sinon.stub().resolves()
      watcher._deploymentHelper = deploymentHelper
      watcher._deploymentHelper.isPodSpecIdentical.returns(false)

      await watcher.onModified(deployment)

      expect(watcher._clearExperiment).to.have.been.calledOnceWith()
      expect(watcher._startExperiment).to.have.been.calledOnceWith(deployment)
      expect(watcher._deploymentHelper.isPodSpecIdentical).to.have.been.calledWith(deployment, previous)
      expect(watcher._previous).to.equal(deployment)
    })

    it('does nothing if experiment exists and treatment replicas, pod spec does not change', async () => {
      const watcher = new DeploymentWatcher({})
      const previous = {
        annotation: '2',
        spec: {
          replicas: 4
        }
      }
      watcher._previous = previous
      watcher._clearExperiment = sinon.stub().resolves()
      watcher._startExperiment = sinon.stub().resolves()
      watcher._deploymentHelper = deploymentHelper
      watcher._deploymentHelper.isPodSpecIdentical.returns(true)

      await watcher.onModified(deployment)

      expect(watcher._clearExperiment).to.have.callCount(0)
      expect(watcher._startExperiment).to.have.callCount(0)
      expect(watcher._deploymentHelper.isPodSpecIdentical).to.have.been.calledWith(deployment, previous)
      expect(watcher._previous).to.equal(deployment)
    })
  })

  describe('.onDeleted', () => {
    it('clears experiment', async () => {
      const watcher = new DeploymentWatcher({})
      watcher._clearExperiment = sinon.stub().resolves()
      watcher._previous = 'previous'

      await watcher.onDeleted('fake-deployment')
      expect(watcher._clearExperiment).to.have.been.calledOnceWith()
      expect(watcher._previous).to.equal(null)
    })
  })
})
