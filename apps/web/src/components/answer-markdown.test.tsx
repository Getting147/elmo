import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerMarkdown } from "./answer-markdown";

describe("expanded answer Markdown", () => {
	it("renders headings, paragraphs, lists, emphasis, tables, links and code", () => {
		const html = renderToStaticMarkup(<AnswerMarkdown text={"# Heading\n\nFirst\nSecond\n\n**bold**\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| a<br>b | c |\n\n[link](https://example.com)\n\n```js\nconst a = '<br>';\n```"} />);
		expect(html).toContain("<h1>Heading</h1>");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<p>First<br/>\nSecond</p>");
		expect(html).toContain("<ul>");
		expect(html).toContain("<table");
		expect(html).toContain("<td>a<br/>\nb</td>");
		expect(html).toContain("overflow-x-auto");
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('class="language-js"');
		expect(html).toContain("&#x27;&lt;br&gt;&#x27;");
	});

	it("does not execute model HTML, event handlers or dangerous URLs", () => {
		const html = renderToStaticMarkup(<AnswerMarkdown text={'safe<br />line\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[bad](javascript:alert%281%29)\n\n[data](data:text/html,bad)\n\n![remote](https://example.com/tracking.png)'} />);
		expect(html).toContain("safe<br/>\nline");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror");
		expect(html).not.toContain('href="javascript:');
		expect(html).not.toContain('href="data:');
		expect(html).not.toContain("<img");
		expect(html).toContain("remote");
	});
});
