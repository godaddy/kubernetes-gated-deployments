const mwu = require('mann-whitney-utest')

const results = {
  harm: 'harm',
  noHarm: 'noHarm',
  notSignificant: 'notSignificant'
}

const DEFAULT_HARM_THRESHOLD = 1.5

// This z score corresponds to p = 0.05 (two tailed)
const DEFAULT_Z_SCORE_THRESHOLD = 1.96

function test ({
  controlSamples,
  treatmentSamples,
  minSamples,
  harmThreshold = DEFAULT_HARM_THRESHOLD,
  zScoreThreshold = DEFAULT_Z_SCORE_THRESHOLD
}) {
  const samples = [controlSamples, treatmentSamples]
  if (controlSamples.length < minSamples || treatmentSamples.length < minSamples) {
    return { u: [0, 0], analysisResult: results.notSignificant }
  }
  const u = mwu.test(samples)
  const zScore = mwu.criticalValue(u, samples)
  if (zScore <= zScoreThreshold) return { u, analysisResult: results.noHarm }

  // If significantly different, test if treatment is worse by harmThreshold
  const [controlU, treatmentU] = u
  const analysisResult = (treatmentU / controlU) > harmThreshold ? results.harm : results.noHarm
  return { u, analysisResult }
}

module.exports = {
  test,
  results
}
