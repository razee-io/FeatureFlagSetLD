/**
 * Copyright 2019 IBM Corp. All Rights Reserved.
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

const { EventHandler, KubeClass } = require('@razee/kubernetes-util');

const ControllerString = 'FeatureFlagSetLD';
const Controller = require(`./${ControllerString}Controller`);
const log = require('./bunyan-api').createLogger(ControllerString);

async function createNewEventHandler(kc) {
  let result;
  let resourceMeta = await kc.getKubeResourceMeta('deploy.razee.io/v1alpha1', ControllerString, 'watch');
  if (resourceMeta) {
    let params = {
      kubeResourceMeta: resourceMeta,
      factory: Controller,
      kubeClass: kc,
      logger: log,
      requestOptions: { qs: { timeoutSeconds: process.env.CRD_WATCH_TIMEOUT_SECONDS || 300 } },
      livenessInterval: true
    };
    result = new EventHandler(params);
  } else {
    log.error(`Unable to find KubeResourceMeta for deploy.razee.io/v1alpha1: ${ControllerString}`);
  }
  return result;
}

async function main() {
  let kc;
  try {
    log.info(`Running ${ControllerString}Controller.`);
    kc = new KubeClass();
  } catch (e) {
    log.error(e, 'Failed to get KubeClass.');
  }
  try {
    await createNewEventHandler(kc);
  } catch (e) {
    log.error(e, 'Error creating new event handler.');
  }
}

function createEventListeners() {
  process.on('SIGTERM', () => {
    log.info('recieved SIGTERM. not handling at this time.');
  });
  process.on('unhandledRejection', (reason) => {
    log.error('recieved unhandledRejection', reason);
  });
  process.on('beforeExit', (code) => {
    log.info(`No work found. exiting with code: ${code}`);
  });

}

async function run() {
  try {
    createEventListeners();
    await main();
  } catch (error) {
    log.error(error);
  }

}

module.exports = {
  run,
  FeatureFlagSetLDController: Controller
};
