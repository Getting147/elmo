import * as React from "react";

export type Language = "zh" | "en";

export const translations = {
  zh: {
    // 侧边栏与导航
    dashboard: "数据看板",
    overview: "概览总览",
    visibility: "AI 可见度",
    shareOfVoice: "声量份额（SOV）",
    queryFanOut: "联网检索发散",
    citations: "信源引用分析",
    opportunities: "增长机会地图",
    diagnosticReports: "9章诊断报告",
    settings: "配置管理",
    brandSettings: "品牌档案",
    profileSettings: "产品线与背书",
    competitorSettings: "竞品对标",
    promptSettings: "提示词库",
    llmSettings: "AI 引擎配置",
    memberSettings: "成员权限",
    
    // 诊断报告页面
    reportsTitle: "出海品牌 AI 可见度 9 章诊断报告",
    reportsSubtitle: "基于真实多引擎采样数据，程序化计算 22 项核心指标，输出符合顾问交付标准的 A4 印刷级商业报告。",
    downloadPdf: "下载 9章商业 PDF 报告",
    viewOnline: "在线全屏预览",
    generateNew: "重新生成最新报告",
    sampleStats: "样本采集规模",
    overallVisibility: "综合可见度指数",
    industryPercentile: "行业分位坐标",
    reportChapters: "9 大章节全貌",
    
    // 章节目录
    ch1: "1. 执行摘要 (Executive Summary)",
    ch2: "2. 大模型眼中的品牌 (How AI Sees the Brand)",
    ch3: "3. 平台覆盖矩阵 (Platform Coverage Matrix)",
    ch4: "4. 引用信源分析 (Citations Analysis)",
    ch5: "5. 口碑关键词 (Perception Keywords)",
    ch6: "6. 内容缺口分析 (Content Gaps)",
    ch7: "7. 竞品对比矩阵 (Competitor Comparison)",
    ch8: "8. 存在的问题清单 (Key Issues & Prioritization)",
    ch9: "9. GEO 优化策略 (Strategic Recommendations)",
    
    // 语言切换
    switchLang: "切换为 English",
    currentLang: "简体中文",

    // 品牌调研与向导
    researchTitle: "品牌数据调研",
    researchSubtitle: "我们将深度分析您的品牌官网，并推荐最适合追踪的生成式 AI 提示词与竞品对标。该过程约需 1~2 分钟。",
    researchIdleDesc: "我们将通过联网搜索分析您的品牌主站，生成竞品对标、附加域名/别名以及初始 AI 提示词库。",
    analyzeBrandBtn: "开始品牌调研",
    queuedForResearch: "排队中…",
    analyzingBrandWebsite: "正在分析品牌官网…",
    analyzingBrand: "正在调研品牌…",
    retryResearch: "重新调研",
    cancelBtn: "取消",
    researchTimedOut: "品牌调研超时，请重试。",
    researchFailed: "品牌调研失败，请重试。",

    // 品牌资料
    brandDetailsTitle: "品牌资料",
    brandDetailsSubtitle: "核对并确认用于 AI 监测的品牌身份、附加域名与品牌别名。",
    brandNameLabel: "品牌名称",
    brandNamePlaceholder: "输入品牌名称",
    oneLinePositioningLabel: "一句话定位",
    oneLinePositioningPlaceholder: "用一句话概括品牌的业务与定位",
    descriptionLabel: "企业简介",
    descriptionPlaceholder: "公司或主营产品的简明介绍",
    websiteUrlLabel: "品牌官方主站",
    websiteUrlPlaceholder: "https://example.com",
    additionalDomainsLabel: "附加域名",
    additionalDomainsPlaceholder: "添加域名...",
    aliasesLabel: "品牌别名",
    aliasesPlaceholder: "添加别名...",
    itemsAddedMax: "已达到上限，请先删除已有项。",
    itemsEntered: "项已录入。",

    // 产品线
    productLinesTitle: "产品线与业务板块",
    productLinesSubtitle: "品牌涵盖的产品线与具体型号/SKU。每个已验证型号均保留官网扫描的依据链接。",
    noProductLines: "暂无产品线。您可以在下方添加，或保持此部分为空。",
    productLineNamePlaceholder: "产品线名称（如：轻钢房屋、集装箱房）",
    removeProductLine: "删除产品线",
    removeSku: "删除型号 (SKU)",
    skuRequirementError: "每个型号均需填写名称和有效的官网证据链接方可保存。",
    skuNamePlaceholder: "产品型号 / SKU 名称",
    skuModelPlaceholder: "具体型号（选填）",
    skuOneLinerPlaceholder: "一句话产品特色",
    skuEvidenceUrlPlaceholder: "https://… 证据来源页面",
    addSkuBtn: "添加型号 (SKU)",
    addProductLineBtn: "添加产品线",
    unverifiedTitle: "未能通过官网扫描验证的建议产品线",
    unverifiedSubtitle: "以下项目因缺乏直接官网凭证未自动采纳。您可以忽略它们，或在上方手动补充凭证链接。",
    ignoreBtn: "忽略",

    // 竞品
    competitorsSectionTitle: "竞品对标",
    competitorsSectionSubtitle: "设置用于与我方进行 AI 表现对比的核心对标品牌。",
    unnamedCompetitor: "未命名竞品",
    competitorNameLabel: "竞品名称",
    competitorNameTooltip: "在 AI 回答中识别该竞品的主名称。提及检测仅对后续采样任务生效。",
    competitorNamePlaceholder: "竞品名称",
    competitorDomainsLabel: "官网域名",
    competitorDomainsPlaceholder: "添加域名...",
    competitorDomainsTooltip: "该竞品拥有的官方网站，用于匹配引用信源。",
    competitorAliasesLabel: "品牌别名",
    competitorAliasesPlaceholder: "添加别名...",
    competitorAliasesTooltip: "该竞品常用的其他名称或缩写。",
    addCompetitorBtn: "添加竞品",
    competitorsConfigured: "家竞品已配置",

    // 提示词
    promptsSectionTitle: "提示词库与采样问题",
    promptsSectionSubtitle: "选择用于首轮 AI 诊断与追踪的提示词。取消勾选不需要的问题，核对建议分类与标签，也可在底部新增问题。",
    promptTextCol: "采样提示词 / 问题题文",
    promptTextTooltip: "将发送给各大 AI 模型进行评估采样的核心问题。",
    systemTagsCol: "系统属性",
    systemTagsTooltip: "根据提示词内容自动生成的标签（如 branded/unbranded）。",
    categoryCol: "业务分类（用于诊断分组）",
    categoryTooltip: "该问题所属的业务板块或产品线维度，支撑 9 章报告的多业务对比。",
    tagsCol: "自定义标签",
    tagsTooltip: "用于归类和筛选提示词的自定义标签。",
    promptTextPlaceholder: "输入提示词内容...",
    addTagPlaceholder: "添加标签...",
    searchOrCreateTagPlaceholder: "搜索或创建标签...",
    selectCategoryPlaceholder: "选择或输入业务分类...",
    unclassifiedWarning: "待确认业务分类（冻结必填）",
    noPromptsYet: "暂无提示词。",
    addPromptBtn: "添加提示词",
    addMultipleBtn: "批量添加",
    onePromptPerLinePlaceholder: "每行输入一条提示词",
    addPromptsBtn: "添加提示词",
    promptsOverCapacity: "粘贴内容超出最大上限",
    selectedCount: "已选择",
    enableBtn: "启用",
    disableBtn: "禁用",
    clearSelectionBtn: "清空选择",
    promptsConfigured: "条提示词已配置",
    startTrackingBtn: "保存并开启 AI 追踪",
    savingBtn: "正在保存…"
  },
  en: {
    // Sidebar & Nav
    dashboard: "Dashboard",
    overview: "Overview",
    visibility: "Visibility",
    shareOfVoice: "Share of Voice",
    queryFanOut: "Query Fan-Out",
    citations: "Citations",
    opportunities: "Opportunities",
    diagnosticReports: "Diagnostic Reports",
    settings: "Settings",
    brandSettings: "Brand",
    profileSettings: "Product Lines & Credentials",
    competitorSettings: "Competitors",
    promptSettings: "Prompts",
    llmSettings: "LLMs",
    memberSettings: "Members",
    
    // Reports Page
    reportsTitle: "Brand AI Visibility 9-Chapter Diagnostic Report",
    reportsSubtitle: "Pure programmatic calculation of 22 core metrics based on multi-engine sampling, outputting consultant-grade commercial PDF reports.",
    downloadPdf: "Download Commercial PDF Report",
    viewOnline: "Full Screen Preview",
    generateNew: "Generate Latest Report",
    sampleStats: "Total Sampling Runs",
    overallVisibility: "Overall Visibility Index",
    industryPercentile: "Industry Percentile",
    reportChapters: "9 Diagnostic Chapters",
    
    // Chapters
    ch1: "1. Executive Summary",
    ch2: "2. How AI Sees the Brand",
    ch3: "3. Platform Coverage Matrix",
    ch4: "4. Citations & Sources Analysis",
    ch5: "5. Perception Keywords",
    ch6: "6. Content Gaps",
    ch7: "7. Competitor Comparison",
    ch8: "8. Key Issues & Prioritization",
    ch9: "9. Strategic Recommendations",
    
    // Language Toggle
    switchLang: "Switch to 中文",
    currentLang: "English",

    // Brand Research & Wizard
    researchTitle: "Research Brand Data",
    researchSubtitle: "We will analyze your website and find the best generative AI prompts to track. This process may take a couple of minutes.",
    researchIdleDesc: "We'll analyze the brand website using web search to suggest competitors, additional domains/aliases, and a starter set of AI prompts to track.",
    analyzeBrandBtn: "Analyze brand",
    queuedForResearch: "Queued for research…",
    analyzingBrandWebsite: "Analyzing brand website…",
    analyzingBrand: "Analyzing brand…",
    retryResearch: "Retry research",
    cancelBtn: "Cancel",
    researchTimedOut: "Brand research timed out. Please try again.",
    researchFailed: "Brand research failed. Please try again.",

    // Brand Details
    brandDetailsTitle: "Brand details",
    brandDetailsSubtitle: "Confirm the brand identity, additional domains, and aliases used for tracking.",
    brandNameLabel: "Brand name",
    brandNamePlaceholder: "Brand name",
    oneLinePositioningLabel: "One-line positioning",
    oneLinePositioningPlaceholder: "What the brand is, in one sentence",
    descriptionLabel: "Description",
    descriptionPlaceholder: "Short company / product introduction",
    websiteUrlLabel: "Website URL",
    websiteUrlPlaceholder: "https://example.com",
    additionalDomainsLabel: "Additional domains",
    additionalDomainsPlaceholder: "Add domain...",
    aliasesLabel: "Aliases",
    aliasesPlaceholder: "Add alias...",
    itemsAddedMax: "items added. Remove an item to add a new one.",
    itemsEntered: "items entered.",

    // Product Lines
    productLinesTitle: "Product lines",
    productLinesSubtitle: "Product lines and SKUs your content covers. Every SKU keeps an evidence URL from the website scan.",
    noProductLines: "No product lines yet. Add one below or keep this section empty.",
    productLineNamePlaceholder: "Product line name (e.g. Refrigerators)",
    removeProductLine: "Remove product line",
    removeSku: "Remove SKU",
    skuRequirementError: "Every SKU needs a name and a valid evidence URL before it can be saved.",
    skuNamePlaceholder: "SKU / model name",
    skuModelPlaceholder: "Model (optional)",
    skuOneLinerPlaceholder: "One-line feature summary",
    skuEvidenceUrlPlaceholder: "https://… evidence page",
    addSkuBtn: "Add SKU",
    addProductLineBtn: "Add product line",
    unverifiedTitle: "Suggestions that could not be verified against the website",
    unverifiedSubtitle: "These were left out. Ignore them, or add them manually above with a valid evidence URL.",
    ignoreBtn: "Ignore",

    // Competitors
    competitorsSectionTitle: "Competitors",
    competitorsSectionSubtitle: "Companies you want tracked alongside your brand.",
    unnamedCompetitor: "Unnamed competitor",
    competitorNameLabel: "Name",
    competitorNameTooltip: "The primary name used to detect this competitor in AI responses. Mention detection applies to future prompt runs only.",
    competitorNamePlaceholder: "Competitor name",
    competitorDomainsLabel: "Domains",
    competitorDomainsPlaceholder: "Add domain...",
    competitorDomainsTooltip: "Websites owned by this company used to match citations.",
    competitorAliasesLabel: "Aliases",
    competitorAliasesPlaceholder: "Add alias...",
    competitorAliasesTooltip: "Other names this company is known by.",
    addCompetitorBtn: "Add Competitor",
    competitorsConfigured: "competitors configured",

    // Prompts
    promptsSectionTitle: "Prompts",
    promptsSectionSubtitle: "Pick which AI tracking prompts to start with. Untick any you don't want, edit tags, or add your own at the bottom.",
    promptTextCol: "Prompt Text",
    promptTextTooltip: "The question or query that will be sent to AI models for evaluation.",
    systemTagsCol: "System",
    systemTagsTooltip: "Auto-generated tags like 'branded' or 'unbranded' based on prompt content.",
    categoryCol: "Category",
    categoryTooltip: "Business category / product line dimension for diagnostic grouping.",
    tagsCol: "Tags",
    tagsTooltip: "Custom labels to organize and filter prompts.",
    promptTextPlaceholder: "Enter prompt text...",
    addTagPlaceholder: "Add tag...",
    searchOrCreateTagPlaceholder: "Search or create tag...",
    selectCategoryPlaceholder: "Select or enter category...",
    unclassifiedWarning: "Unclassified (required)",
    noPromptsYet: "No prompts yet.",
    addPromptBtn: "Add Prompt",
    addMultipleBtn: "Add Multiple",
    onePromptPerLinePlaceholder: "One prompt per line",
    addPromptsBtn: "Add Prompts",
    promptsOverCapacity: "This paste is over the limit",
    selectedCount: "selected",
    enableBtn: "Enable",
    disableBtn: "Disable",
    clearSelectionBtn: "Clear",
    promptsConfigured: "prompts configured",
    startTrackingBtn: "Start tracking",
    savingBtn: "Saving…"
  }
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof translations["zh"];
}

const LanguageContext = React.createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLangState] = React.useState<Language>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("elmo_lang") as Language) || "zh";
    }
    return "zh";
  });

  const setLanguage = (lang: Language) => {
    setLangState(lang);
    if (typeof window !== "undefined") {
      localStorage.setItem("elmo_lang", lang);
      if (typeof (window as any).setElmoLanguage === "function") {
        (window as any).setElmoLanguage(lang);
      }
    }
  };

  const t = translations[language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = React.useContext(LanguageContext);
  if (!context) {
    return {
      language: "zh" as Language,
      setLanguage: () => {},
      t: translations.zh
    };
  }
  return context;
}
