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

const objectPath = require('object-path');
const LaunchDarkly = require('ldclient-node');
const { Watchman } = require('@razee/kubernetes-util');

const { BaseController } = require('@razee/razeedeploy-core');


const clients = {};

module.exports = class FeatureFlagSetLDController extends BaseController {
  constructor(params) {
    params.finalizerString = params.finalizerString || 'client.featureflagset.deploy.razee.io';
    super(params);
  }

  async added() {
    let sdkkey = objectPath.get(this.data, ['object', 'spec', 'sdk-key']);
    this._sdkkey = sdkkey;
    if (!sdkkey) {
      throw Error('spec.sdk-key must be defined');
    }

    let client;
    if (clients[sdkkey]) {
      client = objectPath.get(clients, [sdkkey, 'client']);
    } else {
      client = LaunchDarkly.init(sdkkey);
      await client.waitForInitialization();
      objectPath.set(clients, [sdkkey, 'client'], client);
    }
    if (!objectPath.has(clients, [sdkkey, 'connections', this.namespace, this.name])) {
      objectPath.set(clients, [sdkkey, 'connections', this.namespace, this.name], {});
    }


    let namespaceID = await this.kubeResourceMeta.request({ uri: `/api/v1/namespaces/${this.namespace}`, json: true });
    namespaceID = objectPath.get(namespaceID, 'metadata.uid');
    let identity = await this.assembleIdentity();
    let user = { key: namespaceID, custom: identity };
    client.identify(user);
    let variation = await client.allFlagsState(user);

    let patchObject = {
      metadata: {
        labels: {
          client: sdkkey
        }
      },
      data: variation.allValues()
    };
    let cont = await this.patchSelf(patchObject);
    if (!cont) return;

    if (!objectPath.get(clients, [sdkkey, 'watching'], false)) {
      client.on('update', async () => {
        try {
          let res = await this.kubeResourceMeta.get(undefined, undefined, { qs: { labelSelector: `client=${sdkkey}` } });
          await Promise.all(res.items.map(async i => {
            let patchObject = {
              status: {
                FeatureFlagUpdateReceived: new Date(Date.now())
              }
            };
            let name = objectPath.get(i, 'metadata.name');
            let namespace = objectPath.get(i, 'metadata.namespace');
            return await this.kubeResourceMeta.mergePatch(name, namespace, patchObject, { status: true });
          }));
        } catch (e) {
          this.errorHandler(e);
        }
      });
      objectPath.set(clients, [sdkkey, 'watching'], true);
    }
  }

  async assembleIdentity() {
    let identity = objectPath.get(this.data, ['object', 'spec', 'identity']);
    let newWatches = [];
    if (!identity) {
      this.reconcileWatchman(newWatches);
      return {};
    } else if (typeof identity == 'string') {
      let identityCM = await this.kubeResourceMeta.request({ uri: `/api/v1/namespaces/${this.namespace}/configmaps/${identity}`, json: true });
      let identityData = objectPath.get(identityCM, 'data', {});

      this.createWatchman(identity);

      newWatches.push(identity);
      this.reconcileWatchman(newWatches);
      return identityData;
    } else if (Array.isArray(identity)) {
      let idObject = {};
      for (var i = 0; i < identity.length; i++) {
        let name;
        let namespace;
        let key;
        let type;

        if (typeof identity[i] == 'string') {
          name = identity[i];
        } else if (objectPath.has(identity[i], 'valueFrom.configMapKeyRef')) {
          name = objectPath.get(identity[i], 'valueFrom.configMapKeyRef.name');
          namespace = objectPath.get(identity[i], 'valueFrom.configMapKeyRef.namespace', this.namespace);
          key = objectPath.get(identity[i], 'valueFrom.configMapKeyRef.key');
          type = objectPath.get(identity[i], 'valueFrom.configMapKeyRef.type');
        }

        if (name) {
          let identityCM = await this.kubeResourceMeta.request({ uri: `/api/v1/namespaces/${namespace}/configmaps/${name}`, json: true });
          let identityData;
          if (key) {
            identityData = objectPath.get(identityCM, ['data', key]);
          } else {
            identityData = objectPath.get(identityCM, 'data', {});
          }
          if (type && identityData) {
            switch (type) {
              case 'number':
                identityData = Number(identityData);
                break;
              case 'boolean':
                identityData = Boolean(identityData);
                break;
              case 'json':
                identityData = JSON.parse(identityData);
            }
          }
          if (identityData) {
            Object.assign(idObject, identityData);
          }

          this.createWatchman(name);
          newWatches.push(name);
        }
      }

      this.reconcileWatchman(newWatches);
      return idObject;
    } else {
      return {};
    }
  }

  reconcileWatchman(newlyAddedWatchesKeys) {
    let currentWatches = objectPath.get(clients, [this._sdkkey, 'connections', this.namespace, this.name], {});
    let currentWatchesKeys = Object.keys(currentWatches);
    currentWatchesKeys.map(key => {
      if (!newlyAddedWatchesKeys.includes(key)) {
        objectPath.get(clients, [this._sdkkey, 'connections', this.namespace, this.name, key], { end: () => {} }).end();
        objectPath.del(clients, [this._sdkkey, 'connections', this.namespace, this.name, key]);
      }
    });

  }

  createWatchman(cmName) {
    if (objectPath.has(clients, [this._sdkkey, 'connections', this.namespace, this.name, cmName])) {
      return;
    }
    let opt = {
      logger: this.log,
      requestOptions: this.kubeResourceMeta.kubeApiConfig,
      watchUri: `/api/v1/watch/namespaces/${this.namespace}/configmaps/${cmName}`
    };
    let wm = new Watchman(opt, (data) => {
      if (data.type === 'MODIFIED') {
        let patchObject = {
          status: {
            IdentityUpdateReceived: new Date(Date.now())
          }
        };
        this.kubeResourceMeta.mergePatch(this.name, this.namespace, patchObject, { status: true });
      } else if (data.type === 'DELETED') {
        objectPath.get(clients, [this._sdkkey, 'connections', this.namespace, this.name, cmName], { end: () => {} }).end();
        objectPath.del(clients, [this._sdkkey, 'connections', this.namespace, this.name, cmName]);
      }
    });
    wm.watch();
    objectPath.set(clients, [this._sdkkey, 'connections', this.namespace, this.name, cmName], wm);
  }

  async finalizerCleanup() {
    let key = objectPath.get(this.data, ['object', 'spec', 'sdk-key']);

    let identityWatches = objectPath.get(clients, [key, 'connections', this.namespace, this.name], {});
    Object.keys(identityWatches).map(watch => identityWatches[watch].end());

    objectPath.del(clients, [key, 'connections', this.namespace, this.name]);
    if (Object.keys(objectPath.get(clients, [key, 'connections', this.namespace], {})).length == 0) {
      objectPath.del(clients, [key, 'connections', this.namespace]);
    }
    if (Object.keys(objectPath.get(clients, [key, 'connections'], {})).length == 0) {
      this.log.debug(`Closing client ${key}`);
      let client = objectPath.get(clients, [key, 'client'], { close: () => {} });
      client.close();
      objectPath.del(clients, [key]);
      this.log.debug(`Client closed successfully ${key}`);
    }
  }

};
