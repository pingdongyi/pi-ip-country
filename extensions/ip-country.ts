/**
 * IP Country Extension
 *
 * Shows the country of an IP address using the Cloudflare trace endpoint
 * (https://chatgpt.com/cdn-cgi/trace) for the caller's own public IP, and a
 * geo-IP service (https://ipwho.is/<ip>) for arbitrary IPs.
 *
 * Provides:
 *   - `ip_country` tool (callable by the model)
 *   - `/ip-country [ip]` slash command
 *   - a persistent footer status line with the host's IP and country
 *
 * Note: the Cloudflare trace endpoint only reports the caller's own IP/loc.
 * Lookups of arbitrary IPs therefore use ipwho.is.
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const TRACE_URL = "https://chatgpt.com/cdn-cgi/trace";
const GEO_URL = (ip: string) => `https://ipwho.is/${encodeURIComponent(ip)}`;

// Status-bar loc caching: re-fetch at most once per cache window (default 300s).
const CACHE_TTL_MS = (Number(process.env.IP_COUNTRY_CACHE_TTL) || 300) * 1000;
// How often the status line auto-refreshes (default: once per cache window).
const REFRESH_MS = (Number(process.env.IP_COUNTRY_REFRESH) || 300) * 1000;
let locCache: { value: string; at: number } = { value: "", at: 0 };
let refreshTimer: ReturnType<typeof setInterval> | undefined;

interface GeoInfo {
	ip: string;
	countryCode: string;
	country: string;
	city?: string;
	org?: string;
	colo?: string;
}

/** Parse the key=value lines of a Cloudflare trace response. */
function parseTrace(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const i = line.indexOf("=");
		if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	return out;
}

/**
 * HTTP GET that honours an HTTP(S)_PROXY env var when one is configured.
 * Node's global fetch ignores proxy env vars, and some networks (e.g. this
 * one) only reach certain hosts through the local proxy, so we use undici's
 * ProxyAgent when a proxy is present, falling back to the global fetch.
 */
async function httpGet(url: string): Promise<string> {
	const signal = AbortSignal.timeout(8000);
	const proxy =
		process.env.https_proxy || process.env.http_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
	if (proxy) {
		try {
			const undici = (await import("undici")) as any;
			const res = await undici.fetch(url, { signal, dispatcher: new undici.ProxyAgent(proxy) });
			return await res.text();
		} catch {
			// Proxy path unavailable; fall through to the default fetch.
		}
	}
	const res = await fetch(url, { signal });
	return await res.text();
}

/** Look up geo info for an arbitrary IP via ipwho.is. */
async function geo(ip: string): Promise<Partial<GeoInfo>> {
	try {
		const text = await httpGet(GEO_URL(ip));
		const d = JSON.parse(text);
		if (!d || d.success === false) return {};
		return {
			countryCode: d.country_code,
			country: d.country,
			city: d.city,
			org: d.connection?.org,
		};
	} catch {
		return {};
	}
}

/**
 * Get the caller's own public IP and country.
 * Primary source is the Cloudflare trace endpoint; if it is unreachable
 * (network/proxy restrictions), fall back to ipwho.is, which also reports the
 * caller's own IP when called without an address.
 */
async function ownInfo(): Promise<GeoInfo> {
	try {
		const t = parseTrace(await httpGet(TRACE_URL));
		const extra = await geo(t.ip);
		return {
			ip: t.ip,
			countryCode: t.loc,
			country: extra.country ?? t.loc,
			city: extra.city,
			org: extra.org,
			colo: t.colo,
		};
	} catch {
		const d = await geoSelf(); // ipwho.is/ reports the caller's own IP
		return {
			ip: d.ip ?? "?",
			countryCode: d.countryCode ?? "?",
			country: d.country ?? d.countryCode ?? "?",
			city: d.city,
			org: d.org,
		};
	}
}

