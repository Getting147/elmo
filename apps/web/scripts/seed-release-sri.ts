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
	console.log("🌱 开始初始化 RELEASE-001A 星河国际测试数据...");

	const { db } = await import("@workspace/lib/db/db");
	const {
		user,
		organization,
		member,
		brands,
		prompts,
		account,
		competitors,
	} = await import("@workspace/lib/db/schema");
	const { hashPassword } = await import("@workspace/lib/auth/server");

	const orgId = "org_sri";
	const brandId = "brand_sri";

	// 1. 组织
	await db
		.insert(organization)
		.values({
			id: orgId,
			name: "星河国际组织",
			slug: "sri-org",
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: organization.id,
			set: { name: "星河国际组织" },
		});
	console.log(`✓ 组织已就绪: ${orgId}`);

	// 2. 品牌
	await db
		.insert(brands)
		.values({
			id: brandId,
			name: "星河国际",
			website: "http://www.szjgfw.com/",
			additionalDomains: ["xinghe-intl.com", "szjgfw.com"],
			aliases: ["星河国际", "Star River International", "SRI"],
			summary: "出海工程营地EPC与钢结构制造服务商",
			description: "专注于中东出海钢结构工程与模块化营地全案交付。",
			organizationId: orgId,
			enabled: true,
			onboarded: true,
		})
		.onConflictDoUpdate({
			target: brands.id,
			set: {
				name: "星河国际",
				website: "http://www.szjgfw.com/",
				additionalDomains: ["xinghe-intl.com", "szjgfw.com"],
				aliases: ["星河国际", "Star River International", "SRI"],
				organizationId: orgId,
				enabled: true,
				onboarded: true,
			},
		});
	console.log(`✓ 品牌已就绪: ${brandId} (官网: http://www.szjgfw.com/)`);

	// 3. 竞品
	const compData = [
		{
			id: "c0000000-0000-4000-c000-000000000001",
			brandId: brandId,
			name: "苏州中南钢结构",
			aliases: ["中南钢构", "苏州中南", "中南钢结构"],
			domains: ["zhongnan-steel.com"],
		},
		{
			id: "c0000000-0000-4000-c000-000000000002",
			brandId: brandId,
			name: "长江精工",
			aliases: ["精工钢构", "长江精工钢结构", "精工工业"],
			domains: ["600496.com"],
		},
		{
			id: "c0000000-0000-4000-c000-000000000003",
			brandId: brandId,
			name: "杭萧钢构",
			aliases: ["杭萧钢构", "杭萧"],
			domains: ["hangxiao.cn"],
		},
	];

	for (const c of compData) {
		await db
			.insert(competitors)
			.values({
				id: c.id,
				brandId: c.brandId,
				name: c.name,
				aliases: c.aliases,
				domains: c.domains,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: competitors.id,
				set: {
					name: c.name,
					aliases: c.aliases,
					domains: c.domains,
					updatedAt: new Date(),
				},
			});
	}
	console.log(`✓ 竞品已就绪 (${compData.length} 家)`);

	// 4. 管理员用户 (具备审核权限)
	const adminId = "usr_sri_admin";
	await db
		.insert(user)
		.values({
			id: adminId,
			name: "星河交付顾问",
			email: "admin@sri.internal",
			emailVerified: true,
			role: "admin",
			hasReportGeneratorAccess: true,
		})
		.onConflictDoUpdate({
			target: user.id,
			set: { name: "星河交付顾问", role: "admin", hasReportGeneratorAccess: true },
		});

	await db
		.insert(member)
		.values({
			id: "mem_sri_admin",
			organizationId: orgId,
			userId: adminId,
			role: "admin",
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: member.id,
			set: { role: "admin" },
		});

	const adminHashed = await hashPassword("Admin123456!");
	await db
		.insert(account)
		.values({
			id: "acc_sri_admin",
			accountId: adminId,
			providerId: "credential",
			userId: adminId,
			password: adminHashed,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: account.id,
			set: { password: adminHashed, updatedAt: new Date() },
		});
	console.log(`✓ 管理员账号已就绪: admin@sri.internal 密码: Admin123456!`);

	// 5. 第二租户 (BETA，用于跨租户 403 测试)
	const betaOrgId = "org_beta";
	const betaBrandId = "brand_beta";
	await db
		.insert(organization)
		.values({
			id: betaOrgId,
			name: "智电数科组织",
			slug: "beta-org",
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: organization.id,
			set: { name: "智电数科组织" },
		});

	await db
		.insert(brands)
		.values({
			id: betaBrandId,
			name: "智电数科",
			website: "beta-energy.com",
			additionalDomains: ["beta-power.com"],
			aliases: ["智电数科", "Beta Power"],
			summary: "智慧微电网与数字能源",
			description: "专注于高耗能园区能源调度与微电网优化。",
			organizationId: betaOrgId,
			enabled: true,
			onboarded: true,
		})
		.onConflictDoUpdate({
			target: brands.id,
			set: { name: "智电数科", organizationId: betaOrgId },
		});

	const betaOperatorId = "usr_beta_operator";
	await db
		.insert(user)
		.values({
			id: betaOperatorId,
			name: "测试操作员BETA",
			email: "operator@beta.internal",
			emailVerified: true,
			role: "user",
			hasReportGeneratorAccess: false,
		})
		.onConflictDoUpdate({
			target: user.id,
			set: { name: "测试操作员BETA", role: "user" },
		});

	await db
		.insert(member)
		.values({
			id: "mem_beta_operator",
			organizationId: betaOrgId,
			userId: betaOperatorId,
			role: "member",
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: member.id,
			set: { role: "member" },
		});

	const operatorHashed = await hashPassword("Operator123456!");
	await db
		.insert(account)
		.values({
			id: "acc_beta_operator",
			accountId: betaOperatorId,
			providerId: "credential",
			userId: betaOperatorId,
			password: operatorHashed,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: account.id,
			set: { password: operatorHashed, updatedAt: new Date() },
		});
	console.log(`✓ 隔离租户账号已就绪: operator@beta.internal 密码: Operator123456!`);

	// 6. 4道获准试跑题目 (1探针 + 3正式)
	const samplePrompts = [
		{
			id: "b0000000-0000-4000-b000-000000000001",
			brandId: brandId,
			value:
				"请检索公开资料，说明星河国际（Star River International，官网：http://www.szjgfw.com/）的品牌归属和主营业务，并提供来源链接。无法核实的信息请明确说明，不要猜测。",
			tags: ["dim:主体识别与官网探针", "probe"],
			systemTags: ["probe"],
			enabled: true,
		},
		{
			id: "b0000000-0000-4000-b000-000000000002",
			brandId: brandId,
			value:
				"海外大型工业厂房钢结构加工，国内有哪些具备AISC或欧标认证、且有中东供货业绩的钢结构企业？",
			tags: ["dim:钢结构工程"],
			systemTags: [],
			enabled: true,
		},
		{
			id: "b0000000-0000-4000-b000-000000000003",
			brandId: brandId,
			value:
				"中资企业在沙特承接大型基建项目，需要快速搭建数千人的模块化工程生活营地，有哪些具备全案交付能力的服务商？",
			tags: ["dim:营地EPC工程"],
			systemTags: [],
			enabled: true,
		},
		{
			id: "b0000000-0000-4000-b000-000000000004",
			brandId: brandId,
			value:
				"在沙特既需要钢结构主厂房、又需要现场办公和生活营地一体化交付，有哪些中企能做全包？",
			tags: ["dim:综合交付与一体化"],
			systemTags: [],
			enabled: true,
		},
	];

	for (const p of samplePrompts) {
		await db
			.insert(prompts)
			.values({
				id: p.id,
				brandId: p.brandId,
				value: p.value,
				tags: p.tags,
				systemTags: p.systemTags,
				enabled: p.enabled,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: prompts.id,
				set: {
					value: p.value,
					tags: p.tags,
					systemTags: p.systemTags,
					updatedAt: new Date(),
				},
			});
	}
	console.log(`✓ 4道获准代表题已入库`);
	console.log("🎉 星河国际与测试租户数据全部就绪！");
	process.exit(0);
}

main().catch((err: any) => {
	console.error("❌ 种子数据初始化失败:", err);
	process.exit(1);
});
