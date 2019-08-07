const DeploymentWatcher = require('./deployment-watcher')
const Watcher = require('./watcher')
const pluginFactory = require('../plugins/plugin-factory')

class GatedDeploymentWatcher extends Watcher {
  /**
   * Creates a gated deployment watcher
   *
   * @param {Object} options the options object
   * @param {string} options.controllerNamespace namespace of the gated-deployment controller
   * @param {Object} options.kubeClient the kube client instance
   * @param {Object} options.logger the logger instance
   * @param {Number} options.pollerIntervalMilliseconds the poller interval in milliseconds
   */
  constructor ({ controllerNamespace, kubeClient, logger, pollerIntervalMilliseconds }) {
    super()
    this._controllerNamespace = controllerNamespace
    this._kubeClient = kubeClient
    this._logger = logger
    this._pollerIntervalMilliseconds = pollerIntervalMilliseconds
    this._deploymentWatchers = {}
  }

  /**
   * Returns a gated deployments watch stream
   *
   * @returns {Object} the watch stream
   */
  getStream () {
    return this._kubeClient.apis['kubernetes-client.io'].v1.watch.gateddeployments.getStream()
  }

  /**
   * Creates and starts a deployment watcher for the gated deployment
   *
   * @param {Object} gatedDeployment the gated deployment object
   */
  async _createDeploymentWatcher (gatedDeployment) {
    const { id, namespace } = this._extractResourceMetadata(gatedDeployment)
    const deploymentDescriptor = gatedDeployment.deploymentDescriptor

    this._logger.info(`${id}: Creating and starting deployment watcher`)

    try {
      const plugins = await pluginFactory.buildPluginsFromConfig({
        namespace: this._controllerNamespace,
        kubeClient: this._kubeClient,
        logger: this._logger,
        controlName: deploymentDescriptor.control.name,
        treatmentName: deploymentDescriptor.treatment.name,
        decisionPluginConfig: deploymentDescriptor.decisionPlugins
      })

      this._deploymentWatchers[id] = new DeploymentWatcher({
        kubeClient: this._kubeClient,
        plugins,
        logger: this._logger,
        namespace,
        deploymentDescriptor,
        pollerIntervalMilliseconds: this._pollerIntervalMilliseconds,
        gatedDeploymentId: id
      })

      this._deploymentWatchers[id].start()
    } catch (err) {
      this._logger.error(`${id}: Failed to create and start deployment watcher`, err.message)
    }
  }

  /**
   * Stops and removes a deployment watcher for the gated deployment
   *
   * @param {Object} gatedDeployment the gated deployment object
   */
  _removeDeploymentWatcher (gatedDeployment) {
    const { id } = this._extractResourceMetadata(gatedDeployment)

    this._logger.info(`${id}: Stopping and removing deployment watcher`)

    if (this._deploymentWatchers[id]) {
      this._deploymentWatchers[id].stop()
      delete this._deploymentWatchers[id]
    } else {
      this._logger.warn(`${id}: No deployment watcher found`)
    }
  }

  /**
   * Creates a deployment watcher
   *
   * @param {Object} gatedDeployment the gated deployment object
   * @returns {Promise} a promise that resolves when the deployment watcher is
   * created.
   */
  onAdded (gatedDeployment) {
    return this._createDeploymentWatcher(gatedDeployment)
  }

  /**
   * Removes existing deployment watcher and creates a new deployment watcher
   *
   * @param {Object} gatedDeployment the gated deployment object
   * @returns {Promise} a promise that resolves when the deployment watcher is
   * re-created.
   */
  onModified (gatedDeployment) {
    this._removeDeploymentWatcher(gatedDeployment)
    return this._createDeploymentWatcher(gatedDeployment)
  }

  /**
   * Removes the deployment watcher
   *
   * @param {Object} gatedDeployment the gated deployment object
   */
  onDeleted (gatedDeployment) {
    this._removeDeploymentWatcher(gatedDeployment)
  }
}

module.exports = GatedDeploymentWatcher
