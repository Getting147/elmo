import { useEffect, useRef } from "react";
import {
	IconX,
	IconShieldCheck,
	IconDatabase,
	IconLock,
	IconBuilding,
	IconWorld,
	IconSparkles,
} from "@tabler/icons-react";
import type { DeploymentMode } from "@workspace/config/types";
import { EmailPasswordLoginForm, SSOLoginView } from "@/routes/auth/login";
import type { PendingBrandIntent } from "@/lib/pending-brand-intent";

interface HomeLoginModalProps {
	isOpen: boolean;
	onClose: () => void;
	intent: PendingBrandIntent | null;
	loginSource?: "diagnosis" | "direct";
	triggerElement?: HTMLElement | null;
	mode?: DeploymentMode;
	isDemo?: boolean;
	isCloud?: boolean;
	canRegister?: boolean;
	onLoginSuccess?: () => void;
}

export function HomeLoginModal({
	isOpen,
	onClose,
	intent,
	loginSource = "direct",
	triggerElement,
	mode,
	isDemo,
	isCloud,
	canRegister,
	onLoginSuccess,
}: HomeLoginModalProps) {
	const overlayRef = useRef<HTMLDivElement>(null);
	const modalRef = useRef<HTMLDivElement>(null);
	const internalTriggerRef = useRef<HTMLElement | null>(null);

	const handleCloseAndRestoreFocus = () => {
		onClose();
		const target = triggerElement || internalTriggerRef.current;
		if (target && typeof target.focus === "function") {
			setTimeout(() => {
				target.focus();
			}, 50);
		}
	};

	// Focus restoration: record trigger button when modal opens, restore focus on close
	useEffect(() => {
		if (isOpen) {
			if (triggerElement) {
				internalTriggerRef.current = triggerElement;
			} else if (
				document.activeElement &&
				document.activeElement !== document.body &&
				(!modalRef.current || !modalRef.current.contains(document.activeElement))
			) {
				internalTriggerRef.current = document.activeElement as HTMLElement;
			}

			// Auto-focus on primary interactive element inside modal
			const timer = setTimeout(() => {
				if (!modalRef.current) return;
				const emailInput = modalRef.current.querySelector<HTMLElement>("#email");
				if (emailInput && typeof emailInput.focus === "function") {
					emailInput.focus();
				} else {
					const firstFocusable = modalRef.current.querySelector<HTMLElement>(
						'button:not([disabled]), input:not([disabled]), [href], textarea, select, [tabindex]:not([tabindex="-1"])',
					);
					firstFocusable?.focus();
				}
			}, 50);

			return () => clearTimeout(timer);
		} else {
			const target = triggerElement || internalTriggerRef.current;
			if (target && typeof target.focus === "function") {
				const timer = setTimeout(() => {
					target.focus();
				}, 50);
				return () => clearTimeout(timer);
			}
		}
	}, [isOpen, triggerElement]);

	// Keyboard handling: Escape to close, Tab / Shift+Tab focus trap
	useEffect(() => {
		if (!isOpen) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				handleCloseAndRestoreFocus();
				return;
			}

			if (e.key === "Tab") {
				const modal = modalRef.current;
				if (!modal) return;

				const focusableElements = Array.from(
					modal.querySelectorAll<HTMLElement>(
						'button:not([disabled]), input:not([disabled]), [href], textarea, select, [tabindex]:not([tabindex="-1"])',
					),
				).filter((el) => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);

				if (focusableElements.length === 0) {
					e.preventDefault();
					return;
				}

				const firstElement = focusableElements[0];
				const lastElement = focusableElements[focusableElements.length - 1];

				if (e.shiftKey) {
					// Shift + Tab
					if (document.activeElement === firstElement || !modal.contains(document.activeElement)) {
						e.preventDefault();
						lastElement.focus();
					}
				} else {
					// Tab
					if (document.activeElement === lastElement || !modal.contains(document.activeElement)) {
						e.preventDefault();
						firstElement.focus();
					}
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	// Prevent background scrolling when modal is open
	useEffect(() => {
		if (isOpen) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [isOpen]);

	if (!isOpen) return null;

	// When loginSource is direct (e.g. from header login button), returnTo is fixed to /app
	const returnTo = loginSource === "diagnosis" && intent ? "/app/new" : "/app";
	const isWhitelabel = mode === "whitelabel";

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
			onClick={(e) => {
				if (e.target === overlayRef.current) {
					handleCloseAndRestoreFocus();
				}
			}}
		>
			<div
				ref={modalRef}
				className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl animate-in zoom-in-95 duration-200"
				role="dialog"
				aria-modal="true"
			>
				{/* Close Button */}
				<button
					type="button"
					onClick={handleCloseAndRestoreFocus}
					className="absolute top-4 right-4 z-20 flex size-8 items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors"
					aria-label="关闭弹窗"
				>
					<IconX className="size-4" />
				</button>

				{/* 3-Column Balanced Contextual Layout */}
				<div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border/60">
					{/* Left Column: Intent Context Summary */}
					<div className="hidden md:flex md:col-span-4 flex-col justify-between p-6 bg-muted/15 text-xs">
						<div>
							<div className="flex items-center gap-2 mb-4">
								<div className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
									<IconSparkles className="size-4" />
								</div>
								<span className="font-bold text-foreground">
									{intent && loginSource === "diagnosis" ? "待建档意图已暂存" : "Negency GEO 平台"}
								</span>
							</div>

							{intent && loginSource === "diagnosis" ? (
								<div className="space-y-3">
									<p className="text-muted-foreground leading-relaxed">
										您刚才填写的品牌资料已在本地会话暂存，登录成功后直接带入建档向导，无需重新填写。
									</p>

									<div className="rounded-xl border border-border/60 bg-card p-3 space-y-2">
										<div>
											<span className="text-[10px] uppercase font-semibold text-muted-foreground flex items-center gap-1">
												<IconBuilding className="size-3" />
												品牌名称
											</span>
											<p className="font-bold text-foreground truncate mt-0.5">
												{intent.brandName}
											</p>
										</div>
										<div className="pt-1 border-t border-border/40">
											<span className="text-[10px] uppercase font-semibold text-muted-foreground flex items-center gap-1">
												<IconWorld className="size-3" />
												品牌官网
											</span>
											<p className="font-mono text-muted-foreground truncate mt-0.5 text-[11px]">
												{intent.website}
											</p>
										</div>
									</div>
								</div>
							) : (
								<div className="space-y-3">
									<p className="text-muted-foreground leading-relaxed">
										登录后即可访问企业专属工作台，管理多品牌监测矩阵、查看 AI 引擎审计报告与信源引用。
									</p>
									<div className="rounded-xl border border-border/60 bg-card p-3 space-y-1.5">
										<div className="font-semibold text-foreground">
											多组织与品牌管理
										</div>
										<p className="text-muted-foreground text-[11px]">
											支持隔离多品牌工作空间与团队协作权限控制。
										</p>
									</div>
								</div>
							)}
						</div>

						<div className="pt-4 border-t border-border/40 text-[11px] text-muted-foreground">
							提示：点击右上角关闭后，首页输入的内容不会丢失。
						</div>
					</div>

					{/* Middle Column: Login Form or SSO Form */}
					<div className="md:col-span-5 p-6 sm:p-8 flex flex-col justify-center">
						<div className="mb-6 text-center sm:text-left">
							<h3 className="text-xl font-bold tracking-tight text-foreground">
								登录 NegencyGEO
							</h3>
							<p className="mt-1 text-xs text-muted-foreground">
								{intent && loginSource === "diagnosis"
									? `登录后直接继续完成「${intent.brandName}」的建档配置`
									: "请登录您的企业工作台账号"}
							</p>
						</div>

						{isWhitelabel ? (
							<SSOLoginView returnTo={returnTo} />
						) : (
							<EmailPasswordLoginForm
								returnTo={returnTo}
								isDemo={isDemo}
								isCloud={isCloud}
								canRegister={canRegister}
								onSuccess={onLoginSuccess}
								submitButtonText={
									intent && loginSource === "diagnosis"
										? "立即登录并继续创建 →"
										: "登录工作台"
								}
							/>
						)}

						<div className="mt-4 text-center">
							<span className="text-[11px] text-muted-foreground/80">
								当前版本面向内部团队与定向企业邀约
							</span>
						</div>
					</div>

					{/* Right Column: Security Guarantees */}
					<div className="hidden lg:flex lg:col-span-3 flex-col justify-between p-6 bg-muted/15 text-xs">
						<div>
							<div className="flex items-center gap-2 mb-4">
								<div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
									<IconShieldCheck className="size-4" />
								</div>
								<span className="font-bold text-foreground">
									企业级安全保障
								</span>
							</div>

							<div className="space-y-4">
								<div className="space-y-1">
									<div className="font-semibold text-foreground flex items-center gap-1.5">
										<IconDatabase className="size-3.5 text-blue-500" />
										防丢失保护
									</div>
									<p className="text-muted-foreground text-[11px] leading-relaxed">
										点击背景遮罩或 Esc 关闭弹窗，首页填写的品牌与官网完全保留。
									</p>
								</div>

								<div className="space-y-1">
									<div className="font-semibold text-foreground flex items-center gap-1.5">
										<IconLock className="size-3.5 text-indigo-500" />
										安全存储隔离
									</div>
									<p className="text-muted-foreground text-[11px] leading-relaxed">
										意图数据暂存于同一标签页 sessionStorage，不拼接在公开 URL 中，防止历史泄露。
									</p>
								</div>

								<div className="space-y-1">
									<div className="font-semibold text-foreground flex items-center gap-1.5">
										<IconShieldCheck className="size-3.5 text-emerald-500" />
										只读审计契约
									</div>
									<p className="text-muted-foreground text-[11px] leading-relaxed">
										登录不会自动触发抓取或付费调用，创建品牌由您完全确认。
									</p>
								</div>
							</div>
						</div>

						<div className="pt-4 border-t border-border/40 text-[10px] text-muted-foreground/70">
							Negency GEO Security & Compliance
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
