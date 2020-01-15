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
    let sdkkeyAlpha1 = objectPath.get(this.data, ['object', 'spec', 'sdk-key']);
    let sdkkeyStr = objectPath.get(this.data, ['object', 'spec', 'sdkKey']);
    let sdkkeyRef = objectPath.get(this.data, ['object', 'spec', 'sdkKeyRef']);

    if (typeof sdkkeyAlpha1 == 'string') {
      this._sdkkey = sdkkeyAlpha1;
    } else if (typeof sdkkeyStr == 'string') {
      this._sdkkey = sdkkeyStr;
    } else if (typeof sdkkeyAlpha1 == 'object') {
      let secretName = objectPath.get(sdkkeyAlpha1, 'valueFrom.secretKeyRef.name');
      let secretNamespace = objectPath.get(sdkkeyAlpha1, 'valueFrom.secretKeyRef.namespace', this.namespace);
      let secretKey = objectPath.get(sdkkeyAlpha1, 'valueFrom.secretKeyRef.key');
      this._sdkkey = await this._getSecretData(secretName, secretKey, secretNamespace);
    } else if (typeof sdkkeyRef == 'object') {
      let secretName = objectPath.get(sdkkeyRef, 'valueFrom.secretKeyRef.name');
      let secretNamespace = objectPath.get(sdkkeyRef, 'valueFrom.secretKeyRef.namespace', this.namespace);
      let secretKey = objectPath.get(sdkkeyRef, 'valueFrom.secretKeyRef.key');
      this._sdkkey = await this._getSecretData(secretName, secretKey, secretNamespace);
    }
    if (!this._sdkkey) {
      throw Error('A LaunchDarkly SDK Key must be defined');
    }
    let sdkkey = this._sdkkey;

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

    let identity = await this.assembleIdentity();
    let identityKey = objectPath.get(this.data, ['object', 'spec', 'identityKey']) || objectPath.get(this.data, ['object', 'spec', 'identity-key']);

    let userID = objectPath.get(identity, [identityKey]);
    if (!userID) {
      if (identityKey) {
        let msg = `Key '${identityKey}' not found in identity ConfigMap.. defaulting to Namespace UID.`;
        this.log.warn(msg);
        this.updateRazeeLogs('warn', { controller: 'FeatureFlagSetLD', warn: msg });
      }
      let namespace = await this.kubeResourceMeta.request({ uri: `/api/v1/namespaces/${this.namespace}`, json: true });
      userID = objectPath.get(namespace, 'metadata.uid');
    }
    let user = { key: userID, custom: identity };
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
    let res = await this.patchSelf(patchObject);
    objectPath.set(this.data, 'object', res); // save latest patch response

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

  async _getSecretData(name, key, ns) {
    if (!name || !key) {
      return;
    }
    let res = await this.kubeResourceMeta.request({ uri: `/api/v1/namespaces/${ns || this.namespace}/secrets/${name}`, json: true });
    let secret = Buffer.from(objectPath.get(res, ['data', key], ''), 'base64').toString();
    return secret;
  }

  async assembleIdentity() {
    let identity = objectPath.get(this.data, ['object', 'spec', 'identityRef']) || objectPath.get(this.data, ['object', 'spec', 'identity']);
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
        let namespace = this.namespace;
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
            if (identityData) {
              switch (type) {
                case 'number':
                  identityData = {
                    [key]: Number(identityData)
                  };
                  break;
                case 'boolean':
                  identityData = {
                    [key]: Boolean(identityData)
                  };
                  break;
                case 'json':
                  identityData = JSON.parse(identityData);
                  break;
                default:
                  identityData = {
                    [key]: identityData
                  };
                  break;
              }
            }
          } else {
            identityData = objectPath.get(identityCM, 'data', {});
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

  dataToHash(resource) {
    // Override if you have other data as important.
    // Changes to these sections allow modify event to proceed.
    return {
      labels: objectPath.get(resource, 'metadata.labels'),
      spec: objectPath.get(resource, 'spec'),
      FeatureFlagUpdateReceived: objectPath.get(resource, 'status.FeatureFlagUpdateReceived'),
      IdentityUpdateReceived: objectPath.get(resource, 'status.IdentityUpdateReceived')
    };
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
