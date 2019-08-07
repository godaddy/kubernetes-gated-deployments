'use strict'

/* eslint-disable no-process-env */

const environment = process.env.NODE_ENV
  ? process.env.NODE_ENV.toLowerCase() : 'development'

// Validate environment
const validEnvironments = new Set(['development', 'test', 'production'])
if (!validEnvironments.has(environment)) {
  throw new Error(`Invalid environment: ${environment}`)
}

// Load env file only when development env
if (environment === 'development') {
  require('dotenv').config()
}

const pollerIntervalMilliseconds = process.env.POLLER_INTERVAL_MILLISECONDS
  ? Number(process.env.POLLER_INTERVAL_MILLISECONDS) : 30000

const controllerNamespace = process.env.CONTROLLER_NAMESPACE || 'kubernetes-gated-deployments'
const logLevel = process.env.LOG_LEVEL || 'info'

module.exports = {
  controllerNamespace,
  environment,
  logLevel,
  pollerIntervalMilliseconds
}
