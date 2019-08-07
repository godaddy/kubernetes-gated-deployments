const StreamEvents = {
  DATA: 'data',
  END: 'end'
}

const WatchEvents = {
  ADDED: 'ADDED',
  DELETED: 'DELETED',
  MODIFIED: 'MODIFIED'
}

const WatcherStates = {
  READY: 'READY',
  RUNNING: 'RUNNING',
  ENDED: 'ENDED'
}

const DEPLOYMENT_ANNOTATION_NAME = 'gatedDeployStatus'
const EVENT_LOCK = 'eventLock'
const EXPERIMENT_ANNOTATION_NAME = 'gatedDeployExperiment'

module.exports = {
  DEPLOYMENT_ANNOTATION_NAME,
  EVENT_LOCK,
  EXPERIMENT_ANNOTATION_NAME,
  StreamEvents,
  WatchEvents,
  WatcherStates
}
