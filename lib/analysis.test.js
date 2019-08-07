/* eslint-env mocha */
'use strict'

const { expect } = require('chai')
const sinon = require('sinon')

const mwu = require('mann-whitney-utest')

const { test, results } = require('./analysis')

describe('analysis', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('test', () => {
    it('returns notSignificant if not enough samples in control', () => {
      const controlSamples = Array(49)
      const treatmentSamples = Array(50)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50 })
      expect(result).to.deep.equal({ u: [0, 0], analysisResult: results.notSignificant })
    })

    it('returns notSignificant if not enough samples in treatment', () => {
      const controlSamples = Array(50)
      const treatmentSamples = Array(49)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50 })
      expect(result).to.deep.equal({ u: [0, 0], analysisResult: results.notSignificant })
    })

    it('returns noHarm if criticalValue less than or equal to default zScoreThreshold', () => {
      const controlSamples = Array(50)
      const treatmentSamples = Array(50)
      sinon.stub(mwu, 'test').returns([1250, 1250])
      sinon.stub(mwu, 'criticalValue').returns(1.96)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50 })
      expect(result).to.deep.equal({ u: [1250, 1250], analysisResult: results.noHarm })
    })

    it('returns noHarm if criticalValue less than or equal to custom zScoreThreshold', () => {
      const controlSamples = Array(50)
      const treatmentSamples = Array(50)
      sinon.stub(mwu, 'test').returns([1250, 1250])
      sinon.stub(mwu, 'criticalValue').returns(2.24)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50, zScoreThreshold: 2.5 })
      expect(result).to.deep.equal({ u: [1250, 1250], analysisResult: results.noHarm })
    })

    it('returns noHarm if treatment U is less than or equal to default harmThreshold times control U', () => {
      const controlSamples = Array(50)
      const treatmentSamples = Array(50)
      sinon.stub(mwu, 'test').returns([2000, 1000])
      sinon.stub(mwu, 'criticalValue').returns(2.24)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50 })
      expect(result).to.deep.equal({ u: [2000, 1000], analysisResult: results.noHarm })
    })

    it('returns harm if treatment U is more than default harmThreshold times control U', () => {
      const controlSamples = Array(50)
      const treatmentSamples = Array(50)
      sinon.stub(mwu, 'test').returns([1000, 2000])
      sinon.stub(mwu, 'criticalValue').returns(2.24)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50 })
      expect(result).to.deep.equal({ u: [1000, 2000], analysisResult: results.harm })
    })

    it('returns noHarm if treatment U is less than or equal to custom harmThreshold times control U', () => {
      const controlSamples = Array(50)
      const treatmentSamples = Array(50)
      sinon.stub(mwu, 'test').returns([1000, 2000])
      sinon.stub(mwu, 'criticalValue').returns(2.24)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50, harmThreshold: 2.5 })
      expect(result).to.deep.equal({ u: [1000, 2000], analysisResult: results.noHarm })
    })

    it('returns harm if treatment U is more than custom harmThreshold times control U', () => {
      const controlSamples = Array(50)
      const treatmentSamples = Array(50)
      sinon.stub(mwu, 'test').returns([1000, 3000])
      sinon.stub(mwu, 'criticalValue').returns(2.7)
      const result = test({ controlSamples, treatmentSamples, minSamples: 50, harmThreshold: 2.5, zScoreThreshold: 2.5 })
      expect(result).to.deep.equal({ u: [1000, 3000], analysisResult: results.harm })
    })
  })
})
