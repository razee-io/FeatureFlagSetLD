/**
 * Copyright 2020 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const axios = require('axios');
// const { KubeClass, KubeApiConfig } = require('@razee/kubernetes-util');
// const kubeApiConfig = KubeApiConfig();

const log = require('./bunyan-api').createLogger('upgradeStoredObjectsJob');

async function main() {
  log.info('Running Upgrade Stored Objects Job.');
  // const kc = new KubeClass(kubeApiConfig);
  // let resourceMeta = await kc.getKubeResourceMeta('apiVersion', 'kind', 'update');
  let cwsCode = {};
  let retry = 0;
  do {
    retry++ <= 10 ? await new Promise((resolve) => setTimeout(resolve, retry * 1000)) : process.exit(1);

    cwsCode = await axios({ method: 'get', url: 'http://conversionwebhookserver-service.razeedeploy.svc/readiness' }); // conversion webhook server ready for requests
    log.info(cwsCode.responseCode);
  } while (cwsCode.responseCode !== 200);

}

main().catch(e => log.error(e));
