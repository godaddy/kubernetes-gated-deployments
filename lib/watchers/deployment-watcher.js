const assert = require('assert')

const moment = require('moment')

const analysis = require('../analysis')
const { DEPLOYMENT_ANNOTATION_NAME, EXPERIMENT_ANNOTATION_NAME } = require('./constants')
const { DecisionResults } = require('../plugins/plugin')
const DeploymentHelper = require('../deployment-helper')
const Watcher = require('./watcher')

class DeploymentWatcher extends Watcher {
  /**
   * Creates a deployment watcher
   *
   * @param {Object} options the options object
   * @param {Object} options.kubeClient the kube client instance
   * @param {Object} options.logger the logger instance
   * @param {Object} options.deploymentDescriptor the gated deployment resource
   * @param {string} options.namespace the namespace of the deployment
   * @param {string} options.plugins the decision plugins
   * @param {number} options.pollerIntervalMilliseconds the poller interval in milliseconds
   * @param {string} options.gatedDeploymentId the gated deployment id
   */
  constructor ({
    kubeClient,
    logger,
    deploymentDescriptor,
    namespace,
    plugins,
    pollerIntervalMilliseconds,
    gatedDeploymentId
  }) {
    super()
    this._kubeClient = kubeClient
    this._logger = logger
    this._deploymentDescriptor = deploymentDescriptor
    this._namespace = namespace
    this._plugins = plugins
    this._pollerIntervalMilliseconds = pollerIntervalMilliseconds
    this._gatedDeploymentId = gatedDeploymentId

    this._deploymentHelper = new DeploymentHelper({ kubeClient, namespace })

    this._experiment = {
      startTime: null,
      pollerInterval: null,
      treatmentPodSpec: null
    }
  }

  /**
   * Returns a watch stream for the treatment deployment
   *
   * @returns {Object} the watch stream
   */
  getStream () {
    return this._kubeClient.apis.apps.v1.watch.namespaces(this._namespace).deploy(this._deploymentDescriptor.treatment.name).getStream()
  }

  /**
   * Validates whether the existing annotation is valid and returns an object
   * containing the experiment start time and pod spec hash.
   *
   * @param {Object} treatmentDeployment the treatment deployment manifest
   * @returns {Object} the experiment annotation. An empty object if it doesn't
   * exist or is invalid
   */
  _validateAndGetExperimentAnnotation (treatmentDeployment) {
    try {
      const annotationValue = JSON.parse(treatmentDeployment.metadata.annotations[EXPERIMENT_ANNOTATION_NAME])
      assert(annotationValue && annotationValue.startTime && annotationValue.podSpecHash)
      annotationValue.startTime = moment.utc(annotationValue.startTime, moment.ISO_8601, true)
      assert(annotationValue.startTime.isValid())
      return annotationValue
    } catch (err) {
      return {}
    }
  }

  /**
   * Compares control and treatment deployments and returns true if the control
   * and treatment pod specs differ
   *
   * @param {Object} treatmentDeployment the treatment deployment manifest
   * @returns {boolean} whether experiment can be started or not
   */
  async _isEligibleForExperiment (treatmentDeployment) {
    const controlDeployment = (await this._deploymentHelper.get(this._deploymentDescriptor.control.name)).body

    return !this._deploymentHelper.isPodSpecIdentical(controlDeployment, treatmentDeployment)
  }

  /**
   * Checks if the treatment deployment is eligible for experiment and starts an
   * experiment by creating the poller
   *
   * @param {Object} treatmentDeployment the treatment deployment manifest
   */
  async _startExperiment (treatmentDeployment) {
    try {
      const existingExperimentAnnotation = this._validateAndGetExperimentAnnotation(treatmentDeployment)
      const podSpecHash = this._deploymentHelper.getPodSpecHash(treatmentDeployment)
      let newExperimentAnnotation = null
      if (treatmentDeployment.spec.replicas > 0) {
        if (await this._isEligibleForExperiment(treatmentDeployment)) {
          this._logger.info(`${this._gatedDeploymentId}: Starting experiment`)
          // If the annotation includes an experiment and the pod spec matches,
          // use start time from the annotation
          const startTime = existingExperimentAnnotation.podSpecHash === podSpecHash ? existingExperimentAnnotation.startTime : moment.utc()
          newExperimentAnnotation = JSON.stringify({ startTime, podSpecHash })
          this._experiment.startTime = startTime
          this._experiment.pollerInterval = setInterval(this._poll.bind(this), this._pollerIntervalMilliseconds)
          this._experiment.treatmentPodSpec = treatmentDeployment.spec.template.spec
          for (const plugin of this._plugins) {
            plugin.onExperimentStart(this._experiment.startTime)
          }
        } else {
          // If the treatment is the same as control, kill treatment and set no
          // harm annotation as we don't need an experiment to compare identical
          // deployments.
          this._logger.info(`${this._gatedDeploymentId}: Found non zero treatment replicas with same image as control. Killing treatment and setting no harm`)
          await this._killTreatment(analysis.results.noHarm)
        }
      }
      await this._deploymentHelper.setAnnotation(this._deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, newExperimentAnnotation)
    } catch (err) {
      this._logger.error(err, `${this._gatedDeploymentId}: Error occurred when starting experiment`)
    }
  }

