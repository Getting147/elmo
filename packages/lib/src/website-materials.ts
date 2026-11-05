import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { cleanUrl } from "./onboarding/utils";
import { BROWSER_UA, DIRECT_TIMEOUT_MS, extractWebsiteHtml, JINA_TIMEOUT_MS } from "./website-excerpt";

export const MAX_RESEARCH_PAGES = 6;
export const MAX_PAGE_REQUESTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface WebsiteAttempt {
	sequence: number;
	method: "jina" | "direct";
	url: string;
	statusCode?: number;
	startedAt: string;
	outcome: "success" | "httpError" | "empty" | "networkError" | "timeout" | "redirect" | "blocked";
	detail?: string;
	requestSent?: boolean;
}

export interface WebsitePage {
	url: string;
	finalUrl: string;
	status: "success" | "failed";
	fetchedAt: string;
	text: string;
	links: { url: string; label: string }[];
	attempts: WebsiteAttempt[];
}

export interface WebsiteMaterials {
	status: "complete" | "partial" | "failed";
	pages: WebsitePage[];
	requestCount: number;
	maxPages: number;
	maxRequestsPerPage: number;
	dns?: { method: "system" | "encrypted"; applicationQueries: number; server?: string };
}

type Address = { address: string; family: number };
export interface WebsiteTransport {
	resolve: (hostname: string) => Promise<Address[]>;
	fetch: (url: string, signal: AbortSignal, address: Address) => Promise<Response>;
	wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
	dns?: WebsiteMaterials["dns"];
}

const blocked = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
	["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
	["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
	["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
	["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
] as const) blocked.addSubnet(address, prefix, "ipv6");

export function isPublicWebsiteAddress(address: string): boolean {
	const family = isIP(address);
	return family !== 0 && !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

function requestPublicPage(url: string, signal: AbortSignal, address: Address, headers?: Record<string, string>): Promise<Response> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const request = parsed.protocol === "https:" ? httpsRequest : httpRequest;
		// Pin the checked DNS address; a second resolution must not enable rebinding.
		const req = request(parsed, {
			signal,
			lookup: (_hostname, options, callback) => {
				if (options.all) callback(null, [address]);
				else callback(null, address.address, address.family);
			},
			headers: { "User-Agent": BROWSER_UA, Accept: "text/html,text/plain;q=0.9", ...headers },
		}, (res) => {
			const chunks: Buffer[] = [];
			let size = 0;
			res.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) req.destroy(new Error("Website response exceeds extraction limit"));
				else chunks.push(chunk);
			});
			res.on("error", reject);
			res.on("end", () => {
				const headers = new Headers();
				for (const [name, value] of Object.entries(res.headers)) {
					if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
				}
				const status = res.statusCode ?? 502;
				resolve(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status, headers }));
			});
		});
		req.on("error", reject);
		req.end();
	});
}

function publicTransport(): WebsiteTransport {
	const mode = process.env.WEBSITE_RESEARCH_DNS_OVER_HTTPS;
	if (mode && mode !== "1.1.1.1") throw new Error("Unsupported encrypted website DNS resolver");
	const dns: NonNullable<WebsiteMaterials["dns"]> = {
		method: mode ? "encrypted" : "system", applicationQueries: 0, ...(mode ? { server: "1.1.1.1" } : {}),
	};
	const cache = new Map<string, Promise<Address[]>>();
	const resolve = async (hostname: string): Promise<Address[]> => {
		if (mode && dns.applicationQueries >= 14) throw new Error("Encrypted DNS query budget exceeded");
		dns.applicationQueries++;
		if (!mode) return lookup(hostname, { all: true });
		const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
		const response = await requestPublicPage(url, AbortSignal.timeout(3000), { address: "1.1.1.1", family: 4 }, { Accept: "application/dns-json" });
		if (!response.ok) throw new Error(`Encrypted DNS HTTP ${response.status}`);
		const data: unknown = await response.json();
		if (!data || typeof data !== "object" || !("Status" in data) || data.Status !== 0 || !("Answer" in data) || !Array.isArray(data.Answer)) {
			throw new Error("Encrypted DNS returned no usable A records");
		}
		const addresses: Address[] = [];
		for (const answer of data.Answer) {
			if (answer && typeof answer === "object" && "type" in answer && answer.type === 1 && "data" in answer && typeof answer.data === "string") {
				addresses.push({ address: answer.data, family: 4 });
			}
		}
		if (addresses.length === 0) throw new Error("Encrypted DNS returned no usable A records");
		return addresses;
	};
	return {
		resolve: (hostname) => {
			let result = cache.get(hostname);
			if (!result) { result = resolve(hostname); cache.set(hostname, result); }
			return result;
		},
		fetch: requestPublicPage,
		wait: async (milliseconds, signal) => { await delay(milliseconds, undefined, { signal }); },
		dns,
	};
}

