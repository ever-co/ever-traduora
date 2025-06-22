# Ever Traduora Platform

[![Gitpod Ready-to-Code](https://img.shields.io/badge/Gitpod-Ready--to--Code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/ever-co/ever-traduora)
[![Latest Release](https://img.shields.io/github/release/ever-co/ever-traduora.svg?label=latest%20release)](https://github.com/ever-co/ever-traduora/releases)
[![GitHub License](https://img.shields.io/badge/license-AGPL-v3.svg)](https://raw.githubusercontent.com/ever-co/ever-traduora/master/LICENSE)
[![Docker Pulls](https://img.shields.io/docker/pulls/traduora/traduora)](https://hub.docker.com/r/traduora/traduora)
[![Get help on Codementor](https://cdn.codementor.io/badges/get_help_github.svg)](https://www.codementor.io/evereq?utm_source=github&utm_medium=button&utm_term=evereq&utm_campaign=github)

## 💡 What's New

We released [Ever Gauzy Teams](https://github.com/ever-co/ever-gauzy-teams) platform for Work & Project Management.  
Please check <https://github.com/ever-co/ever-gauzy-teams> and make it ⭐ on GitHub!  
It's built with React / ReactNative stack and connects to headless [Ever Gauzy Platform](https://github.com/ever-co/ever-gauzy) APIs.

## 🌟 What is it

[Ever® Traduora](https://traduora.co) - **Open Translation Management Platform** for teams.

Once you setup your project you can import and export your translations to various formats, work together with your team, instantly deliver translation updates over the air, and _soon_ automatically translate your project via third-party integrations.

![Traduora Product Screenshot](docs-website/static/img/traduora-preview.png)

We want Traduora to become the home for managing your translation workflow, that's why we have made all of the core products **open-source** with the intention of growing a **community** and enabling developers to build on top of it as a platform.

We are going to also use Traduora from our other open-source platforms (currently https://github.com/ever-co/ever-gauzy and https://github.com/ever-co/ever-demand). You are welcome to check more information about the platforms at our official website - https://ever.co.

## ✨ Features

For a quick features review, please see our official docs [screenshots](https://docs.traduora.co/docs/screenshots) page.

A short list of platform features:

- 5-minute setup with Docker, Kubernetes, or from source
- Find what you are looking for with an instant search
- Invite your team, everyone can work together on the same project
- Automate your translation workflow via our REST API
- Import and export to your favorite formats: JSON flat and nested, CSV, YAML flat and nested, Java Properties, XLIFF 1.2, Gettext (po), Strings, Android Resources (xml).
- Community-contributed CLI available at https://github.com/iilei/traduora-cli (not official CLI)

For more information check out our official website [traduora.co](https://traduora.co), or our docs at [docs.traduora.co](https://docs.traduora.co).

Any missing feature you'd like to see? File an [issue](https://github.com/ever-co/feature-requests/issues) with the feature request to let us know.

## 📄 Documentation

Please refer to our official [Platform Documentation](https://docs.traduora.co).

## 📊 Activity

![Alt](https://repobeats.axiom.co/api/embed/8ed434d797f3fafdb41858386930efa788949773.svg 'Repobeats analytics image')

## 🚀 Try it out

Traduora can be run just about anywhere, check out our [Quickstart](https://docs.traduora.co/docs/getting-started) for more info.

Also, check out Traduora's [Docker Hub page](https://hub.docker.com/r/everco/ever-traduora) for pre-built images.

### Configuration

Please check out the [configuration](https://docs.traduora.co/docs/configuration).

### Deployments

Please check [deployment](https://docs.traduora.co/docs/deployment) documents for more information on deploying Traduora.

[![Deploy on Elestio](https://elest.io/images/logos/deploy-to-elestio-btn.png)](https://elest.io/open-source/traduora)

### 👤 Default Admin User

When user signups are disabled (`TR_SIGNUPS_ENABLED=false`), a default admin user is required to access the platform.

Traduora provides a seed function that creates this default admin user. You can use it to log in and perform administrative tasks such as inviting other users.

**🆔 Default Admin Credentials:**

- **Email:** `local.admin@ever.co`
- **Password:** `sTr0ngP@ssw0rd!2025`
- **Name:** `Admin`

You can override these credentials by setting the following environment variables:

- `TR_ADMIN_EMAIL` – Admin user email (default: `local.admin@ever.co`)
- `TR_ADMIN_PASSWORD` – Admin user password (default: `sTr0ngP@ssw0rd!2025`)
- `TR_ADMIN_NAME` – Admin username (default: `Admin`)

> 🔐 After logging in for the first time, you can easily update these admin credentials (email, password, name) directly via the user settings in the web interface.

**⚙️ Seeding Options:**

To manually seed the default admin user:

```bash
# From the monorepo root
yarn seed:default

# Or from the API package directory
yarn seed:default
```

To run all seeds (including the default admin user and other demo data):

```bash
# From the monorepo root
yarn seed

# Or from the API package directory
yarn seed
```

**🚀 Automatic Seeding at Startup:**
If the environment variable `TR_SEED_DATA=true` is set, Traduora will automatically run the seed scripts during application startup. This ensures that the default admin user is available without any manual intervention.

## 🔗 Frequently Asked Questions

Some questions come up over and over again. Be sure to check out our [FAQ](https://docs.traduora.co/docs/faq) first!

## 💌 Contact Us

- [Ever.co Website Contact Us page](https://ever.co/contacts)
- [CodeMentor](https://www.codementor.io/evereq)
- For business inquiries: <mailto:traduora@ever.co>
- Please report security vulnerabilities to <mailto:security@ever.co>

## 🔐 Security

Security is very important to us.
Ever® Traduora Platform follows good security practices, but 100% security cannot be guaranteed in any software!
Ever® Traduora Platform is provided AS IS without any warranty. Use at your own risk!
See more details in the [LICENSE](https://github.com/ever-co/ever-traduora/blob/master/LICENSE).

In a production setup, all client-side to server-side (backend, APIs) communications should be encrypted using HTTPS/SSL (REST APIs).

If you discover any issue regarding security, please disclose the information responsibly by sending an email to <mailto:security@ever.co> and not by creating a GitHub issue.

## Internationalization

Of course, we'd like Traduora to be available in as many languages as possible, so feel free to contribute!

## Changelog

You can check our [changelog](https://docs.traduora.co/docs/changelog) for information about releases.

## 🛡️ License

See [LICENSE](https://github.com/ever-co/ever-traduora/blob/master/LICENSE).

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fever-co%2Fever-traduora.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fever-co%2Fever-traduora?ref=badge_large)

Traduora was created by https://github.com/anthonynsimon (https://anthonynsimon.com) and [contributors](https://github.com/ever-co/ever-traduora/graphs/contributors). In April 2021 it was moved to [Ever](https://ever.co) company for future development.

## ™️ Trademarks

**Ever**® is a registered trademark of [Ever Co. LTD](https://ever.co).  
**Ever® Traduora™**, **Ever® Demand™**, **Ever® Gauzy™**, **Ever® Teams™** and **Ever® OpenSaaS™** are all trademarks of [Ever Co. LTD](https://ever.co).
The trademarks may only be used with the written permission of Ever Co. LTD. and may not be used to promote or otherwise market competitive products or services.

All other brand and product names are trademarks, registered trademarks, or service marks of their respective holders.

## 🍺 Contribute

We think it's great that you'd like to contribute to Traduora.

- Please give us :star: on Github, it **helps**!
- You are more than welcome to submit feature requests in the [separate repo](https://github.com/ever-co/feature-requests/issues).
- Pull requests are always welcome! Please base pull requests against the _develop_ branch and follow the [contribution guidelines](https://docs.traduora.co/docs/contributing).

## 💪 Thanks to our Contributors

See our contributors list in [CONTRIBUTORS.md](https://github.com/ever-co/ever-traduora/blob/develop/.github/CONTRIBUTORS.md).  
You can also view a full list of our [contributors tracked by Github](https://github.com/ever-co/ever-traduora/graphs/contributors).

<img src="https://contributors-img.web.app/image?repo=ever-co/ever-traduora" />

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ever-co/ever-traduora&type=Date)](https://star-history.com/#ever-co/ever-traduora&Date)

## ❤️ Powered By

<p>
  <a href="https://www.digitalocean.com/?utm_medium=opensource&utm_source=ever-co">
    <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/PoweredByDO/DO_Powered_by_Badge_blue.svg" width="201px">
  </a>
</p>

---

![visitors](https://visitor-badge.laobi.icu/badge?page_id=ever-co.traduora-platform)
[![Circle CI](https://circleci.com/gh/ever-co/ever-traduora.svg?style=svg)](https://circleci.com/gh/ever-co/ever-traduora)
[![codecov](https://codecov.io/gh/ever-co/ever-traduora/branch/master/graph/badge.svg)](https://codecov.io/gh/ever-co/ever-traduora)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/0d5e1c68dc1e44c79249241b4abb15b8)](https://www.codacy.com/gh/ever-co/ever-traduora/dashboard?utm_source=github.com&utm_medium=referral&utm_content=ever-co/ever-traduora&utm_campaign=Badge_Grade)
[![DeepScan grade](https://deepscan.io/api/teams/3293/projects/16761/branches/365112/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=3293&pid=16761&bid=365112)
[![Known Vulnerabilities](https://snyk.io/test/github/ever-co/ever-traduora/badge.svg)](https://snyk.io/test/github/ever-co/ever-traduora)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fever-co%2Fever-traduora.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fever-co%2Fever-traduora?ref=badge_shield)
