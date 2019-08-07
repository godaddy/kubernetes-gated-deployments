const { DecisionResults, Plugin } = require('./plugin')
const analysis = require('../analysis')
const newrelic = require('../newrelic')

class NewRelicPerformancePlugin extends Plugin {
  /**
   * Constructs a new NewRelicPerformancePlugin
   * @param {Object} options the options object
   * @param {Object} options.config the NewRelicPerformancePlugin config object
   * @param {Object} options.logger the system logger
   * @param {Object} options.newRelicClient client to interact with newrelic
   */
  constructor ({ config, logger, newRelicClient, controlName, treatmentName }) {
    super(controlName, treatmentName, config.maxTime)
    this._config = config
    this._logger = logger
    this._newRelicClient = newRelicClient
  }
  /**
   * Creates a NewRelicPerformancePlugin from the parameters specified
   * in the config object
   * @param {Object} options the options object
   * @param {string} options.namespace the kubernetes namespace
   * @param {Object} options.kubeClient the kubernetes client
   * @param {Object} options.logger the system logger
   * @param {string} options.controlName the name of the control deployment
   * @param {string} options.treatmentName the name of the treatment deployment
   * @param {Object} options.config the config object for this plugin
   */
  static async build ({
    namespace,
    kubeClient,
    logger,
    controlName,
    treatmentName,
    config
  }) {
    const newRelicClient = await newrelic.getClientFromSecret({
      namespace,
      kubeClient,
      config
    })

    return new NewRelicPerformancePlugin({ config, logger, newRelicClient, controlName, treatmentName })
  }

  /**
   * Polls newrelic for timing information and uses the mann-whitney u-test
   * to determine the significance of the results.
   * @returns {DecisionResults} The result of the analysis, PASS, FAIL, or WAIT
   */
  async _poll () {
    const [controlResult, treatmentResult] = await Promise.all(
      [this._controlName, this._treatmentName].map(this._fetchPerformanceData.bind(this))
    )

    let analysisResult = analysis.results.notSignificant
    if (controlResult.samples.length && treatmentResult.samples.length) {
      const testResult = analysis.test({
        controlSamples: controlResult.samples,
        treatmentSamples: treatmentResult.samples,
        minSamples: this._config.minSamples,
        harmThreshold: this._config.harmThreshold,
        zScoreThreshold: this._config.zScoreThreshold
      })
      analysisResult = testResult.analysisResult
    }

    if (analysisResult === analysis.results.harm) {
      return DecisionResults.FAIL
    } else if (analysisResult === analysis.results.noHarm) {
      return DecisionResults.PASS
    } else {
      return DecisionResults.WAIT
    }
  }

  /**
   * Fetches performance data for the corresponding deployment
   * @param {string} name - the deployment name
   * @returns {Object} An object including average, count and samples
   */
  async _fetchPerformanceData (name) {
    const newRelicArgs = {
      since: this._startTime,
      hostPrefix: name,
      appName: this._config.appName,
      pathName: this._config.testPath
    }
    const [summary, samples] = await Promise.all(
      [this._newRelicClient.queryAverage, this._newRelicClient.querySamples].map(
        queryFn => queryFn.bind(this._newRelicClient, newRelicArgs)()
      )
    )
    return { ...summary, samples }
  }
}

module.exports = NewRelicPerformancePlugin
