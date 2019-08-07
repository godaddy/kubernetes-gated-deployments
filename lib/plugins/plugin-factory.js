const newRelicPerformance = require('./newrelic-performance')

const pluginNameMap = {
  newRelicPerformance
}

/**
 * Creates an array of plugins specified by the decisionPluginConfig
 * @param {Object} options the options object
 * @param {string} options.namespace the kubernetes namespace of the controller
 * @param {Object} options.kubeClient the kubernetes client
 * @param {Object} options.logger the system logger
 * @param {string} options.controlName the name of the control deployment
 * @param {string} options.treatmentName the name of the treatment deployment
 * @param {array}  options.decisionPluginConfig the list of decision plugin configs
 * @returns {array} Array of Plugin objects
 */
function buildPluginsFromConfig ({
  namespace,
  kubeClient,
  logger,
  controlName,
  treatmentName,
  decisionPluginConfig
}) {
  return Promise.all(decisionPluginConfig.map(config => {
    const pluginClass = pluginNameMap[config.name]
    if (pluginClass) {
      return pluginClass.build({
        namespace,
        kubeClient,
        logger,
        controlName,
        treatmentName,
        config
      })
    } else {
      throw new Error(`Invalid plugin: ${config.name}`)
    }
  }))
}

module.exports = {
  buildPluginsFromConfig
}
