# FeatureFlagSetLD

[![Build Status](https://travis-ci.com/razee-io/FeatureFlagSetLD.svg?branch=master)](https://travis-ci.com/razee-io/FeatureFlagSetLD)
[![Greenkeeper badge](https://badges.greenkeeper.io/razee-io/FeatureFlagSetLD.svg)](https://greenkeeper.io/)
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
apiVersion: operator.razee.io/v1alpha2
kind: FeatureFlagSetLD
metadata:
  name: <name>
  namespace: <namespace>
spec:
  sdkKey: sdk-key-from-LaunchDarky
  identityRef:
    envFrom:
      - optional: true
        configMapRef:
          name: <ConfigMap Name>
          namespace: <ConfigMap Namespace>
    env:
      - name: type
        value: dev
      - name: UUID
        optional: true
        default: dev1234
        valueFrom:
          configMapKeyRef:
             name: <ConfigMap Name>
             namespace: <ConfigMap Namespace>
             key: <key within that ConfigMap>
  identityKey: UUID
```

### Spec

`.spec`

`spec` is required and **must** include oneOf `sdkKey` or `sdkKeyRef`.

**Schema:**

```yaml
spec:
  type: object
  allOf:
    - # you must define oneOf:
      oneOf:
        - required: [sdkKey]
        - required: [sdkKeyRef]
    - # you must define oneOf:
      oneOf:
        - # neither 'identityRef' nor 'identityKey' is used
          not:
            anyOf:
              - required: [identityRef]
              - required: [identityKey]
        - # 'identityRef' is used by itself
          required: [identityRef]
          not:
            required: [identityKey]
        - # 'identityRef' and 'identityKey' are used together
          required: [identityRef, identityKey]
  properties:
    sdkKey:
      type: string
    sdkKeyRef:
      type: object
      ...
    identityKey:
      type: string
    identityRef:
      type: object
      ...
```

### SdkKey

`.spec.sdkKey`

An SDK key is necessary in order to communicate with LaunchDarkly. Use `sdkKey`
when you want to use a plain text LaunchDarkly SDK key in your FeatureFlagSetLD.
For a more secure implementation, use [sdkKeyRef](#sdkKeyRef).

**Schema:**

```yaml
sdkKey:
  type: string
```

### SdkKeyRef

`.spec.sdkKeyRef`

An SDK key is necessary in order to communicate with LaunchDarkly. Use
`sdkKeyRef` when you want to use a secret reference to your LaunchDarkly SDK
key for your FeatureFlagSetLD.

**Schema:**

```yaml
sdkKeyRef:
  type: object
  required: [valueFrom]
  properties:
    valueFrom:
      type: object
      required: [secretKeyRef]
      properties:
        secretKeyRef:
          type: object
          required: [name, key]
          properties:
            name:
              type: string
            key:
              type: string
            namespace:
              type: string
```

### Identity

`.spec.identity`

Specifying the identity attribute will give the FeatureFlagSetLD cluster specific
data to send to LaunchDarkly for rule evaluation. This allows you to have unique
rules, based on cluster data, return different values.
eg. cluster data `type: dev` could match rules such as
`IF 'type' IS ONE OF 'dev' SERVE 'some new feature'`

**Schema**

```yaml

```

### IdentityKey

**Path:** `.spec.identityKey`

**Description:** If you need to specify a specific key to use as the user key in
LaunchDarkly, this allows you to identify the key to use.

**Schema:**

```yaml
identityKey:
  type: string
```

**Default:** The `uid` of the namespace the resource is deployed in.

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