  /**
   * Clears the experiment by stopping the poller
   */
  async _clearExperiment () {
    if (this._experiment.pollerInterval) {
      this._logger.info(`${this._gatedDeploymentId}: Stopping experiment`)
      clearInterval(this._experiment.pollerInterval)
      this._experiment.startTime = null
      this._experiment.pollerInterval = null
      this._experiment.treatmentPodSpec = null
      for (const plugin of this._plugins) {
        plugin.onExperimentStop()
      }
      try {
        await this._deploymentHelper.setAnnotation(this._deploymentDescriptor.treatment.name, EXPERIMENT_ANNOTATION_NAME, null)
      } catch (err) {
        this._logger.error(err, `${this._gatedDeploymentId}: Error occurred when clearing experiment`)
      }
    }
  }

  /**
   * Kills treatment and sets the deployment annotation
   *
   * @param {string} annotationValue the annotation value
   */
  async _killTreatment (annotationValue) {
    await this._deploymentHelper.kill(this._deploymentDescriptor.treatment.name)
    await this._deploymentHelper.setAnnotation(this._deploymentDescriptor.treatment.name, DEPLOYMENT_ANNOTATION_NAME, annotationValue)
  }

  /**
   * Updates control spec to treatment, sets number of replicas for treatment
   * to zero, sets treatment annotation to harm and stops the experiment
   */
  async _passExperiment () {
    const { treatmentPodSpec } = this._experiment

    // NOTE: experiment must be cleared first, then deployment should be killed
    // before setting the annotation because they trigger a modify event, which
    // would try to clear any existing experiment and start a new experiment
    await this._clearExperiment()

    this._logger.info(`${this._gatedDeploymentId}: Updating control with treatment and killing treatment`)
    await this._deploymentHelper.updatePodSpec(this._deploymentDescriptor.control.name, treatmentPodSpec)
    await this._killTreatment(analysis.results.noHarm)
  }

  /**
   * Sets number of replicas for treatment to zero, sets treatment annotation to
   * harm and stops the experiment
   */
  async _failExperiment () {
    await this._clearExperiment()

    this._logger.info(`${this._gatedDeploymentId}: Killing treatment`)
    await this._killTreatment(analysis.results.harm)
  }
  /**
   * Polls all decision plugins, and aggregates those results to decide whether to fail, pass
   * or let the experiment keep running
   */
  async _poll () {
    const results = await Promise.all(this._plugins.map(async plugin => {
      try {
        return await plugin.onExperimentPoll(this._deploymentDescriptor.control.name, this._deploymentDescriptor.treatment.name)
      } catch (err) {
        this._logger.error(`${this._gatedDeploymentId}: Error occurred when polling plugin`, err)
        return DecisionResults.WAIT
      }
    }))

    // If any plugins return FAIL, then fail the experiment
    if (results.some(result => result === DecisionResults.FAIL)) {
      this._logger.info(`${this._gatedDeploymentId}: Experiment failed`)
      await this._failExperiment()
    } else if (results.every(result => result === DecisionResults.PASS)) {
      // If all plugins return PASS, then pass the experiment
      this._logger.info(`${this._gatedDeploymentId}: Experiment success`)
      await this._passExperiment()
    } else {
      this._logger.info(`${this._gatedDeploymentId}: Experiment not yet significant`)
    }
  }

  /**
   * Starts an experiment for the new treatment deployment, if eligible
   *
   * @param {Object} deployment the deployment manifest
   * @returns {Promise} a promise that resolves when the experiment is started
   * if eligible.
   */
  onAdded (deployment) {
    this._previous = deployment
    return this._startExperiment(deployment)
  }

  /**
   * Clears any existing experiment and starts a new experiment for the
   * modified treatment deployment, if eligible
   *
   * @param {Object} deployment the deployment manifest
   */
  async onModified (deployment) {
    // NOTE: Modify events are triggered multiple times when pods associated
    // with the deploy are affected. Only clear and start an experiment if one
    // does not already exist or if the replicas or spec changes from the
    // treatment deployment used for the experiment
    if (!this._previous ||
      deployment.spec.replicas !== this._previous.spec.replicas ||
      !this._deploymentHelper.isPodSpecIdentical(deployment, this._previous)
    ) {
      await this._clearExperiment()
      await this._startExperiment(deployment)
    }
    this._previous = deployment
  }

  /**
   * Clears any existing experiment
   *
   * @returns {Promise} a promise that resolves when the experiment is started
   * if eligible.
   */
  onDeleted () {
    this._previous = null
    return this._clearExperiment()
  }
}

module.exports = DeploymentWatcher
