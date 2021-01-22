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
const LaunchDarkly = require('launchdarkly-node-server-sdk');
const hash = require('object-hash');

const { BaseController, FetchEnvs } = require('@razee/razeedeploy-core');


const clients = {};

module.exports = class FeatureFlagSetLDController extends BaseController {
  constructor(params) {
    params.finalizerString = params.finalizerString || 'client.featureflagset.deploy.razee.io';
    super(params);
  }

  async added() {
    this._instanceUid = objectPath.get(this.data, ['object', 'metadata', 'uid']);

    let sdkkey = await this._getSdkKey();
    this._sdkkeyHash = hash(sdkkey);

    let client = objectPath.get(clients, [sdkkey, 'client']);
    if (client === undefined) {
      client = LaunchDarkly.init(sdkkey);
      await client.waitForInitialization();
      objectPath.set(clients, [sdkkey, 'client'], client);
    }
    objectPath.set(clients, [sdkkey, 'instances', this._instanceUid], true);

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
          client: this._sdkkeyHash
        }
      },
      data: variation.allValues()
    };
    let res = await this.patchSelf(patchObject);
    objectPath.set(this.data, 'object', res); // save latest patch response

    if (!objectPath.get(clients, [sdkkey, 'watching'], false)) {
      client.on('update', async () => {
        try {
          let res = await this.kubeResourceMeta.get(undefined, undefined, { qs: { labelSelector: `client=${this._sdkkeyHash}` } });
          await Promise.all(res.items.map(async i => {
            let patchObject = {
              status: {
                FeatureFlagUpdateReceived: new Date(Date.now())
              }
            };
            let name = objectPath.get(i, 'metadata.name');
            let namespace = objectPath.get(i, 'metadata.namespace');
            let res = await this.kubeResourceMeta.mergePatch(name, namespace, patchObject, { status: true });
            return res;
          }));
        } catch (e) {
          this.errorHandler(e);
        }
      });
      objectPath.set(clients, [sdkkey, 'watching'], true);
    }
  }

  async _getSdkKey() {
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

    return this._sdkkey;
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
    let identity = objectPath.get(this.data, ['object', 'spec', 'identity']);
    let identityRef = objectPath.get(this.data, ['object', 'spec', 'identityRef']);
    if (identityRef) {
      let fetchEnvs = new FetchEnvs(this);
      return fetchEnvs.get('spec.identityRef');
    } else if (!identity) {
      return {};
    } else if (typeof identity == 'string') {
      let identityCM = await this.kubeResourceMeta.request({ uri: `/api/v1/namespaces/${this.namespace}/configmaps/${identity}`, json: true });
      let identityData = objectPath.get(identityCM, 'data', {});

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
        }
      }
      return idObject;
    } else {
      return {};
    }
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

  _getSdkKeyFromDict(instanceUid) {
    const sdkKeys = Object.keys(clients);
    for (let i = 0; i < sdkKeys.length; i++) {
      const sdkKey = sdkKeys[i];
      const instanceUids = Object.keys(objectPath.get(clients, [sdkKey, 'instances']));
      for (let j = 0; j < instanceUids.length; j++) {
        const uid = instanceUids[j];
        if (uid === instanceUid) {
          return sdkKey;
        }
      }
    }
  }

  async finalizerCleanup() {
    let instanceUid = objectPath.get(this.data, ['object', 'metadata', 'uid']);
    let sdkkey;
    try {
      sdkkey = await this._getSdkKey();
    } catch (e) {
      this.log.warn(`Failed to get sdk key from kube-api during ${this.name}'s finalizer cleanup. resorting to table lookup.`, e);
      sdkkey = this._getSdkKeyFromDict(instanceUid);
      if (sdkkey === undefined) {
        this.log.debug('No sdkkey found in table lookup, skipping cleanup since sdkkey is not associated with a client.');
        return;
      }
    }
    objectPath.del(clients, [sdkkey, 'instances', instanceUid]);

    if (Object.keys(objectPath.get(clients, [sdkkey, 'instances'], {})).length == 0) {
      this.log.debug(`Closing client ${sdkkey}`);
      const client = objectPath.get(clients, [sdkkey, 'client'], { close: () => { } });
      client.close();
      objectPath.del(clients, [sdkkey]);
      this.log.debug(`Client closed successfully ${sdkkey}`);
    }
  }

};
