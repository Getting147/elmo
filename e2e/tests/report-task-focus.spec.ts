import { expect, test, type Page } from "@playwright/test";

const fixtureURL = process.env.BASELINE_FOCUS_FIXTURE_URL;
const runId = "run_copilot_b12_a";
const otherRunId = "run_copilot_b12_b";
const brandId = "ALPHA";

test.skip(!fixtureURL, "Requires the isolated B12 Mock backend and seeded ALPHA account.");

async function visibleTarget(page: Page, section: number) {
	const panel = page.locator(`section[aria-label^="板块${section}："]`);
	await expect.poll(() => panel.evaluate((element) => {
		const title = element.firstElementChild;
		const heading = title?.firstElementChild;
		if (!title || !heading) return false;
		const rect = heading.getBoundingClientRect();
		const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
		const x = Math.max(0, rect.left + Math.min(rect.width / 2, 100));
		return rect.top >= headerBottom && rect.bottom < window.innerHeight
			&& [rect.top + 2, rect.top + rect.height / 2, rect.bottom - 2].every((y) => {
				const hit = document.elementFromPoint(x, y);
				return hit !== null && heading.contains(hit);
			});
	}), { timeout: 15_000 }).toBe(true);
	await expect(page.getByRole("status").filter({ hasText: `已定位本任务当前处理位置：板块${section}` })).toBeVisible();
}

test("read-only task focus exposes stage titles without losing run identity or edits", async ({ page, request }, testInfo) => {
	test.setTimeout(180_000);
	const backend = fixtureURL!;
	const snapshot: unknown = JSON.parse(process.env.BASELINE_FOCUS_SNAPSHOT || "null");
	if (!snapshot || typeof snapshot !== "object"
		|| !("snapshot_id" in snapshot) || typeof snapshot.snapshot_id !== "string"
		|| !("content_sha256" in snapshot) || typeof snapshot.content_sha256 !== "string"
		|| !("question_count" in snapshot) || typeof snapshot.question_count !== "number") {
		throw new Error("Provide BASELINE_FOCUS_SNAPSHOT from the isolated fixture's saved snapshot.");
	}
	const control = async (data: Record<string, unknown>) => {
		const response = await request.post(`${backend}/__b12/control`, { data });
		expect(response.ok()).toBe(true);
	};
	const counts = async () => {
		const response = await request.get(`${backend}/__b12/counts`);
		expect(response.ok()).toBe(true);
		return response.json();
	};
	const before = await counts();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(() => {
		const original = Element.prototype.scrollIntoView;
		let count = 0;
		Element.prototype.scrollIntoView = function (...args) {
			document.documentElement.dataset.taskFocusCount = String(++count);
			return original.apply(this, args);
		};
	});
	const login = await page.request.post("/api/auth/sign-in/email", {
		data: { email: "admin@alpha.internal", password: "Admin123456!" },
		headers: { Origin: new URL(testInfo.project.use.baseURL!).origin },
	});
	expect(login.ok()).toBe(true);
	await page.goto(`/app/${brandId}/reports?runId=${runId}`);
	const select = page.getByLabel("切换已有监测任务");
	await expect(select).toHaveValue(runId);
	await page.evaluate(async ({ brandId, runId, snapshot }) => {
		// @ts-expect-error Vite serves this application module in the browser.
		const api = await import("/src/server/baseline.ts");
		const profile = await api.getBrandBaselineProfileFn({ data: { brandId } });
		localStorage.setItem(`diagnosis-draft:usr_alpha_admin:${brandId}`, JSON.stringify({
			profileSignature: JSON.stringify(profile), dimensions: {}, mode: "synthetic",
			snapshot, runId, submitted: true,
		}));
	}, { brandId, runId, snapshot });

	const facts = [];
	for (const [step, section] of [["collecting", 3], ["analyzing", 4], ["ready_for_review", 5]] as const) {
		await control({ run_id: runId, step, status: "partial" });
		await page.reload();
		await expect(select).toHaveValue(runId);
		await visibleTarget(page, section);
		for (const attempt of [1, 2]) {
			await page.getByRole("button", {
				name: step === "ready_for_review" ? "查看本次任务（待审核）" : "查看本次任务进度（只读）",
				exact: true,
			}).click();
			await visibleTarget(page, section);
			await expect(select).toHaveValue(runId);
			await expect(page).toHaveURL(new RegExp(`runId=${runId}`));
			facts.push(await page.locator(`section[aria-label^="板块${section}："]`).evaluate((element) => {
				const rect = element.firstElementChild!.firstElementChild!.getBoundingClientRect();
				const hit = document.elementFromPoint(rect.left + 50, rect.top + rect.height / 2);
				return { top: rect.top, bottom: rect.bottom, hit: hit?.textContent, headerBottom: document.querySelector("header")?.getBoundingClientRect().bottom };
			}));
			await page.screenshot({ path: testInfo.outputPath(`${step}-${attempt}.png`) });
		}
		const beforeScroll = await page.evaluate(() => window.scrollY);
		await page.evaluate(() => window.scrollBy(0, -200));
		await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(beforeScroll);
		const scrollCount = await page.locator("html").getAttribute("data-task-focus-count");
		const scrollY = await page.evaluate(() => window.scrollY);
		await page.waitForTimeout(4500);
		expect(await page.locator("html").getAttribute("data-task-focus-count")).toBe(scrollCount);
		expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scrollY, 0);
	}

	await select.selectOption(otherRunId);
	await visibleTarget(page, 5);
	await page.evaluate(({ brandId, otherRunId }) => {
		const key = `diagnosis-draft:usr_alpha_admin:${brandId}`;
		const draft = JSON.parse(localStorage.getItem(key)!);
		localStorage.setItem(key, JSON.stringify({ ...draft, runId: otherRunId }));
	}, { brandId, otherRunId });
	await page.reload();
	await visibleTarget(page, 5);
	const conclusion = page.getByPlaceholder("输入本轮诊断总体结论...");
	await expect(conclusion).toBeEnabled();
	await conclusion.fill("Same-run read-only focus must preserve these unsaved edits.");
	await page.getByRole("button", { name: "查看本次任务（待审核）", exact: true }).click();
	await visibleTarget(page, 5);
	await expect(select).toHaveValue(otherRunId);
	await expect(conclusion).toHaveValue("Same-run read-only focus must preserve these unsaved edits.");

	const after = await counts();
	expect(after.llm_mock).toBe(before.llm_mock);
	expect(after.ark_mock).toBe(before.ark_mock);
	expect(after.real_calls).toBe(0);
	expect(after.tables).toEqual(before.tables);
	const posts = (value: typeof before) => Object.fromEntries(
		Object.entries(value.requests).filter(([key]) => key.startsWith("POST ")),
	);
	expect(posts(after)).toEqual(posts(before));
	await testInfo.attach("focus-facts", {
		body: JSON.stringify({ facts, before, after, pageErrors: errors }, null, 2),
		contentType: "application/json",
	});
});
