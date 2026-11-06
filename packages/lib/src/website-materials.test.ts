import { describe, expect, it, vi } from "vitest";
import { collectWebsiteMaterials, isPublicWebsiteAddress, WebsiteCollectionError, type WebsiteTransport } from "./website-materials";

const entry = "https://example.invalid/";
const html = (content = "本公司提供仓储设备。", links = "") => new Response(
	`<html><head><title>合成官网</title></head><body><article><h1>合成设备</h1><p>${content}</p></article>${links}</body></html>`,
	{ headers: { "content-type": "text/html" } },
);

function transport(fetch: WebsiteTransport["fetch"]): WebsiteTransport {
	return {
		resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
		fetch: vi.fn(fetch),
		wait: vi.fn(async () => {}),
	};
}

describe("bounded official website materials", () => {
	it("stops immediately on first success, preserving real URLs, text and time", async () => {
		const testTransport = transport(async () => new Response("合成官网正文。"));
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(testTransport.fetch).toHaveBeenCalledTimes(1);
		expect(testTransport.wait).not.toHaveBeenCalled();
		expect(result.requestCount).toBe(1);
		expect(result.pages[0]).toMatchObject({ url: entry, finalUrl: entry, status: "success", text: "合成官网正文。" });
		expect(result.pages[0].attempts[0]).toMatchObject({ sequence: 1, method: "jina", statusCode: 200, requestSent: true });
		expect(Date.parse(result.pages[0].fetchedAt)).not.toBeNaN();
	});

	it("shares the three-request budget across reader, direct fetch and recovery", async () => {
		let count = 0;
		const testTransport = transport(async () => ++count < 3 ? new Response("", { status: 503 }) : html());
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.requestCount).toBe(3);
		expect(result.pages[0].attempts.map((attempt) => attempt.method)).toEqual(["jina", "direct", "direct"]);
		expect(result.pages[0].status).toBe("success");
		expect(vi.mocked(testTransport.wait).mock.calls.map(([milliseconds]) => milliseconds)).toEqual([1000, 2000]);
	});

	it("records three failures and never issues a fourth request", async () => {
		const testTransport = transport(async () => new Response("", { status: 500 }));
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.status).toBe("failed");
		expect(result.requestCount).toBe(3);
		expect(testTransport.fetch).toHaveBeenCalledTimes(3);
		expect(result.pages[0].attempts.every((attempt) => attempt.statusCode === 500)).toBe(true);
	});

	it("switches off permanent reader errors and stops repeating a permanent direct error", async () => {
		let count = 0;
		const testTransport = transport(async () => new Response("", { status: ++count === 1 ? 401 : 404 }));
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.requestCount).toBe(2);
		expect(testTransport.fetch).toHaveBeenCalledTimes(2);
	});

	it("caps Retry-After waits at five seconds, still within three requests", async () => {
		const testTransport = transport(async () => new Response("", { status: 429, headers: { "retry-after": "3600" } }));
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.requestCount).toBe(3);
		expect(vi.mocked(testTransport.wait).mock.calls.map(([milliseconds]) => milliseconds)).toEqual([5000, 5000]);
	});

	it("retries network interruptions and empty extractions, retaining each cause", async () => {
		let count = 0;
		const testTransport = transport(async () => {
			if (++count === 1) throw new TypeError("synthetic interrupted network");
			return count === 2 ? new Response("", { headers: { "content-type": "text/html" } }) : html();
		});
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.pages[0].attempts.map((attempt) => attempt.outcome)).toEqual(["networkError", "empty", "success"]);
		expect(result.requestCount).toBe(3);
	});

	it("does not treat reader headers with empty Markdown Content as source text", async () => {
		let count = 0;
		const testTransport = transport(async () => ++count === 1
			? new Response(`Title: Synthetic\nURL Source: ${entry}\nMarkdown Content:\n`) : html());
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.requestCount).toBe(2);
		expect(result.pages[0].attempts[0].outcome).toBe("empty");
	});

	it("counts redirects inside the same shared budget and deduplicates the final page", async () => {
		let count = 0;
		const destination = `${entry}products`;
		const testTransport = transport(async () => {
			count++;
			if (count === 1) return new Response("", { status: 401 });
			if (count === 2) return new Response("", { status: 302, headers: { location: destination } });
			return html("仓储设备。", `<a href="${destination}#model">同一页</a>`);
		});
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.requestCount).toBe(3);
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0].finalUrl).toBe(destination);
		expect(result.pages[0].attempts[1].outcome).toBe("redirect");
	});

	it("rejects out-of-scope and private redirect destinations without fetching them", async () => {
		for (const location of ["https://other.invalid/", "http://127.0.0.1/", "http://169.254.169.254/"]) {
			let count = 0;
			const testTransport = transport(async () => ++count === 1 ? new Response("", { status: 401 })
				: new Response("", { status: 302, headers: { location } }));
			const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
			expect(result.requestCount).toBe(2);
			expect(result.pages[0].attempts[1].outcome).toBe("blocked");
		}
	});

	it("checks all DNS results and blocks mixed public/private addresses before sending HTTP", async () => {
		const testTransport = transport(async () => html());
		testTransport.resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(testTransport.fetch).not.toHaveBeenCalled();
		expect(result.requestCount).toBe(0);
		expect(result.pages[0].attempts[0].outcome).toBe("blocked");
	});

	it("stops cancelled or superseded work before the next attempt", async () => {
		let active = true;
		const testTransport = transport(async () => new Response("", { status: 503 }));
		testTransport.wait = vi.fn(async () => { active = false; });
		await expect(collectWebsiteMaterials({ url: entry, transport: testTransport, isActive: async () => active }))
			.rejects.toBeInstanceOf(WebsiteCollectionError);
		expect(testTransport.fetch).toHaveBeenCalledTimes(1);
		const controller = new AbortController();
		controller.abort();
		await expect(collectWebsiteMaterials({ url: entry, transport: testTransport, signal: controller.signal })).rejects.toThrow("cancelled");
		expect(testTransport.fetch).toHaveBeenCalledTimes(1);
	});

	it("fetches only six unique official pages with at most eighteen requests and no recursion", async () => {
		const counters = new Map<string, number>();
		const links = Array.from({ length: 9 }, (_, index) => `<a href="/page-${index}">实际导航${index}</a>`).join("")
			+ '<a href="https://third-party.invalid/">外部链接</a>';
		const testTransport = transport(async (url) => {
			const target = url.replace("https://r.jina.ai/", "");
			const count = (counters.get(target) ?? 0) + 1;
			counters.set(target, count);
			return count < 3 ? new Response("", { status: 503 }) : html("来源正文。", links);
		});
		const result = await collectWebsiteMaterials({ url: entry, transport: testTransport });
		expect(result.pages).toHaveLength(6);
		expect(result.requestCount).toBe(18);
		expect(testTransport.fetch).toHaveBeenCalledTimes(18);
		expect([...counters.values()]).toEqual([3, 3, 3, 3, 3, 3]);
		expect(new Set(result.pages.map((page) => page.url)).size).toBe(6);
		expect(result.pages.every((page) => new URL(page.url).hostname === "example.invalid")).toBe(true);
	});

	for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.0.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1"]) {
		it(`blocks nonpublic ${address}`, () => expect(isPublicWebsiteAddress(address)).toBe(false));
	}
});
