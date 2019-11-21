const express = require('express');
const body_parser = require('body-parser');
const objectPath = require('object-path');
const log = require('./bunyan-api').createLogger('conversionWebhookServer');
const app = express();
const port = 8080;

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

app.listen(port, () => log.info(`app listening on port ${port}`));