/** Look up the caller's own IP/geo via ipwho.is (used when trace is unreachable). */
async function geoSelf(): Promise<GeoInfo & { ip?: string }> {
	try {
		const text = await httpGet("https://ipwho.is/");
		const d = JSON.parse(text);
		if (!d || d.success === false) return {};
		return {
			ip: d.ip,
			countryCode: d.country_code,
			country: d.country,
			city: d.city,
			org: d.connection?.org,
		};
	} catch {
		return {};
	}
}

/** Return the cached loc, fetching a fresh value only when the cache has expired. */
async function getCachedLoc(): Promise<string> {
	const now = Date.now();
	if (locCache.value && now - locCache.at < CACHE_TTL_MS) return locCache.value;
	const info = await ownInfo();
	locCache = { value: info.countryCode, at: Date.now() };
	return locCache.value;
}

/** ISO 3166-1 alpha-2 code -> flag emoji. */
function countryFlag(code: string): string {
	if (!/^[A-Za-z]{2}$/.test(code)) return "🌐";
	const A = 0x1f1e6;
	return String.fromCodePoint(
		A + code[0].toUpperCase().charCodeAt(0) - 65,
		A + code[1].toUpperCase().charCodeAt(0) - 65,
	);
}

const ipCountryTool = defineTool({
	name: "ip_country",
	label: "IP Country",
	description:
		"Look up the country of an IP address. Without an IP argument, returns the caller's own public IP and its country (via Cloudflare trace).",
	parameters: Type.Object({
		ip: Type.Optional(Type.String({ description: "IP to look up; omit for the caller's own IP" })),
	}),
	outputSchema: Type.Object({
		ip: Type.String(),
		countryCode: Type.String(),
		country: Type.String(),
		city: Type.Optional(Type.String()),
		org: Type.Optional(Type.String()),
		source: Type.String(),
	}),

	async execute(_toolCallId, params) {
		let info: GeoInfo;
		let source: string;

		if (params.ip) {
			const g = await geo(params.ip);
			info = {
				ip: params.ip,
				countryCode: g.countryCode ?? "?",
				country: g.country ?? g.countryCode ?? "?",
				city: g.city,
				org: g.org,
			};
			source = "ipwho.is";
		} else {
			info = await ownInfo();
			source = "cloudflare-trace";
		}

		const lines = [
			`IP: ${info.ip}`,
			`Country: ${countryFlag(info.countryCode)} ${info.country} (${info.countryCode})`,
			info.city ? `City: ${info.city}` : "",
			info.org ? `ISP: ${info.org}` : "",
			info.colo ? `Cloudflare colo: ${info.colo}` : "",
			`Source: ${source}`,
		].filter(Boolean);

		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: info,
			structuredContent: { ...info, source },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(ipCountryTool);

	pi.registerCommand("ip-country", {
		description: "Show the country of an IP (default: your own public IP)",
		handler: async (args, ctx) => {
			const ip = args.trim() || undefined;
			let info: GeoInfo;
			if (ip) {
				const g = await geo(ip);
				info = { ip, countryCode: g.countryCode ?? "?", country: g.country ?? g.countryCode ?? "?", city: g.city, org: g.org };
			} else {
				info = await ownInfo();
			}
			ctx.ui.notify(`IP ${info.ip} → ${countryFlag(info.countryCode)} ${info.country} (${info.countryCode})`, "info");
		},
	});

	// Persistent footer status line showing only the loc (country code), auto-refreshed
	// within the cache window (default 300s, override with IP_COUNTRY_CACHE_TTL /
	// IP_COUNTRY_REFRESH, in seconds).
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const theme = ctx.ui.theme;
		const show = (loc: string) => ctx.ui.setStatus("ip-country", theme.fg("accent", loc));
		try {
			show(await getCachedLoc());
		} catch {
			// Network unavailable: keep the footer silent until the next refresh.
		}
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = setInterval(async () => {
			try {
				show(await getCachedLoc());
			} catch {
				// Keep the last value on transient errors.
			}
		}, REFRESH_MS);
	});

	// Stop the auto-refresh timer on session teardown.
	pi.on("session_shutdown", async () => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = undefined;
		}
	});
}
