(function () {
  const ZH_DICT = {
    // 基础导航
    "Overview": "概览总览",
    "Visibility": "AI 可见度",
    "Share of Voice": "声量份额 (SOV)",
    "Query Fan-Out": "Query 联网检索",
    "Citations": "信源引用分析",
    "Opportunities": "增长机会地图",
    "Diagnostic Reports": "9章诊断报告",
    "Dashboard": "数据看板",
    "Settings": "配置管理",
    "Brand": "品牌档案",
    "Competitors": "竞品对标",
    "Prompts": "提示词库",
    "LLMs": "AI 引擎配置",
    "Members": "成员权限",
    "Workflows": "工作流管理",
    "Tools": "工具箱",
    "Prompts DB": "数据库管理",
    "Default": "默认工作区",
    "Create new brand": "创建新品牌",
    "Create a new brand": "创建新品牌监测",
    "Set up a brand to start tracking": "配置品牌以开启 AI 可见度追踪",
    "Brand name": "品牌名称",
    "Website": "品牌官方主站",
    "Create brand": "立即创建品牌",
    "Go Back": "返回上一页",
    "Sign in": "登录",
    "Sign In": "登录",
    "Enter your email and password to continue": "请输入邮箱与密码以继续",
    "Email": "电子邮箱",
    "Password": "密码",
    "Toggle Sidebar": "折叠/展开侧边栏",
    "Waiting for First Evaluation": "正在进行首轮多引擎评估",
    "You are ready to track your AI visibility. We're currently running the first evaluation against AI models. This usually takes a few minutes.": "您的品牌已配置就绪。后台 Worker 正在针对主流 AI 大模型进行首轮采样与分析评估，这通常需要几分钟。",
    "Prompts configured and enabled": "已配置并启用的提示词",
    "View Your Prompts": "查看提示词列表",
    "Refresh this page in a few minutes to see your AI visibility data.": "请在采样完成后刷新此页面查看最新的 AI 可见度与图表数据。",
    "AI Visibility": "AI 可见度指数",
    "Visibility Trends (30d)": "AI 可见度趋势 (30天)",
    "Share of Voice Trends (30d)": "声量份额趋势 (30天)",
    "View Visibility": "查看可见度详情",
    "View Share of Voice": "查看声量详情",
    "All Models": "全部 AI 引擎",
    "All Tags": "全部标签",
    "Search prompts...": "搜索提示词...",
    "Filter": "筛选",
    "Sort": "排序",
    "Brand Visibility": "品牌可见度",
    "Competitor Visibility": "竞品可见度",
    "Prompt A–Z": "提示词 A–Z",
    "Prompt Z–A": "提示词 Z–A",
    "Add prompt": "添加提示词",
    "Add competitor": "添加竞品",
    "Save changes": "保存修改",
    "Cancel": "取消",
    "Delete": "删除",
    "Edit": "编辑",
    "Loading...": "正在加载数据...",
    "No data available": "暂无测量数据",
    "Through Q1-Q8 Quality Gates": "通过 Q1-Q8 质量门禁",
    "Active": "运行中",
    "Completed": "已完成",
    "Failed": "失败",
    "Status": "状态",
    "Model": "模型",
    "Actions": "操作"
  };

  // 构造反向字典 (中文 -> 英文)
  const EN_DICT = {};
  for (let k in ZH_DICT) {
    EN_DICT[ZH_DICT[k]] = k;
  }

  function getLang() {
    return localStorage.getItem("elmo_lang") || "zh";
  }

  function translateNode(node, targetLang) {
    const dict = targetLang === "zh" ? ZH_DICT : EN_DICT;
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = node.nodeValue.trim();
      if (txt && dict[txt]) {
        node.nodeValue = node.nodeValue.replace(txt, dict[txt]);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.placeholder && dict[node.placeholder]) {
        node.placeholder = dict[node.placeholder];
      }
      if (node.title && dict[node.title]) {
        node.title = dict[node.title];
      }
      for (let child of node.childNodes) {
        translateNode(child, targetLang);
      }
    }
  }

  // 全量即时重绘整个 DOM 树（无需刷新页面）
  function renderAll(targetLang) {
    if (document.body) {
      translateNode(document.body, targetLang);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    renderAll(getLang());
  });

  // 监听 DOM 异步插入
  const observer = new MutationObserver((mutations) => {
    const curLang = getLang();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        translateNode(node, curLang);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // 全局无刷新平滑切换函数
  window.setElmoLanguage = function (nextLang) {
    localStorage.setItem("elmo_lang", nextLang);
    renderAll(nextLang);
  };
})();
