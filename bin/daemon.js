#!/usr/bin/env node

'use strict'

// make-promises-safe installs an process.on('unhandledRejection') handler
// that prints the stacktrace and exits the process
// with an exit code of 1, just like any uncaught exception.
require('make-promises-safe')

const GatedDeploymentWatcher = require('../lib/watchers/gated-deployment-watcher')

const {
  kubeClient,
  customResourceManager,
  customResourceManifest,
  logger,
  pollerIntervalMilliseconds,
  controllerNamespace
} = require('../config')

async function main () {
  logger.info('loading kube specs')
  await kubeClient.loadSpec()
  logger.info('successfully loaded kube specs')
  logger.info('updating CRD')
  await customResourceManager.upsertResource({ customResourceManifest })
  logger.info('successfully updated CRD')

  const gatedDeploymentWatcher = new GatedDeploymentWatcher({
    controllerNamespace,
    kubeClient,
    logger,
    pollerIntervalMilliseconds
  })

  logger.info('starting app')
  gatedDeploymentWatcher.start()
  logger.info('successfully started app')
}

main()
