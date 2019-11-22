const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
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
  return res.sendStatus(200);
});

app.post('/crd-conversion', (req, res) => {
  let responseJson = {
    'apiVersion': 'apiextensions.k8s.io/v1beta1',
    'kind': 'ConversionReview'
  };
  objectPath.set(responseJson, 'response.uid', objectPath.get(req, 'body.request.uid'));
  objectPath.set(responseJson, 'response.result', { 'status': 'Success' });
  let desiredVersion = objectPath.get(req, 'body.request.desiredAPIVersion');
  let objs = objectPath.get(req, 'body.request.objects', []);
  for (var i = 0; i < objs.length; i++) {
    objectPath.set(objs, [i, 'apiVersion'], desiredVersion);
    objectPath.set(objs, [i, 'metadata', 'annotations', 'razee'], 'you\'ve been converted');
  }
  objectPath.set(responseJson, 'response.convertedObjects', objs);
  res.json(responseJson);
});

https.createServer(credentials, app).listen(443, () => { log.info('Listening on port 443'); });
http.createServer(app).listen(8080, () => { log.info('Listening on port 8080'); });
