# pi-ip-country

[![GitHub license](https://img.shields.io/github/license/pingdongyi/pi-ip-country)](https://github.com/pingdongyi/pi-ip-country/blob/main/LICENSE)
[![GitHub tag](https://img.shields.io/github/v/tag/pingdongyi/pi-ip-country)](https://github.com/pingdongyi/pi-ip-country/tags)
[![pi package](https://img.shields.io/badge/pi-package-7C3AED)](https://pi.dev/packages)
[![GitHub stars](https://img.shields.io/github/stars/pingdongyi/pi-ip-country)](https://github.com/pingdongyi/pi-ip-country/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/pingdongyi/pi-ip-country)](https://github.com/pingdongyi/pi-ip-country/forks)
[![GitHub issues](https://img.shields.io/github/issues/pingdongyi/pi-ip-country)](https://github.com/pingdongyi/pi-ip-country/issues)

A [Pi](https://pi.dev) extension that reports the country of an IP address and shows
a country-code status line in the footer.

## Features

- **`ip_country` tool** — callable by the model:
  - `ip_country` → the caller's own public IP + country (via the Cloudflare trace
    endpoint `https://chatgpt.com/cdn-cgi/trace`);
  - `ip_country({ ip: "8.8.8.8" })` → any IP's country (via `https://ipwho.is/<ip>`).
- **`/ip-country [ip]`** slash command — same lookups, shown as a notification.
- **Footer status line** — shows only the `loc` (ISO country code, e.g. `SG`),
  auto-refreshed with a default cache of 300 seconds.

## Install

From a git source (recommended for sharing):

```bash
pi install git:https://github.com/pingdongyi/pi-ip-country.git@v1
```

Or from a local path:

```bash
pi install ./pi-ip-country
```

Or try it once without installing:

```bash
pi -e ./pi-ip-country
```

## Usage

- Run `/ip-country` to see your own IP's country.
- Run `/ip-country 8.8.8.8` to look up a specific IP.
- Ask the model to use the `ip_country` tool.

## Configuration

The status line honors two environment variables (seconds):

| Variable                | Default | Meaning                                     |
| ----------------------- | ------- | ------------------------------------------- |
| `IP_COUNTRY_CACHE_TTL`  | `300`   | How long a loc value is cached before refetch |
| `IP_COUNTRY_REFRESH`    | `300`   | How often the status line refreshes           |

## Notes

- The Cloudflare trace endpoint only reports the caller's own IP/loc, so arbitrary
  IP lookups use `ipwho.is`.
- When an `HTTP(S)_PROXY` environment variable is present, requests go through it
  (Node's built-in `fetch` ignores proxy env vars, so the extension uses undici's
  `ProxyAgent` when available, falling back to the global `fetch`).
