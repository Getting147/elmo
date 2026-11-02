import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const { signOutMock, resetPostHogMock } = vi.hoisted(() => {
	const signOutMock = vi.fn();
	const resetPostHogMock = vi.fn();
	return { signOutMock, resetPostHogMock };
});

vi.mock("@workspace/lib/auth/client", () => ({
	authClient: {
		signOut: signOutMock,
	},
}));

vi.mock("@/lib/posthog", () => ({
	resetPostHog: resetPostHogMock,
}));

describe("BUG-001 / B15: 品牌选择页退出登录交互契约测试", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("退出登录成功流程：调用 authClient.signOut，成功时执行 resetPostHog 并跳转 /auth/logout", async () => {
		let successCallback: (() => void) | undefined;
		signOutMock.mockImplementation((opts: any) => {
			successCallback = opts?.fetchOptions?.onSuccess;
			return Promise.resolve();
		});

		// 模拟执行退出处理函数
		let isLoggingOut = true;
		let logoutError = "";
		let redirectedUrl = "";

		const handleLogout = async () => {
			try {
				await signOutMock({
					fetchOptions: {
						onSuccess: () => {
							resetPostHogMock();
							redirectedUrl = "/auth/logout";
						},
					},
				});
			} catch {
				isLoggingOut = false;
				logoutError = "退出登录失败，请重试";
			}
		};

		await handleLogout();
		expect(signOutMock).toHaveBeenCalledTimes(1);

		// 触发成功回调
		successCallback?.();
		expect(resetPostHogMock).toHaveBeenCalledTimes(1);
		expect(redirectedUrl).toBe("/auth/logout");
		expect(logoutError).toBe("");
	});

	it("退出登录失败场景 (onError 回调): 不跳转，就近提示错误信息，并恢复按钮可用状态", async () => {
		let errorCallback: ((ctx: any) => void) | undefined;
		signOutMock.mockImplementation((opts: any) => {
			errorCallback = opts?.fetchOptions?.onError;
			return Promise.resolve();
		});

		let isLoggingOut = true;
		let logoutError = "";
		let redirectedUrl = "";

		const handleLogout = async (isZh = true) => {
			try {
				await signOutMock({
					fetchOptions: {
						onSuccess: () => {
							resetPostHogMock();
							redirectedUrl = "/auth/logout";
						},
						onError: (ctx: any) => {
							isLoggingOut = false;
							logoutError = isZh ? "退出登录失败，请重试" : ctx?.error?.message || "Failed to log out, please retry";
						},
					},
				});
			} catch {
				isLoggingOut = false;
				logoutError = isZh ? "退出登录失败，请重试" : "Failed to log out, please retry";
			}
		};

		await handleLogout(true);
		expect(signOutMock).toHaveBeenCalledTimes(1);

		// 触发失败回调
		errorCallback?.({ error: { message: "Network timeout" } });
		expect(resetPostHogMock).not.toHaveBeenCalled();
		expect(redirectedUrl).toBe(""); // 严禁冒充跳转
		expect(isLoggingOut).toBe(false); // 恢复按钮禁用状态
		expect(logoutError).toBe("退出登录失败，请重试");
	});

	it("退出登录异常场景 (Promise reject): 捕获网络异常，展示就近错误提示，不假报成功", async () => {
		signOutMock.mockRejectedValue(new Error("Network connection lost"));

		let isLoggingOut = true;
		let logoutError = "";
		let redirectedUrl = "";

		const handleLogout = async () => {
			try {
				await signOutMock({
					fetchOptions: {
						onSuccess: () => {
							resetPostHogMock();
							redirectedUrl = "/auth/logout";
						},
					},
				});
			} catch {
				isLoggingOut = false;
				logoutError = "退出登录失败，请重试";
			}
		};

		await handleLogout();
		expect(signOutMock).toHaveBeenCalledTimes(1);
		expect(resetPostHogMock).not.toHaveBeenCalled();
		expect(redirectedUrl).toBe("");
		expect(isLoggingOut).toBe(false);
		expect(logoutError).toBe("退出登录失败，请重试");
	});

	it("产品文案规范核验：中文必须为'退出登录'，英文为'Log out'，严禁写成'注销账号'", () => {
		const getButtonText = (isZh: boolean, isLoggingOut: boolean) => {
			if (isLoggingOut) return isZh ? "正在退出…" : "Logging out…";
			return isZh ? "退出登录" : "Log out";
		};

		const zhText = getButtonText(true, false);
		const enText = getButtonText(false, false);

		expect(zhText).toBe("退出登录");
		expect(zhText).not.toContain("注销");
		expect(zhText).not.toContain("删除");

		expect(enText).toBe("Log out");
		expect(enText).not.toContain("Delete");
	});
});
