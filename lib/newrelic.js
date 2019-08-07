const moment = require('moment')
const rp = require('request-promise')
const util = require('util')

const AVERAGE_TEMPLATE = 'SELECT average(duration), count(*) FROM Transaction SINCE ' +
                         "'%s' UNTIL now WHERE host LIKE '%s' AND appName = '%s' AND `request.uri` LIKE '%s'"

const SAMPLES_TEMPLATE = "SELECT duration FROM Transaction SINCE '%s' UNTIL now WHERE " +
                         "host LIKE '%s' AND appName = '%s' AND `request.uri` LIKE '%s' LIMIT 1000"

//
// https://docs.newrelic.com/docs/insights/insights-api/get-data/query-insights-event-data-api
//
class NewRelicClient {
  constructor ({ accountId, key }) {
    this.accountId = accountId
    this.key = key
  }

  async _query ({ nrql }) {
    const result = await rp({
      method: 'GET',
      uri: `https://insights-api.newrelic.com/v1/accounts/${this.accountId}/query`,
      json: true,
      qs: {
        nrql
      },
      headers: {
        'X-Query-Key': this.key
      }
    })
    return result.results
  }

  /**
   * Return performance of a group (e.g., "treatment" or "control")
   * given a hostPrefix, following the convention that host names for the group
   * start with the hostPrefix (e.g., the deployment name,
   * "example-rest-service-treatment" or "example-rest-service-control").
   * @returns {Promise} Promise object resolving to performance data.
   */
  queryAverage ({ since, hostPrefix, appName, pathName }) {
    //
    // https://docs.newrelic.com/docs/insights/use-insights-ui/time-settings/set-time-range-insights-dashboards-charts
    // http://momentjs.com/docs/#/displaying/format/
    //
    const utcSince = moment(since).utc().format('YYYY-MM-DD HH:mm:ss')
    const nrql = util.format(AVERAGE_TEMPLATE, utcSince, `${hostPrefix}%`, appName, pathName)
    return this._query({ nrql })
  }

  async querySamples ({ since, hostPrefix, appName, pathName }) {
    const utcSince = moment(since).utc().format('YYYY-MM-DD HH:mm:ss')
    const nrql = util.format(SAMPLES_TEMPLATE, utcSince, `${hostPrefix}%`, appName, pathName)
    const results = await this._query({ nrql })
    return results[0].events.map(({ duration }) => duration)
  }
}

/**
 * Creates and returns a NewRelicClient with account id and key in secrets
 * @param {string} namespace - namespace to find secret in
 * @param {Object} kubeClient - Client for interacting with kubernetes cluster.
 * @param {Object} config - NewRelic config from deployment descriptor that contains
 *  accountId, secretName, and secretKey
 */
async function getClientFromSecret ({
  namespace,
  kubeClient,
  config
}) {
  const kubeNamespace = kubeClient.api.v1.namespaces(namespace)
  const encodedNewRelicKey = (await kubeNamespace.secrets(config.secretName).get()).body.data[config.secretKey]
  const newRelicKey = Buffer.from(encodedNewRelicKey, 'base64').toString()
  const newRelicClient = new NewRelicClient({
    accountId: config.accountId,
    key: newRelicKey
  })
  return newRelicClient
}

module.exports = {
  NewRelicClient,
  getClientFromSecret
}
