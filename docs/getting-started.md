---
id: getting-started
title: Getting started
sidebar_label: Getting started
---

Ever® Traduora is an Open-Source **Translation Management Platform**. 

Once you setup your project you can import and export your translations to various formats, work together with your team, instantly deliver translation updates over the air, and *soon* automatically translate your project via third-party integrations.

We want Traduora to become the home for managing your translation workflow, that's why we have made all of the core product **open-source** with the intention to grow a **community** and enable developers to build on top of it as a platform.

## Screenshots

Please see [screenshots](screenshots.md) from Traduora UI.

## Try it out

Traduora can be run just about anywhere.  
For a 5 second quickstart simply run our example docker-compose setup:

```sh
git clone https://github.com/ever-co/ever-traduora
cd ever-traduora
docker-compose -f docker-compose.demo.yaml up
```

Now go to your browser on http://localhost:8080 and that's it!

Note: if you want to build docker image locally (instead of downloading prebuilt one), just run `docker-compose up` instead of `docker-compose -f docker-compose.demo.yaml up`.

## Deployment and configuration

Please check out the [configuration](configuration.md) and [deployment](deployment.md) documents for more information on deploying Traduora.
