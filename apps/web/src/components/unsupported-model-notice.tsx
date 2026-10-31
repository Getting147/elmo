import { Card, CardContent } from "@workspace/ui/components/card";
import { IconInfoCircle } from "@tabler/icons-react";
import { useLanguage } from "@/lib/language-context";
import { UNSUPPORTED_MODEL_MESSAGE_ZH, UNSUPPORTED_MODEL_MESSAGE_EN } from "@/lib/model-filter";

export function UnsupportedModelNotice() {
	const { language } = useLanguage();
	const isZh = language === "zh";

	return (
		<Card className="border border-border/80 shadow-sm">
			<CardContent className="py-12 px-6 text-center space-y-3">
				<div className="size-12 mx-auto rounded-full bg-muted flex items-center justify-center text-muted-foreground">
					<IconInfoCircle size={24} />
				</div>
				<div className="space-y-1 max-w-md mx-auto">
					<h3 className="text-base font-semibold text-foreground">
						{isZh ? UNSUPPORTED_MODEL_MESSAGE_ZH : UNSUPPORTED_MODEL_MESSAGE_EN}
					</h3>
					<p className="text-xs text-muted-foreground">
						{isZh
							? "当前诊断评测仅开放接入豆包平台，暂未开放其他大模型。后续平台接入完成后将支持切换查看。"
							: "Only Doubao is currently supported for baseline diagnosis. Other AI engines will be supported in upcoming releases."}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
