/**
 * 本地开发与测试账号初始化脚本 (REPORT-001E / E-R10)
 *
 * 为本地独立端到端走查、浏览器验证及角色权限测试快速准备种子数据：
 * - 组织: org_alpha
 * - 品牌: ALPHA (所属 org_alpha)
 * - 管理员账号: admin@alpha.internal (role: admin, 具有审核与管理授权权限)
 * - 普通操作员账号: operator@alpha.internal (role: member, 仅具有操作员诊断权限)
 * - 题目: 3 道正式题 + 1 道探针题
 *
 * 用法:
 *   pnpm --filter @workspace/web run seed:local
 */
import fs from "node:fs";
import path from "node:path";

// 自动加载本地 .env 环境配置
const envPaths = [
	path.resolve(process.cwd(), "../../.env"),
	path.resolve(process.cwd(), ".env"),
	path.resolve(process.cwd(), "../.env"),
];
for (const p of envPaths) {
	if (fs.existsSync(p)) {
		try {
			process.loadEnvFile(p);
			break;
		} catch {}
	}
}

async function main() {
	console.log("🌱 开始初始化本地测试租户与账号数据...");

	const { db } = await import("@workspace/lib/db/db");
	const { user, organization, member, brands, prompts } = await import("@workspace/lib/db/schema");

	const orgId = "org_alpha";
	const brandId = "ALPHA";

	// 1. 组织
	await db
		.insert(organization)
		.values({
			id: orgId,
			name: "远景海工组织",
			slug: "alpha-org",
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: organization.id,
			set: { name: "远景海工组织" },
		});
	console.log(`✓ 组织已就绪: ${orgId}`);

	// 2. 品牌
	await db
		.insert(brands)
		.values({
			id: brandId,
			name: "远景海工",
			website: "alpha-offshore.com",
			additionalDomains: ["alpha-holding.com"],
			aliases: ["Alpha Offshore", "远景海洋工程"],
			summary: "万吨级海工营地与模块化工程服务商",
			description: "专注于中东及出海市场的万吨级模块化海工营地建设。",
			organizationId: orgId,
			enabled: true,
			onboarded: true,
		})
		.onConflictDoUpdate({
			target: brands.id,
			set: { name: "远景海工", organizationId: orgId },
		});
	console.log(`✓ 品牌已就绪: ${brandId} (所属组织: ${orgId})`);

	// 3. 管理员用户 (具备审核权限)
	const adminId = "usr_alpha_admin";
	await db
		.insert(user)
		.values({
			id: adminId,
			name: "王安全主管",
			email: "admin@alpha.internal",
			emailVerified: true,
			role: "admin",
			hasReportGeneratorAccess: true,
		})
		.onConflictDoUpdate({
			target: user.id,
			set: { name: "王安全主管", role: "admin", hasReportGeneratorAccess: true },
		});

	await db
		.insert(member)
		.values({
			id: "mem_alpha_admin",
			organizationId: orgId,
			userId: adminId,
			role: "admin",
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: member.id,
			set: { role: "admin" },
		});
	console.log(`✓ 管理员账号已就绪: admin@alpha.internal (ID: ${adminId})`);

	// 4. 普通成员用户 (仅操作员权限，用于 E-R07 门禁验证)
	const memberId = "usr_alpha_operator";
	await db
		.insert(user)
		.values({
			id: memberId,
			name: "李操作员",
			email: "operator@alpha.internal",
			emailVerified: true,
			role: "user",
			hasReportGeneratorAccess: false,
		})
		.onConflictDoUpdate({
			target: user.id,
			set: { name: "李操作员", role: "user" },
		});

	await db
		.insert(member)
		.values({
			id: "mem_alpha_operator",
			organizationId: orgId,
			userId: memberId,
			role: "member",
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: member.id,
			set: { role: "member" },
		});
	console.log(`✓ 普通成员账号已就绪: operator@alpha.internal (ID: ${memberId})`);

	// 5. 题目数据
	const samplePrompts = [
		{
			id: "prompt_alpha_01",
			brandId: brandId,
			prompt: "沙特大型模块化工程营地主流服务商有哪些？",
			tags: ["cat:核心工程板块", "dim:基础知名度"],
			enabled: true,
		},
		{
			id: "prompt_alpha_02",
			brandId: brandId,
			prompt: "中东万吨级海工装备制造推荐企业？",
			tags: ["cat:核心装备制造", "dim:产品实力"],
			enabled: true,
		},
		{
			id: "prompt_alpha_03",
			brandId: brandId,
			prompt: "出海中资海工总包工程企业口碑评价？",
			tags: ["cat:核心工程板块", "dim:行业口碑"],
			enabled: true,
		},
		{
			id: "prompt_alpha_pr01",
			brandId: brandId,
			prompt: "远景海工在中东市场的交付案例和业主评价？",
			tags: ["probe", "dim:品牌识别与消歧"],
			enabled: true,
		},
	];

	for (const p of samplePrompts) {
		await db
			.insert(prompts)
			.values({
				id: p.id,
				brandId: p.brandId,
				prompt: p.prompt,
				tags: p.tags,
				enabled: p.enabled,
				createdAt: new Date(),
			})
			.onConflictDoUpdate({
				target: prompts.id,
				set: { prompt: p.prompt, tags: p.tags },
			});
	}
	console.log(`✓ 示例题库已就绪 (${samplePrompts.length} 题)`);
	console.log("🎉 本地种子数据初始化完成！");
	process.exit(0);
}

main().catch((err: any) => {
	if (err?.cause?.code === "ECONNREFUSED" || err?.code === "ECONNREFUSED") {
		console.warn(
			`⚠️ 本地 PostgreSQL 服务未在配置端口运行 (${err?.cause?.address || "127.0.0.1"}:${err?.cause?.port || "5432"})。请确保本地开发数据库启动后再执行完整入库初始化。`,
		);
		process.exit(0);
	}
	console.error("❌ 种子数据初始化失败:", err);
	process.exit(1);
});
