import { analyzePosition } from './analyze-position.js';
import * as Sentry from "@sentry/node";
import type { Job } from "pg-boss";
import { db } from "@workspace/lib/db/db";
import {
	brands,
	citations,
	competitors,
	promptRuns,
	prompts,
	type Brand,
	type Competitor,
} from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { RUNS_PER_PROMPT, getDefaultDelayHours } from "@workspace/lib/constants";
import { failureBackoffHours } from "@workspace/lib/run-backoff";
import { buildInjectedValue } from "@workspace/lib/markets";
import {
	getProvider,
	parseScrapeTargets,
	selectTargetsForBrand,
	type ModelConfig,
	type Provider,
} from "@workspace/lib/providers";
import type { Citation } from "@workspace/lib/text-extraction";
import boss from "../boss";
import { trackWorkerEvent } from "../telemetry";

export interface ProcessPromptData {
	promptId: string;
	cadenceHours?: number; // Hours until next run (for self-rescheduling)
	/** Cycles in a row where every run failed, carried forward to size the backoff. */
	consecutiveFailures?: number;
	manualTriggered?: boolean;
}

/**
 * Queue options for a process-prompt job, wherever it's scheduled from.
 *
 * The expiry has to outlast the whole fan-out. A cycle submits every one of its
 * runs at once and each is bounded by the provider's own task ceiling, so the
 * job runs for about as long as its slowest run — which, behind a provider
 * queue deep enough to matter, is that ceiling. The previous 15 minutes was
 * shorter than a single backed-up wave takes to drain, so healthy cycles were
 * being expired and retried: pg-boss can't cancel a promise, so the original
 * runs still finished and recorded, and the retry paid for all of them again.
 *
 * `retryLimit: 0` for the same reason from the other side. By the time this job
 * can fail it has already submitted paid requests, and a queue-level retry
 * re-submits the whole fan-out including the runs that succeeded. Recovery goes
 * through the handler's own backoff reschedule instead, or through
 * schedule-maintenance for a job that died before reaching it.
 */
export const PROMPT_JOB_OPTIONS = {
	retryLimit: 0,
	expireInSeconds: 90 * 60,
} as const;

/**
 * P0-3: target market → readable label → buildInjectedValue 已迁至 packages/lib/markets
 * worker 仅 import 共享实现（避免双写漂移）。labels 一处改全处生效。
 */
interface PromptContext {
	prompt: typeof prompts.$inferSelect;
	brand: Brand;
	competitors: Competitor[];
}

/**
 * Schedule the next run for a prompt.
 *
 * REPORT-001E: 默认手动模式，封住所有自动续排入口，直接拦截返回。
 */
async function scheduleNextRun(promptId: string, cadenceHours: number, consecutiveFailures: number): Promise<void> {
	console.log(`[Manual Mode] 自动续排已封禁：跳过为 prompt ${promptId} 续排下一次运行`);
}

/**
 * Get the cadence hours for a prompt based on its brand's delay override.
 */
async function getCadenceHours(promptId: string): Promise<number> {
	const defaultDelayHours = getDefaultDelayHours();
	const prompt = await db.query.prompts.findFirst({
		where: eq(prompts.id, promptId),
	});

	if (!prompt) return defaultDelayHours;

	const brand = await db.query.brands.findFirst({
		where: eq(brands.id, prompt.brandId),
	});

	if (!brand) return defaultDelayHours;

	return brand.delayOverrideHours ?? defaultDelayHours;
}

async function getPromptContext(promptId: string): Promise<PromptContext | null> {
	const prompt = await db.query.prompts.findFirst({
		where: eq(prompts.id, promptId),
	});

	if (!prompt) {
		console.error(`Prompt not found: ${promptId}`);
		return null;
	}

	const brand = await db.query.brands.findFirst({
		where: eq(brands.id, prompt.brandId),
	});

	if (!brand) {
		console.error(`Brand not found: ${prompt.brandId}`);
		return null;
	}

	const brandCompetitors = await db.query.competitors.findMany({
		where: eq(competitors.brandId, prompt.brandId),
	});

	return {
		prompt,
		brand,
		competitors: brandCompetitors,
	};
}

function extractDomainFromUrl(urlOrDomain: string): string {
	try {
		const url = new URL(urlOrDomain.startsWith("http") ? urlOrDomain : `https://${urlOrDomain}`);
		return url.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return urlOrDomain.replace(/^www\./, "").toLowerCase();
	}
}

function analyzeMentions(
	content: string,
	brand: Brand,
	competitorsList: Competitor[],
): {
	brandMentioned: boolean;
	competitorsMentioned: string[];
} {
	const contentLower = content.toLowerCase();

	const brandNames = [brand.name, ...(brand.aliases || [])].map((n) => n.toLowerCase());
	const brandDomains = [
		extractDomainFromUrl(brand.website),
		...(brand.additionalDomains || []).map(extractDomainFromUrl),
	];
	const brandMentioned =
		brandNames.some((n) => contentLower.includes(n)) || brandDomains.some((d) => contentLower.includes(d));

	const competitorsMentioned = competitorsList
		.filter((competitor) => {
			const names = [competitor.name, ...(competitor.aliases || [])].map((n) => n.toLowerCase());
			const nameMatch = names.some((n) => contentLower.includes(n));
			const domainMatch = (competitor.domains || []).some((d) => contentLower.includes(extractDomainFromUrl(d)));
			return nameMatch || domainMatch;
		})
		.map((competitor) => competitor.name);

	return { brandMentioned, competitorsMentioned };
}

