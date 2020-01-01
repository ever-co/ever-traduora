---
id: deployment
title: Deployment
sidebar_label: Deployment
---

## Requirements

Traduora requires MySQL 5.7+ and it is **strongly recommended** that you deploy it behind a reverse-proxy/load balancer that does TLS termination. Otherwise you risk exposing the JWT authentication tokens that it uses to authorize user and API access.

By default, the server will try to connect to MySQL on localhost port `3306`, with a database called `tr_dev` and with credentials username `root` and empty password. To override this checkout the [configuration](configuration.md) section.

In particular you might want to override the folllowing environment variables:

```sh
NODE_ENV  # set it to production
TR_SECRET  # generate a strong secret (used for signing JWT auth tokens)
TR_VIRTUAL_HOST  # i.e. traduora.example.com
TR_DB_HOST  # depends on your MySQL config
TR_DB_PORT
TR_DB_DATABASE
TR_DB_USER
TR_DB_PASSWORD
```


## Docker compose

The quickest way to try traduora is by using our example docker-compose setup:

```sh
git clone https://github.com/traduora/traduora
cd traduora
docker-compose up
```


## Docker

You can simply run our pre-built image:

```sh
docker run -d -p 8080:8080 --name traduora traduora/traduora:latest
```

You can override the environment variables like this:

```sh
docker run -d -p 8080:8080 -e TR_SECRET=mysupersecret -e TR_VIRTUAL_HOST=example.com traduora/traduora:latest
```

This will run traduora **without any persistent storage**. You will likely want to point it to the location of your MySQL database, to see the available environment variables checkout the [configuration](configuration.md) section.


## Kubernetes

We'll soon include a Helm chart for traduora, but you can easily deploy it with plain kubernetes manifests.

A simple example manifest which deploys traduora and the required MySQL 5.7+ database together as a pod is localed in the repo at `deploy/k8s/traduora-preview.yaml`, you can check it out as reference.

To override any of the configuration params, you can update the `configmap` or the `secret` resource as needed.

Once you are happy with your setup you can then just `kubectl apply -f $MANIFEST_FILE_PATH`, like so:

```sh
kubectl apply -f deploy/k8s/traduora-preview.yaml
```

You can then connect to the pod locally by creating a tunnel on port `8080` (replace `$POD_NAME` with the deployed pod name):

```sh
kubectl port-forward -p 8080:8080 $POD_NAME
```

Or by deploying an ingress for it, for example:

```sh
# With GCP LB
kubectl apply -f deploy/k8s/traduora-preview-ingress-gcp.yaml

# With nginx
kubectl apply -f deploy/k8s/traduora-preview-ingress-nginx.yaml
```

It is **strongly recommended** that you only serve traduora over TLS, you should configure according to your cloud environment


## From source
To build from source the pre-requisites are: `Node.js v10+` and `yarn` (or npm).

Clone the repo locally:

```sh
git clone https://github.com/traduora/traduora
```

Now just set the repo as the current directory and build:

```sh
cd traduora && bin/build.sh
```

After the build completes, you should have the build outputs in the `dist` directory. You can copy those to your server and start it by running the following script:

```sh
bin/start.sh
```

The server will be (by default) listening on `0.0.0.0:8080`. You might want to start the server with a service/process manager like `systemd`, `upstart`, `supervisord` or `pm2` on production environments.


## Configuration
You can of course configure traduora according to your needs, to see the available environment variables checkout the [configuration](configuration.md) section.