function canonicalPage(input: string): string {
	const normalized = cleanUrl(input);
	if (!normalized) throw new Error("Website must be a public HTTP(S) URL");
	const url = new URL(normalized);
	url.hash = "";
	url.searchParams.sort();
	if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Unsupported website port");
	return url.href;
}

function inScope(url: string, hosts: Set<string>): boolean {
	const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	return [...hosts].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function publicAddress(url: string, transport: WebsiteTransport, signal?: AbortSignal): Promise<Address> {
	signal?.throwIfAborted();
	const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
	const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await abortable(transport.resolve(hostname), signal);
	if (addresses.length === 0 || addresses.some(({ address }) => !isPublicWebsiteAddress(address))) {
		throw new Error("Website address is not public");
	}
	return addresses[0];
}

async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return operation;
	signal.throwIfAborted();
	let onAbort: () => void = () => {};
	try {
		return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
			onAbort = () => reject(signal.reason);
			signal.addEventListener("abort", onAbort, { once: true });
		})]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

export class WebsiteCollectionError extends Error {
	constructor(message: string, public readonly materials: WebsiteMaterials) {
		super(message);
		this.name = "WebsiteCollectionError";
	}
}

export async function collectWebsiteMaterials(options: {
	url: string;
	additionalDomains?: string[];
	signal?: AbortSignal;
	isActive?: () => Promise<boolean>;
	transport?: WebsiteTransport;
}): Promise<WebsiteMaterials> {
	const transport = options.transport ?? publicTransport();
	const materials: WebsiteMaterials = {
		status: "failed", pages: [], requestCount: 0,
		maxPages: MAX_RESEARCH_PAGES, maxRequestsPerPage: MAX_PAGE_REQUESTS,
		dns: transport.dns,
	};
	const active = async () => {
		if (options.signal?.aborted || (options.isActive && !await options.isActive())) {
			throw new WebsiteCollectionError("Research cancelled or superseded; no further requests", materials);
		}
	};
	await active();
	const entryUrl = canonicalPage(options.url);
	const hosts = new Set([new URL(entryUrl).hostname.toLowerCase().replace(/^www\./, "")]);
	for (const domain of options.additionalDomains ?? []) {
		hosts.add(new URL(canonicalPage(domain)).hostname.toLowerCase().replace(/^www\./, ""));
	}
	const pending = [entryUrl];
	const visited = new Set<string>();
	for (let pageIndex = 0; pageIndex < pending.length && materials.pages.length < MAX_RESEARCH_PAGES; pageIndex++) {
		await active();
		const originalUrl = pending[pageIndex];
		if (visited.has(originalUrl)) continue;
		visited.add(originalUrl);
		const page: WebsitePage = {
			url: originalUrl, finalUrl: originalUrl, status: "failed",
			fetchedAt: new Date().toISOString(), text: "", links: [], attempts: [],
		};
		materials.pages.push(page);
		const deadline = Date.now() + JINA_TIMEOUT_MS + DIRECT_TIMEOUT_MS;
		const pageTimeout = AbortSignal.timeout(JINA_TIMEOUT_MS + DIRECT_TIMEOUT_MS);
		const pageSignal = options.signal ? AbortSignal.any([options.signal, pageTimeout]) : pageTimeout;
		let targetUrl = originalUrl;
		let method: WebsiteAttempt["method"] = "jina";
		for (let sequence = 1; sequence <= MAX_PAGE_REQUESTS; sequence++) {
			await active();
			if (Date.now() >= deadline) break;
			let response: Response | undefined;
			const attempt: WebsiteAttempt = {
				sequence, method, url: targetUrl, startedAt: new Date().toISOString(), outcome: "networkError",
			};
			try {
				if (!inScope(targetUrl, hosts)) throw new Error("Redirect outside official website scope");
				const address = await publicAddress(targetUrl, transport, pageSignal);
				const fetchUrl = method === "jina" ? `https://r.jina.ai/${targetUrl}` : targetUrl;
				const fetchAddress = method === "jina" ? await publicAddress(fetchUrl, transport, pageSignal) : address;
				await active();
				pageSignal.throwIfAborted();
				if (Date.now() >= deadline) throw new DOMException("Website page time budget expired", "TimeoutError");
				const timeout = AbortSignal.timeout(Math.max(1, Math.min(
					method === "jina" ? JINA_TIMEOUT_MS : DIRECT_TIMEOUT_MS, deadline - Date.now(),
				)));
				const signal = AbortSignal.any([pageSignal, timeout]);
				page.attempts.push(attempt);
				attempt.requestSent = true;
				materials.requestCount++;
				response = await transport.fetch(fetchUrl, signal, fetchAddress);
				attempt.statusCode = response.status;
				if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
					const destination = canonicalPage(new URL(response.headers.get("location")!, fetchUrl).href);
					if (method === "jina" || !inScope(destination, hosts)) throw new Error("Redirect outside official website scope");
					await publicAddress(destination, transport, pageSignal);
					attempt.outcome = "redirect";
					attempt.detail = destination;
					targetUrl = destination;
					if (visited.has(destination) && destination !== originalUrl) break;
					visited.add(destination);
					continue;
				}
				if (!response.ok) {
					attempt.outcome = "httpError";
					attempt.detail = `HTTP ${response.status}`;
				} else {
					const body = await response.text();
					const extracted = method === "direct"
						? { ...extractWebsiteHtml((response.headers.get("content-type") ?? "").includes("html") ? body : "", targetUrl), finalUrl: targetUrl }
						: extractReader(body, targetUrl);
					if (extracted.finalUrl) {
						const finalUrl = canonicalPage(extracted.finalUrl);
						if (!inScope(finalUrl, hosts)) throw new Error("Reader final URL outside official website scope");
						await publicAddress(finalUrl, transport, pageSignal);
						targetUrl = finalUrl;
						visited.add(finalUrl);
					}
					if (extracted.text.trim()) {
						attempt.outcome = "success";
						page.status = "success";
						page.finalUrl = targetUrl;
						page.text = extracted.text.slice(0, 6000);
						page.links = extracted.links;
						page.fetchedAt = new Date().toISOString();
						break;
					}
					attempt.outcome = "empty";
					attempt.detail = "No extractable website text";
				}
			} catch (error) {
				if (error instanceof WebsiteCollectionError || options.signal?.aborted) {
					throw new WebsiteCollectionError("Research cancelled; no further requests", materials);
				}
				const message = error instanceof Error ? error.message : String(error);
				attempt.outcome = error instanceof Error && /abort|timeout/i.test(error.name) ? "timeout" : "networkError";
				attempt.detail = message;
				if (!page.attempts.includes(attempt)) page.attempts.push(attempt);
				if (/not public|outside official|Unsupported website/.test(message)) {
					attempt.outcome = "blocked";
					if (!page.attempts.includes(attempt)) page.attempts.push(attempt);
					break;
				}
			}
			const permanent = response && response.status >= 400 && response.status < 500 && response.status !== 429;
			if (permanent && method === "direct") break;
			if (sequence === MAX_PAGE_REQUESTS) break;
			method = "direct";
			const retryAfter = response?.status === 429 ? response.headers.get("retry-after") : null;
			const retryMs = retryAfter === null ? sequence * 1000 : retryAfterMilliseconds(retryAfter);
			await active();
			try {
				await transport.wait(Math.min(retryMs, Math.max(0, deadline - Date.now())), pageSignal);
			} catch (error) {
				if (options.signal?.aborted) throw new WebsiteCollectionError("Research cancelled during retry wait", materials);
				if (pageTimeout.aborted) break;
				throw error;
			}
			await active();
		}
		if (pageIndex === 0 && page.status === "success") {
			for (const link of page.links) {
				try {
					const url = canonicalPage(link.url);
					if (inScope(url, hosts) && !visited.has(url) && !pending.includes(url)
						&& !/\.(?:pdf|png|jpe?g|gif|svg|zip|mp4|css|js)(?:$|\?)/i.test(new URL(url).pathname)) {
						pending.push(url);
					}
				} catch {
					// Unsupported navigation targets are not research pages.
				}
				if (pending.length >= MAX_RESEARCH_PAGES) break;
			}
		}
	}
	const successful = materials.pages.filter((page) => page.status === "success").length;
	materials.status = successful === 0 ? "failed" : successful === materials.pages.length ? "complete" : "partial";
	return materials;
}

function extractReader(body: string, url: string): { text: string; links: { url: string; label: string }[]; finalUrl?: string } {
	const links: { url: string; label: string }[] = [];
	for (const match of body.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
		links.push({ label: match[1], url: match[2] });
	}
	const finalUrl = /^URL Source:\s*(https?:\/\/\S+)/m.exec(body)?.[1];
	const content = body.includes("Markdown Content:") ? body.slice(body.indexOf("Markdown Content:") + "Markdown Content:".length) : body;
	return { text: content.split("\n").slice(0, 200).join("\n").trim(), links, finalUrl: finalUrl ?? url };
}

function retryAfterMilliseconds(value: string): number {
	const seconds = Number(value);
	const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
	return Math.min(5000, Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 1000));
}
