import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type AnswerNode = { type: string; value?: string; children?: AnswerNode[] };

function remarkAnswerBreaks() {
	return (tree: AnswerNode) => {
		const walk = (node: AnswerNode) => {
			if (!node.children) return;
			node.children = node.children.flatMap((child): AnswerNode[] => {
				if (child.type === "html" && /^<br\s*\/?>$/i.test(child.value ?? "")) return [{ type: "break" }];
				if (child.type === "text" && child.value?.includes("\n")) {
					return child.value.split("\n").flatMap((value, index) =>
						index === 0 ? [{ ...child, value }] : [{ type: "break" }, { ...child, value }],
					);
				}
				walk(child);
				return [child];
			});
		};
		walk(tree);
	};
}

export function AnswerMarkdown({ text }: { text: string }) {
	return <div className="prose prose-sm dark:prose-invert min-w-0 max-w-none break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto">
		<ReactMarkdown
			remarkPlugins={[remarkGfm, remarkAnswerBreaks]}
			skipHtml
			components={{
				table: ({ children }) => <div className="max-w-full overflow-x-auto"><table className="w-max min-w-full">{children}</table></div>,
				a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
				img: ({ alt }) => <span>{alt}</span>,
			}}
		>{text}</ReactMarkdown>
	</div>;
}
