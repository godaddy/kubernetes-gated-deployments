/* eslint-env mocha */
'use strict'

const chai = require('chai')
const nock = require('nock')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')

const { NewRelicClient, getClientFromSecret } = require('./newrelic')

chai.use(sinonChai)

const { expect } = chai

describe('NewRelicClient', () => {
  let client

  beforeEach(() => {
    client = new NewRelicClient({ accountId: '1234', key: 'abc' })
  })

  afterEach(() => {
    sinon.restore()
    nock.cleanAll()
  })

  describe('constructor', () => {
    it('sets accountId and key from constructor params', () => {
      expect(client.accountId).to.equal('1234')
      expect(client.key).to.equal('abc')
    })
  })

  describe('_query', () => {
    it('makes a request and returns the results', async () => {
      const scope = nock('https://insights-api.newrelic.com:443', {
        reqHeaders: {
          'X-Query-Key': 'abc'
        }
      })
        .get('/v1/accounts/1234/query')
        .query({ nrql: 'nrql query' })
        .reply(200, { results: 'results' })
      const queryResult = await client._query({ nrql: 'nrql query' })
      expect(queryResult).to.equal('results')
      expect(scope.isDone()).to.equal(true)
    })
  })

  describe('queryAverage', () => {
    it('queries with average template query', async () => {
      const since = '2019-01-01T14:00:00.000Z'
      const hostPrefix = 'host'
      const appName = 'app-name'
      const pathName = '/path/name'
      const expectedQuery = 'SELECT average(duration), count(*) FROM Transaction' +
                            " SINCE '2019-01-01 14:00:00' UNTIL now WHERE host LIKE 'host%'" +
                            " AND appName = 'app-name' AND `request.uri` LIKE '/path/name'"
      client._query = sinon.stub().resolves('average result')
      const averageResult = await client.queryAverage({ since, hostPrefix, appName, pathName })
      expect(averageResult).to.equal('average result')
      expect(client._query).to.have.been.calledOnceWith({ nrql: expectedQuery })
    })
  })

  describe('querySamples', () => {
    it('queries with samples template query', async () => {
      const since = '2019-01-01T14:00:00.000Z'
      const hostPrefix = 'host'
      const appName = 'app-name'
      const pathName = '/path/name'
      const expectedQuery = "SELECT duration FROM Transaction SINCE '2019-01-01 14:00:00'" +
                            " UNTIL now WHERE host LIKE 'host%' AND appName = 'app-name' AND" +
                            " `request.uri` LIKE '/path/name' LIMIT 1000"
      client._query = sinon.stub().resolves([{ events: [{ duration: 1 }, { duration: 3 }] }])
      const sampleResult = await client.querySamples({ since, hostPrefix, appName, pathName })
      expect(sampleResult).to.deep.equal([1, 3])
      expect(client._query).to.have.been.calledOnceWith({ nrql: expectedQuery })
    })
  })
})

describe('getClientFromSecret', () => {
  let kubeClientStub
  let namespaceStub
  let secretStub

  beforeEach(() => {
    namespaceStub = sinon.stub()
    secretStub = sinon.stub()
    kubeClientStub = sinon.stub()
    kubeClientStub.api = sinon.stub()
    kubeClientStub.api.v1 = sinon.stub()
    kubeClientStub.api.v1.namespaces = sinon.stub().returns(namespaceStub)
    namespaceStub.secrets = sinon.stub().returns(secretStub)
    secretStub.get = sinon.stub().resolves({
      body: {
        data: {
          example: 'c2VjcmV0' // 'secret' base64 encoded
        }
      }
    })
  })

  afterEach(() => {
    sinon.restore()
  })

  it('creates and returns NewRelicClient', async () => {
    const newRelicClient = await getClientFromSecret({
      namespace: 'ns',
      kubeClient: kubeClientStub,
      config: {
        accountId: '123',
        secretName: 'newrelic-secrets',
        secretKey: 'example'
      }
    })
    expect(kubeClientStub.api.v1.namespaces).to.have.been.calledOnceWith('ns')
    expect(namespaceStub.secrets).to.have.been.calledOnceWith('newrelic-secrets')
    expect(newRelicClient.accountId).to.equal('123')
    expect(newRelicClient.key).to.equal('secret')
  })
})
