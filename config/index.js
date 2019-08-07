'use strict'

const kube = require('kubernetes-client')
const pino = require('pino')

const envConfig = require('./environment')
const CustomResourceManager = require('../lib/custom-resource-manager')
const customResourceManifest = require('../custom-resource-manifest.json')

let kubeClientConfig
try {
  kubeClientConfig = kube.config.getInCluster()
} catch (err) {
  kubeClientConfig = kube.config.fromKubeconfig()
}
const kubeClient = new kube.Client({ config: kubeClientConfig })

const logger = pino({
  serializers: {
    err: pino.stdSerializers.err
  },
  level: envConfig.logLevel
})

const customResourceManager = new CustomResourceManager({
  kubeClient,
  logger
})

module.exports = {
  customResourceManager,
  customResourceManifest,
  ...envConfig,
  kubeClient,
  logger
}
