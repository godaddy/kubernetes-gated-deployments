const { isDeepStrictEqual } = require('util')

const clone = require('clone')
const hash = require('object-hash')

/**
 * Class with utilities to update deployments
 */
class DeploymentHelper {
  constructor ({ kubeClient, namespace }) {
    this._kubeClient = kubeClient
    this._namespace = namespace
  }

  /**
   * Gets a deployment
   * @param {string} name the deployment name
   * @returns {Promise} a promise that resolves with the deployment object
   */
  get (name) {
    const kubeNamespace = this._kubeClient.apis.apps.v1.namespaces(this._namespace)
    return kubeNamespace.deploy(name).get()
  }

  /**
   * Patches a deployment in the namespace
   *
   * @param {string} name the deployment name
   * @param {Object} patch the object to patch the deployment with
   * @returns {Promise} a promise that resolves if the patch succeeded
   */
  patch (name, patch) {
    const kubeNamespace = this._kubeClient.apis.apps.v1.namespaces(this._namespace)
    return kubeNamespace.deploy(name).patch(patch)
  }

  /**
   * Sets deployment to zero replicas.
   * @param {string} name - Kubernetes deployment name.
   * @returns {Promise} a promise that resolves if the deployment was
   * successfully killed
   */
  kill (name) {
    const replicaSetZero = {
      body: {
        spec: {
          replicas: 0
        }
      }
    }
    return this.patch(name, replicaSetZero)
  }

  /**
   * Sets deployment to the specified pod spec
   * @param {string} name - Kubernetes deployment name.
   * @param {string} podSpec - Deployment pod spec.
   * @returns {Promise} a promise that resolves if the deployment spec was
   * successfully updated.
   */
  updatePodSpec (name, podSpec) {
    const replacementPodSpec = clone(podSpec)
    replacementPodSpec.containers.push({ $patch: 'replace' })
    const newDeploymentSpec = {
      body: {
        spec: {
          template: {
            spec: replacementPodSpec
          }
        }
      }
    }
    return this.patch(name, newDeploymentSpec)
  }

  /**
   * Sets deployment annotation given key and value
   * @param {string} name - Kubernetes deployment name.
   * @param {string} key - Annotation key
   * @param {string} value - Annotation value
   * @returns {Promise} a promise that resolves if the annotation was
   * successfully set on the deployment
   */
  setAnnotation (name, key, value) {
    const spec = {
      body: {
        metadata: {
          annotations: {
            [key]: value
          }
        }
      }
    }
    return this.patch(name, spec)
  }

  /**
   * Compares the pod spec of the two deployments and returns true if they're
   * identical and false otherwise
   *
   * @param {Object} deployment1 a deployment object
   * @param {Object} deployment2 a deployment object
   * @returns {boolean} true if the pod specs are identical, false otherwise
   */
  isPodSpecIdentical (deployment1, deployment2) {
    return isDeepStrictEqual(deployment1.spec.template.spec, deployment2.spec.template.spec)
  }

  /**
   * Returns the hash of the pod spec in the deployment object
   *
   * @param {Object} deployment a deployment object
   * @returns {string} the hash of the pod spec
   */
  getPodSpecHash (deployment) {
    return hash(deployment.spec.template.spec)
  }
}

module.exports = DeploymentHelper
