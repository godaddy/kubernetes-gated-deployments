/* eslint-env mocha */
const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')

const NewRelicPerformancePlugin = require('./newrelic-performance')
const { DecisionResults } = require('./plugin')
const analysis = require('../analysis')
const newrelic = require('../newrelic')

chai.use(sinonChai)

const { expect } = chai

describe('NewRelicPerformancePlugin', () => {
  let plugin
  const samples = [1, 2, 3]
  const config = {
    accountId: '807783',
    secretName: 'newrelic-secrets',
    secretKey: 'example-rest-service',
    appName: 'example-rest-service',
    minSamples: 50,
    maxTime: 600,
    testPath: '/shopper/products',
    harmThreshold: 1.25,
    zScoreThreshold: 1.5
  }

  beforeEach(() => {
    plugin = new NewRelicPerformancePlugin({
      config,
      logger: {
        info: sinon.stub()
      },
      newRelicClient: {
        queryAverage: sinon.stub().resolves({
          count: 20,
          average: 30
        }),
        querySamples: sinon.stub().resolves(samples)
      }
    })
  })

  afterEach(() => {
    sinon.restore()
  })

  describe('build', () => {
    it('initializes the newrelic client', async () => {
      const newRelicStub = sinon.stub(newrelic, 'getClientFromSecret').resolves('mockNRClient')

      const result = await NewRelicPerformancePlugin.build({
        namespace: 'mockNamespace',
        kubeClient: 'mockClient',
        logger: 'mockLogger',
        config: {
          maxTime: 10
        }
      })
      expect(result._config).to.deep.equal({ maxTime: 10 })
      expect(result._logger).to.equal('mockLogger')
      expect(result._newRelicClient).to.equal('mockNRClient')
      expect(result._maxTime).to.equal(10)
      expect(newRelicStub).to.have.been.calledWith({
        namespace: 'mockNamespace',
        kubeClient: 'mockClient',
        config: {
          maxTime: 10
        }
      })
    })
  })

  describe('._poll', () => {
    beforeEach(() => {
      plugin._fetchPerformanceData = sinon.stub().resolves({ samples })
    })

    it('returns PASS if analysis returns no harm', async () => {
      const testStub = sinon.stub(analysis, 'test').returns({ analysisResult: analysis.results.noHarm })

      const result = await plugin._poll()

      expect(result).to.equal(DecisionResults.PASS)
      expect(plugin._fetchPerformanceData).to.have.callCount(2)
      expect(testStub).to.have.been.calledWith({
        controlSamples: samples,
        treatmentSamples: samples,
        minSamples: config.minSamples,
        harmThreshold: config.harmThreshold,
        zScoreThreshold: config.zScoreThreshold
      })
    })

    it('returns FAIL if analysis returns harm', async () => {
      const testStub = sinon.stub(analysis, 'test').returns({ analysisResult: analysis.results.harm })

      const result = await plugin._poll()

      expect(result).to.equal(DecisionResults.FAIL)
      expect(plugin._fetchPerformanceData).to.have.callCount(2)
      expect(testStub).to.have.been.calledWith({
        controlSamples: samples,
        treatmentSamples: samples,
        minSamples: config.minSamples,
        harmThreshold: config.harmThreshold,
        zScoreThreshold: config.zScoreThreshold
      })
    })

    it('return WAIT if analysis returns not significant', async () => {
      const testStub = sinon.stub(analysis, 'test').returns({ analysisResult: analysis.results.notSignificant })

      const result = await plugin._poll()

      expect(result).to.equal(DecisionResults.WAIT)
      expect(plugin._fetchPerformanceData).to.have.callCount(2)
      expect(testStub).to.have.been.calledWith({
        controlSamples: samples,
        treatmentSamples: samples,
        minSamples: config.minSamples,
        harmThreshold: config.harmThreshold,
        zScoreThreshold: config.zScoreThreshold
      })
    })

    it('Will not analyse if missing samples', async () => {
      const testStub = sinon.stub(analysis, 'test')
      plugin._fetchPerformanceData = sinon.stub().resolves({ samples: [] })

      const result = await plugin._poll()

      expect(result).to.equal(DecisionResults.WAIT)
      expect(plugin._fetchPerformanceData).to.have.callCount(2)
      expect(testStub).to.have.callCount(0)
    })
  })

  describe('._fetchPerformanceData', () => {
    it('fetches data for a split', async () => {
      plugin._startTime = 15
      const results = await plugin._fetchPerformanceData('control')

      const expectedArgs = {
        since: 15,
        hostPrefix: 'control',
        appName: config.appName,
        pathName: config.testPath
      }
      expect(plugin._newRelicClient.queryAverage).to.have.been.calledWith(expectedArgs)
      expect(plugin._newRelicClient.querySamples).to.have.been.calledWith(expectedArgs)
      expect(results).to.deep.equal({
        count: 20,
        average: 30,
        samples: [1, 2, 3]
      })
    })
  })
})
