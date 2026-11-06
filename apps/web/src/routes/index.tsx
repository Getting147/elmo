/**
 * Home page - / route
 *
 * Negency GEO Official Landing & Diagnosis Entrance
 * Unauthenticated: High-fidelity homepage with brand diagnosis & login modal.
 * Authenticated: Redirects to /app/new if pending brand intent exists; otherwise to /app.
 */
import { useEffect, useState } from "react";
import { createFileRoute, redirect, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { getSession } from "@/lib/auth/session";
import {
	getPendingBrandIntent,
	setPendingBrandIntent,
	hasPendingBrandIntent,
	type PendingBrandIntent,
} from "@/lib/pending-brand-intent";
import { HomeHeader } from "@/components/home/home-header";
import { HomeHero } from "@/components/home/home-hero";
import { HomeAnatomy } from "@/components/home/home-anatomy";
import { HomeCapabilities } from "@/components/home/home-capabilities";
import { HomeWorkflow } from "@/components/home/home-workflow";
import { HomeTrust } from "@/components/home/home-trust";
import { HomeFooter } from "@/components/home/home-footer";
import { HomeLoginModal } from "@/components/home/home-login-modal";

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		const session = await getSession();

		if (session) {
			if (typeof window !== "undefined" && hasPendingBrandIntent()) {
				throw redirect({ to: "/app/new" });
			}
			throw redirect({ to: "/app" });
		}

		if (context.clientConfig?.canRegister && !context.clientConfig?.hasUsers) {
			throw redirect({
				to: "/auth/register",
				search: search.redirect ? { returnTo: search.redirect } : {},
			});
		}

		return { session };
	},
	component: HomePage,
});

function HomePage() {
	const navigate = useNavigate();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const mode = context.clientConfig?.mode;
	const canRegister = context.clientConfig?.canRegister ?? false;

	const [theme, setTheme] = useState<"dark" | "light">(() => {
		if (typeof window !== "undefined") {
			const saved = localStorage.getItem("negency_theme") as "dark" | "light" | null;
			if (saved) return saved;
			return document.documentElement.classList.contains("dark") ? "dark" : "light";
		}
		return "dark";
	});
	const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
	const [loginSource, setLoginSource] = useState<"diagnosis" | "direct">("direct");
	const [triggerElement, setTriggerElement] = useState<HTMLElement | null>(null);
	const [currentIntent, setCurrentIntent] = useState<PendingBrandIntent | null>(() => {
		if (typeof window !== "undefined") {
			return getPendingBrandIntent();
		}
		return null;
	});

	// Theme initialization & synchronization
	useEffect(() => {
		const savedTheme = localStorage.getItem("negency_theme") as "dark" | "light" | null;
		const current = savedTheme || "dark";
		setTheme(current);
		document.documentElement.classList.toggle("dark", current === "dark");

		// Initial load of any existing intent
		const stored = getPendingBrandIntent();
		if (stored) {
			setCurrentIntent(stored);
		}
	}, []);

	const handleToggleTheme = () => {
		const nextTheme = theme === "dark" ? "light" : "dark";
		setTheme(nextTheme);
		localStorage.setItem("negency_theme", nextTheme);
		document.documentElement.classList.toggle("dark", nextTheme === "dark");
	};

	const handleStartDiagnosis = (brandName: string, website: string, trigger?: HTMLElement) => {
		if (trigger) {
			setTriggerElement(trigger);
		} else if (typeof document !== "undefined" && document.activeElement && document.activeElement !== document.body) {
			setTriggerElement(document.activeElement as HTMLElement);
		}
		const success = setPendingBrandIntent({ brandName, website });
		if (success) {
			const intent = getPendingBrandIntent();
			setCurrentIntent(intent);
			setLoginSource("diagnosis");
			setIsLoginModalOpen(true);
		}
	};

	const handleOpenDirectLogin = (trigger?: HTMLElement) => {
		if (trigger) {
			setTriggerElement(trigger);
		} else if (typeof document !== "undefined" && document.activeElement && document.activeElement !== document.body) {
			setTriggerElement(document.activeElement as HTMLElement);
		}
		// Explicitly mark as direct workspace login - must never be hijacked by pending diagnosis intent
		setLoginSource("direct");
		setIsLoginModalOpen(true);
	};

	const handleLoginSuccess = () => {
		setIsLoginModalOpen(false);
		// Only redirect to /app/new when login was initiated via the diagnosis form
		if (loginSource === "diagnosis") {
			navigate({ to: "/app/new" });
		} else {
			navigate({ to: "/app" });
		}
	};

	return (
		<div className="min-h-screen bg-background text-foreground transition-colors duration-200">
			{/* Top Header */}
			<HomeHeader
				theme={theme}
				onToggleTheme={handleToggleTheme}
				onOpenLogin={handleOpenDirectLogin}
			/>

			{/* Main Landing Sections */}
			<main>
				<HomeHero
					onStartDiagnosis={handleStartDiagnosis}
					defaultBrandName={currentIntent?.brandName ?? ""}
					defaultWebsite={currentIntent?.website ?? ""}
				/>
				<HomeAnatomy />
				<HomeCapabilities />
				<HomeWorkflow />
				<HomeTrust />
			</main>

			{/* Footer */}
			<HomeFooter />

			{/* Balanced Contextual Login Modal */}
			<HomeLoginModal
				isOpen={isLoginModalOpen}
				onClose={() => setIsLoginModalOpen(false)}
				intent={currentIntent}
				loginSource={loginSource}
				triggerElement={triggerElement}
				mode={mode}
				isDemo={mode === "demo"}
				isCloud={mode === "cloud"}
				canRegister={canRegister}
				onLoginSuccess={handleLoginSuccess}
			/>
		</div>
	);
}
