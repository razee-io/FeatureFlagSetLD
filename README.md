# FeatureFlagSetLD

[![Build Status](https://travis-ci.com/razee-io/FeatureFlagSetLD.svg?branch=master)](https://travis-ci.com/razee-io/FeatureFlagSetLD)
[![Dependabot Status](https://api.dependabot.com/badges/status?host=github&repo=razee-io/FeatureFlagSetLD)](https://dependabot.com)
![GitHub](https://img.shields.io/github/license/razee-io/FeatureFlagSetLD.svg?color=success)

FeatureFlagSetLD is a resource used to fetch feature flag values, evaluated based
on cluster specific identity, and make the values available to resources on the
cluster.

## Install

```shell
kubectl apply -f "https://github.com/razee-io/FeatureFlagSetLD/releases/latest/download/resource.yaml"
```

## Resource Definition

### Sample

```yaml
apiVersion: deploy.razee.io/v1alpha1
kind: FeatureFlagSetLD
metadata:
  name: <name>
  namespace: <namespace>
spec:
  sdk-key: oneOf [launch_darkly_sdk_key string, valueFrom.secretKeyRef]
  identity: "<ConfigMap name>"
  identity-key: "<key from identity to use as LD user key>"
```

### Required Fields

- `.spec.sdk-key`
  - type: string
  - or
  - type: object
    - valueFrom
      - secretKeyRef:
        - name
          - type: string
        - key
          - type: string

## Features

### Identity

`.spec.identity`

Specifying the identity attribute will give the FeatureFlagSetLD cluster specific
data to send to LaunchDarkly for rule evaluation. This allows you to have unique
rules, based on cluster data, return different values.
eg. cluster data `type: dev` could match rules such as
`IF 'type' IS ONE OF 'dev' SERVE 'some new feature'`

- Schema:
  - oneOf:
    - type: string
    - type: array
      - items:
        - oneOf:
          - type: string
          - type: object
            - required: [valueFrom.configMapKeyRef]

eg.

```yaml
        identity: "<ConfigMap name>"

        identity:
        - "<ConfigMap name>"

        identity:
        - valueFrom:
            configMapKeyRef:
              name: "<ConfigMap name>" # required
              key: "<key within ConfigMap>" # optional
              namespace: "<ConfigMap namespace>" # optional
              type: "json" # optional
```

#### Identity valueFrom

`.spec.identity[].valueFrom.configMapKeyRef`

If you need to specify a ConfigMap as the identity, but need to specify extra
lookup details, this is how you would do it.

- Schema:
  - type: object
    - required: [name]
    - optional: [namespace, key, type]

Optional field details:

- namespace:
  - Default: `this.namespace`
  - Usage: specified specific namespace to lookup ConfigMap from
- key
  - Default: `undefined`
  - Usage: specify single key from ConfigMap to use in identity. if left undefined,
  entire ConfigMap will be part of identity.
- type
  - Default: string
  - options: ['json']
  - Usage: when you have a stringified JSON object in a ConfigMap that you want
  to use as your identity, specifying this will parse the JSON and use all the items
  in the JSON as part of the identity.

#### Identity-Key

`.spec.identity-key`

If you need to specify a specific key to use as the user key in LaunchDarkly, this
allows you to identify the key in the identity ConfigMap to use.

- Schema:
  - type: string
  - default: ffsld's namespace uid

### Managed Resource Labels

#### Reconcile

`.spec.resources.metadata.labels[deploy.razee.io/Reconcile]`

- DEFAULT: `true`
  - A Razeedeploy resource (parent) will clean up a resources it applies (child)
when either the child is no longer in the parent resource definition or the
parent is deleted.
- `false`
  - This behavior can be overridden when a child's resource definition has
the label `deploy.razee.io/Reconcile=false`.

#### Resource Update Mode

`.spec.resources.metadata.labels[deploy.razee.io/mode]`

Razeedeploy resources default to merge patching children. This behavior can be
overridden when a child's resource definition has the label
`deploy.razee.io/mode=<mode>`

Mode options:

- DEFAULT: `MergePatch`
  - A simple merge, that will merge objects and replace arrays. Items previously
  defined, then removed from the definition, will be removed from the live resource.
  - "As defined in [RFC7386](https://tools.ietf.org/html/rfc7386), a Merge Patch
  is essentially a partial representation of the resource. The submitted JSON is
  "merged" with the current resource to create a new one, then the new one is
  saved. For more details on how to use Merge Patch, see the RFC." [Reference](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#patch-operations)
- `StrategicMergePatch`
  - A more complicated merge, the kubernetes apiServer has defined keys to be
  able to intelligently merge arrays it knows about.
  - "Strategic Merge Patch is a custom implementation of Merge Patch. For a
  detailed explanation of how it works and why it needed to be introduced, see
  [StrategicMergePatch](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/strategic-merge-patch.md)."
  [Reference](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md#patch-operations)
  - [Kubectl Apply Semantics](https://kubectl.docs.kubernetes.io/pages/app_management/field_merge_semantics.html)
- `EnsureExists`
  - Will ensure the resource is created and is replaced if deleted. Will not
  enforce a definition.
