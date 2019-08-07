/* eslint-env mocha */
const chai = require('chai')
const clone = require('clone')
const hash = require('object-hash')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')

const DeploymentHelper = require('./deployment-helper')

chai.use(sinonChai)

const { expect } = chai

describe('DeploymentHelper', () => {
  let kubeNamespaceMock, deployMock, kubeClientMock, deploymentHelper
  const deployment = { some: 'deploy' }

  beforeEach(() => {
    kubeClientMock = sinon.mock()
    deployMock = sinon.mock()
    deployMock.patch = sinon.stub().resolves()
    deployMock.get = sinon.stub().resolves(deployment)
    kubeNamespaceMock = sinon.mock()
    kubeNamespaceMock.deploy = sinon.stub().returns(deployMock)
    kubeClientMock.apis = sinon.mock()
    kubeClientMock.apis.apps = sinon.mock()
    kubeClientMock.apis.apps.v1 = sinon.mock()
    kubeClientMock.apis.apps.v1.namespaces = sinon.stub().returns(kubeNamespaceMock)

    deploymentHelper = new DeploymentHelper({
      kubeClient: kubeClientMock,
      namespace: 'ns'
    })
  })

  describe('.get', () => {
    it('returns the deployment', async () => {
      const deploy = await deploymentHelper.get('foo')

      expect(deploy).to.deep.equal(deployment)
      expect(kubeNamespaceMock.deploy).to.have.been.calledWith('foo')
    })
  })

  describe('.patch', () => {
    it('patches the deployment', async () => {
      await deploymentHelper.patch('foo', { some: 'patch' })

      expect(kubeNamespaceMock.deploy).to.have.been.calledWith('foo')
      expect(deployMock.patch).to.have.been.calledWith({ some: 'patch' })
    })
  })

  describe('.kill', () => {
    it('patches the deployment to set replicas to 0', async () => {
      await deploymentHelper.kill('foo')

      expect(kubeNamespaceMock.deploy).to.have.been.calledWith('foo')
      expect(deployMock.patch).to.have.been.calledWith({
        body: {
          spec: {
            replicas: 0
          }
        }
      })
    })
  })

  describe('.updatePodSpec', () => {
    it('patches the deployment name with the given pod spec', async () => {
      const newSpec = {
        replicas: 2,
        containers: [
          {
            image: 'bar:latest'
          }
        ]
      }

      await deploymentHelper.updatePodSpec('foo', newSpec)

      expect(kubeNamespaceMock.deploy).to.have.been.calledWith('foo')
      expect(deployMock.patch).to.have.been.calledWith({
        body: {
          spec: {
            template: {
              spec: {
                ...newSpec,
                containers: [
                  ...newSpec.containers,
                  {
                    $patch: 'replace'
                  }
                ]
              }
            }
          }
        }
      })
    })
  })

  describe('.setAnnotation', () => {
    it('sets the annotation key/value pair', async () => {
      await deploymentHelper.setAnnotation('foo', 'gatedDeploymentStatus', 'success')

      expect(kubeNamespaceMock.deploy).to.have.been.calledWith('foo')
      expect(deployMock.patch).to.have.been.calledWith({
        body: {
          metadata: {
            annotations: {
              gatedDeploymentStatus: 'success'
            }
          }
        }
      })
    })
  })

  describe('.isPodSpecIdentical', () => {
    const podSpec = {
      containers: [
        { name: 'pod1', image: 'image1' },
        { name: 'pod2', image: 'image2' }
      ]
    }
    let deployment1, deployment2

    beforeEach(() => {
      deployment1 = {
        metadata: {
          name: 'deploy1'
        },
        spec: { template: { spec: clone(podSpec) } }
      }
      deployment2 = {
        metadata: {
          name: 'deploy2'
        },
        spec: { template: { spec: clone(podSpec) } }
      }
    })

    it('returns true for identical pod specs', () => {
      expect(deploymentHelper.isPodSpecIdentical(deployment1, deployment2)).to.equal(true)
    })

    it('returns false for non identical pod specs', () => {
      deployment2.spec.template.spec.containers[0].image = 'image11'
      expect(deploymentHelper.isPodSpecIdentical(deployment1, deployment2)).to.equal(false)
    })
  })

  describe('.getPodSpecHash', () => {
    it('returns hash of pod spec', () => {
      const podSpec = {
        containers: [
          { name: 'pod1', image: 'image1' },
          { name: 'pod2', image: 'image2' }
        ]
      }
      const deployment = {
        metadata: {
          name: 'deploy1'
        },
        spec: { template: { spec: clone(podSpec) } }
      }

      expect(deploymentHelper.getPodSpecHash(deployment)).to.equal(hash(podSpec))
    })
  })
})
