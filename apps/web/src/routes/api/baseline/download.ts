/**
 * /api/baseline/download — 受控报告产物代理下载接口 (REPORT-001E)
 *
 * 规则：
 * 1. 严格核验登录会话与当前品牌的组织权限 (requireAuthSession / requireOrgAccess)；
 * 2. 严禁客户端直连 Python，由 elmo 服务端安全代理，传递内部 X-Service-Token 与租户头；
 * 3. 严格校验 format 参数 (pdf | html | json)；
 * 4. 响应头附加 nosniff 与私有防缓存控制。
 */

import { createFileRoute } from "@tanstack/react-router";
import { getAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { getBaselineConfig, getBrandAndOrg } from "@/server/baseline.server";

export const Route = createFileRoute("/api/baseline/download")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const reportId = url.searchParams.get("reportId");
				const revisionId = url.searchParams.get("revisionId");
				const brandId = url.searchParams.get("brandId");
				const format = url.searchParams.get("format") || "pdf";

				if (!reportId || !revisionId || !brandId) {
					return new Response(
						JSON.stringify({ error: "missing_params", message: "缺少必要参数: reportId, revisionId, brandId" }),
						{ status: 400, headers: { "Content-Type": "application/json" } },
					);
				}

				if (!["pdf", "html", "json"].includes(format)) {
					return new Response(
						JSON.stringify({ error: "invalid_format", message: "format 仅允许 pdf, html, json" }),
						{ status: 400, headers: { "Content-Type": "application/json" } },
					);
				}

				// 1. 鉴权与租户核验
				const session = await getAuthSession();
				if (!session) {
					return new Response(
						JSON.stringify({ error: "unauthorized", message: "未登录或会话已过期" }),
						{ status: 401, headers: { "Content-Type": "application/json" } },
					);
				}

				let orgId = "";
				try {
					const { organizationId } = await getBrandAndOrg(brandId);
					await requireOrgAccess(session.user.id, organizationId);
					orgId = organizationId;
				} catch (err: any) {
					return new Response(
						JSON.stringify({ error: "forbidden", message: err.message || "无权访问此品牌的报告产物" }),
						{ status: 403, headers: { "Content-Type": "application/json" } },
					);
				}

				// 2. 代理向 Python 后端请求受控产物
				let config: { apiUrl: string; serviceToken: string };
				try {
					config = getBaselineConfig();
				} catch (err: any) {
					return new Response(
						JSON.stringify({ error: "server_config_error", message: err.message }),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}

				const targetUrl = `${config.apiUrl}/api/baseline/v1/reports/${reportId}/revisions/${revisionId}/download?format=${format}`;
				try {
					const pyResp = await fetch(targetUrl, {
						method: "GET",
						headers: {
							"X-Service-Token": config.serviceToken,
							"X-Organization-Id": orgId,
							"X-Brand-Id": brandId,
							"X-Caller-Id": session.user.id,
						},
					});

					if (!pyResp.ok) {
						const errText = await pyResp.text();
						return new Response(errText, {
							status: pyResp.status,
							headers: { "Content-Type": "application/json" },
						});
					}

					const blob = await pyResp.arrayBuffer();
					const contentType =
						format === "pdf"
							? "application/pdf"
							: format === "html"
								? "text/html; charset=utf-8"
								: "application/json; charset=utf-8";

					const headers = new Headers();
					headers.set("Content-Type", contentType);
					headers.set("X-Content-Type-Options", "nosniff");
					headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
					const disposition = pyResp.headers.get("content-disposition");
					if (disposition) {
						headers.set("Content-Disposition", disposition);
					} else {
						headers.set("Content-Disposition", `attachment; filename="${brandId}_${revisionId}.${format}"`);
					}

					return new Response(blob, {
						status: 200,
						headers,
					});
				} catch (err: any) {
					return new Response(
						JSON.stringify({ error: "backend_unavailable", message: `无法连接基线微服务: ${err.message}` }),
						{ status: 502, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
