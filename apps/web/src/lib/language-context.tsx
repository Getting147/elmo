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
    currentLang: "简体中文"
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
    currentLang: "English"
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