async function savePromptRun(
	promptId: string,
	brandId: string,
	model: string,
	provider: string | null,
	version: string,
	webSearchEnabled: boolean,
	rawOutput: unknown,
	webQueries: string[],
	brandMentioned: boolean,
	competitorsMentioned: string[],
	brandName: string,
	brandAliases: string[],
	market: string | null,
	injectedValue: string | null,
): Promise<{ id: string; createdAt: Date }> {
	const position = analyzePosition(rawOutput, brandName, brandAliases);
	const [result] = await db
		.insert(promptRuns)
		.values({
			promptId,
			brandId,
			model,
			provider,
			version,
			webSearchEnabled,
			rawOutput,
			webQueries,
			brandMentioned,
			competitorsMentioned,
			answerRank: position.answerRank,
			answerType: position.answerType,
			// P0-3: market snapshot + actual prompt string sent to provider
			market,
			injectedValue,
		})
		.returning({ id: promptRuns.id, createdAt: promptRuns.createdAt });

	return result;
}

async function saveCitations(
	promptRunId: string,
	promptId: string,
	brandId: string,
	model: string,
	extracted: Citation[],
	createdAt: Date,
	market: string | null,
): Promise<void> {
	if (extracted.length === 0) return;

	await db.insert(citations).values(
		extracted.map((c) => ({
			promptRunId,
			promptId,
			brandId,
			model,
			url: c.url,
			domain: c.domain,
			title: c.title || null,
			citationIndex: c.citationIndex,
			// P0-3: market propagated from prompt_run
			market,
			createdAt,
		})),
	);
}

async function runModelIteration({
	promptId,
	promptValue,
	market,
	injectedValue,
	brand,
	competitorsList,
	config,
	providerImpl,
	runIndex,
}: {
	promptId: string;
	promptValue: string;
	market: string | null;
	injectedValue: string;
	brand: Brand;
	competitorsList: Competitor[];
	config: ModelConfig;
	providerImpl: Provider;
	runIndex: number;
}): Promise<void> {
	const logPrefix = `[${config.model}_${runIndex}]`;

	try {
		// P0-3: provider 实际收到 injectedValue（含市场前缀），非原始 promptValue
		const result = await providerImpl.run(config.model, injectedValue, {
			webSearch: config.webSearch,
			version: config.version,
		});

		// `webQueries` is stored exactly as the provider reported it — engines do
		// sometimes genuinely search the prompt verbatim, and that's real data. The
		// fan-out page excludes verbatim repeats at read time as a display rule;
		// providers whose query field is fabricated (DataForSEO) write the
		// `unavailable` sentinel in their own extractor instead.
		const { rawOutput, textContent, webQueries, citations: extractedCitations, modelVersion } = result;
		console.log(`${logPrefix} AI call completed, textContent length: ${textContent?.length ?? "null"}`);

		const safeTextContent = typeof textContent === "string" ? textContent : "";

		const { brandMentioned, competitorsMentioned } = analyzeMentions(safeTextContent, brand, competitorsList);

		const recordedVersion = modelVersion ?? config.version ?? config.provider;

		const { id: promptRunId, createdAt } = await savePromptRun(
			promptId,
			brand.id,
			config.model,
			config.provider,
			recordedVersion,
			config.webSearch,
			rawOutput,
			webQueries,
			brandMentioned,
			competitorsMentioned,
			brand.name,
			brand.aliases ?? [],
			market,
			injectedValue,
		);
		console.log(`${logPrefix} Saved prompt run ${promptRunId}`);

		await saveCitations(promptRunId, promptId, brand.id, config.model, extractedCitations, createdAt, market);
	} catch (error) {
		// A single run's failure doesn't fail the job, so report it here to keep
		// per-provider failure rates visible.
		Sentry.withScope((scope) => {
			scope.setTag("queue", "process-prompt");
			scope.setTag("provider", config.provider);
			scope.setTag("model", config.model);
			scope.setContext("run", { promptId, brandId: brand.id, runIndex });
			Sentry.captureException(error);
		});
		throw error;
	}
}

/**
 * Process a prompt - runs AI models and saves results.
 * This is a pg-boss job handler, called when a scheduled job fires.
 * After a cycle it schedules the next run: on cadence when anything came back,
 * on a backoff when nothing did.
 */
export async function processPromptJob(jobs: Job<ProcessPromptData>[]): Promise<void> {
	// pg-boss v12 passes an array of jobs - process each one
	for (const job of jobs) {
		const { promptId } = job.data;
		console.log(`Processing prompt ${promptId}`);

		// REPORT-001E: D->C 保持唯一采集责任。旧 worker provider 路径已不受支持并永久封死 (E2-R03 / E3-R05)。
		// 严禁通过任何环境变量 (如 ENABLE_LEGACY_WORKER_PROVIDER) 或布尔标记 (如 manualTriggered) 重新开启，防止无持久人工 run 授权与幂等的重放或注入。
		console.warn(
			`[Safety Guard] 拦截旧 worker provider 路径采样任务 (promptId=${promptId})：本轮 D->C 保持唯一采集责任，旧 provider 路径已永久封死，拒绝任何外部采集请求`,
		);
	}
}
