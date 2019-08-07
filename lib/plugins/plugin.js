const moment = require('moment')

const DecisionResults = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  WAIT: 'WAIT'
}

class Plugin {
  /**
   * Creates a new Plugin
   * @param {string} controlName the name of the control deployment
   * @param {string} treatmentName the name of the treatment deployment
   * @param {int} maxTime=600 the maximum time to let the experiment run
   */
  constructor (controlName, treatmentName, maxTime = 600) {
    this._controlName = controlName
    this._treatmentName = treatmentName
    this._maxTime = maxTime
  }

  /**
   * Build a new plugin asynchronously. Implemented in subclasses
   */
  static async build () {
    throw new Error('Must be overridden')
  }

  /**
   * Called when an experiment starts. Sets the start time; subclasses
   * may have more logic
   * @param {int} startTime the utc time in seconds at experiment start
   */
  onExperimentStart (startTime) {
    this._startTime = startTime
  }

  /**
   * Called when an experiment stops. Clears the start time
   */
  onExperimentStop () {
    this._startTime = null
  }

  /**
   * Called every polling interval to get the plugin's decision about the experiment
   * @returns {DecisionResults} the DecisionResults outcome of the analysis
   */
  onExperimentPoll () {
    if (this._maxTime > 0 && moment().utc().diff(this._startTime, 's') >= this._maxTime) {
      return DecisionResults.PASS
    }

    return this._poll()
  }

  /**
   * Called by onExperimentPoll. Overridden by subclasses to run their
   * decision logic
   */
  async _poll () {
    throw new Error('Must be overridden')
  }
}

module.exports = {
  DecisionResults,
  Plugin
}
