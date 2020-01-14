const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const clone = require('clone');
const body_parser = require('body-parser');
const objectPath = require('object-path');
const log = require('./bunyan-api').createLogger('conversionWebhookServer');
const app = express();

const credentials = {
  key: fs.readFileSync('src/creds/key.pem'),
  cert: fs.readFileSync('src/creds/cert.pem')
};

app.use(body_parser.json({ limit: '8mb' }));

app.get('/liveness', (req, res) => {
  log.info('Liveness has been gotten');
  return res.sendStatus(200);
});
app.get('/readiness', (req, res) => {
  log.info('Readiness has been gotten');
  return res.sendStatus(200);
});

app.post('/crd-conversion', (req, res) => {
  log.debug(objectPath.get(req, 'body'));

  // Request
  let desiredVersion = objectPath.get(req, 'body.request.desiredAPIVersion');
  let requestObjs = objectPath.get(req, 'body.request.objects', []);

  // Response
  let convertedObjs = [];
  let responseJson = {
    'apiVersion': objectPath.get(req, 'body.apiVersion'),
    'kind': 'ConversionReview',
    'response': {
      'uid': objectPath.get(req, 'body.request.uid'),
      'result': {
        'status': 'Success'
      }
    }
  };

  // if there are no async/await requirements for conversion steps, change this to a forEach loop
  for (var i = 0; i < requestObjs.length; i++) {
    let requestObj = requestObjs[i];
    let { convertedObj, conversionStatus } = convertResource(requestObj, desiredVersion);

    // if a conversion step fails, set conversionStatus.status to 'Failed' with an optional message in conversionStatus.message
    // Warning: Failing conversion can disrupt read and write access to the custom resources, including the ability to update or delete the resources. Conversion failures should be avoided whenever possible
    objectPath.set(responseJson, 'response.result.status', conversionStatus.status);
    objectPath.set(responseJson, 'response.result.message', conversionStatus.message);

    // save converted object to final array
    convertedObjs.push(convertedObj);
  }
  // attach final converted objects array to response
  objectPath.set(responseJson, 'response.convertedObjects', convertedObjs);

  log.debug(responseJson);
  res.json(responseJson);
});

https.createServer(credentials, app).listen(443, () => { log.info('Listening on port 443'); });
http.createServer(app).listen(8080, () => { log.info('Listening on port 8080'); });


// Conversion functions ========================================================

function convertResource(requestObj, desiredVersion) {
  let convertedObj = clone(requestObj);
  let conversionStatus = { status: 'Success' };

  // prep convertedObj
  objectPath.del(convertedObj, 'spec');
  objectPath.set(convertedObj, 'apiVersion', desiredVersion);

  // do conversion steps
  objectPath.set(convertedObj, 'metadata.annotations.razeedeploy', `This object has been converted from '${objectPath.get(requestObj, 'apiVersion')}' to '${desiredVersion}' by the RazeeDeploy Conversion Webhook Server. Please replace your currently saved resource with this one.`);
  convertSdkKey(requestObj, convertedObj);
  convertIdentity(requestObj, convertedObj);
  convertIdentityKey(requestObj, convertedObj);

  return { convertedObj, conversionStatus };
}

function convertSdkKey(requestObj, convertedObj) {
  let sdkKey = objectPath.get(requestObj, 'spec.sdk-key');
  if (typeof sdkKey == 'string') {
    objectPath.set(convertedObj, 'spec.sdkKey', sdkKey);
  } else if (typeof sdkKey == 'object') {
    objectPath.set(convertedObj, 'spec.sdkKeyRef', sdkKey);
  }
}

function convertIdentity(requestObj, convertedObj) {
  let identity = objectPath.get(requestObj, 'spec.identity');
  if (typeof identity == 'string') { // Get whole configmap via 'envFrom'
    let envFromIdStr = { 'configMapRef': { 'name': identity } };
    objectPath.push(convertedObj, 'spec.identityRef.envFrom', envFromIdStr);
  } else if (Array.isArray(identity)) {
    identity.forEach(id => {
      if (typeof id == 'string') { // Get whole configmap via 'envFrom'
        let envFromIdStr = { 'configMapRef': { 'name': id } };
        objectPath.push(convertedObj, 'spec.identityRef.envFrom', envFromIdStr);
      } else if (typeof id == 'object') {
        let hasKey = objectPath.has(id, 'valueFrom.configMapKeyRef.key');
        if (hasKey) { // Get single key from configmap via 'env'
          let envIdObj = { 'name': objectPath.get(id, 'valueFrom.configMapKeyRef.key'), 'valueFrom': objectPath.get(id, 'valueFrom') };
          objectPath.push(convertedObj, 'spec.identityRef.env', envIdObj);
        } else { // Get whole configmap via 'envFrom'
          let envFromIdObj = { 'configMapRef': { 'name': objectPath.get(id, 'valueFrom.configMapKeyRef.name'), 'namespace': objectPath.get(id, 'valueFrom.configMapKeyRef.name') } };
          objectPath.push(convertedObj, 'spec.identityRef.envFrom', envFromIdObj);
        }
      }
    });
  }
}

function convertIdentityKey(requestObj, convertedObj) {
  let identityKey = objectPath.get(requestObj, 'spec.identity-key');
  objectPath.set(convertedObj, 'spec.identityKey', identityKey);
}

// End Conversion functions ====================================================
