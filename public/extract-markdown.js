/**
 * AI 浏览器 - 控制台版本
 * 使用 Readability.js 提取网页内容，Turndown 转换为 Markdown
 * 
 * 使用方法：
 * 1. 在浏览器控制台粘贴整个文件
 * 2. 运行 extractAndConvert() 开始提取和转换
 */

// ==================== 第一步：使用 Readability 提取内容 ====================

// 命名空间与加载缓存，避免污染全局与重复加载
window.__extractMarkdown = window.__extractMarkdown || { _loads: {} };

/**
 * 按 src 缓存并加载外部脚本（避免重复插入同一 src）
 * @param {string} src
 * @param {string} [globalName] - 可选的全局变量名，用于判断是否已加载
 * @returns {Promise<any>}
 */
function loadScriptOnce(src, globalName) {
  const cache = window.__extractMarkdown._loads;
  if (cache[src]) return cache[src];

  cache[src] = new Promise((resolve, reject) => {
    if (globalName && window[globalName]) return resolve(window[globalName]);

    const existing = Array.from(document.scripts).find(s => s.src === src);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true));
      existing.addEventListener('error', () => reject(new Error(src + ' 加载失败')));
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve(globalName ? window[globalName] : true);
    script.onerror = () => reject(new Error(src + ' 加载失败'));
    document.head.appendChild(script);
  });

  return cache[src];
}

/**
 * 为 Readability 创建一个独立的 Document 克隆，避免直接操作原始 document
 * @returns {Document}
 */
function cloneDocumentForReadability() {
  const doc = document.implementation.createHTMLDocument('cloned');
  doc.documentElement.innerHTML = document.documentElement.innerHTML;
  return doc;
}

/**
 * 使用 Readability.js 提取网页主要内容
 * @returns {Promise<Object>} 返回提取的文章对象
 */
async function extractContentWithReadability() {
  console.log('⏳ 第一步：加载 Readability.js...');
  
  // 加载 Readability 库
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mozilla/readability@0.4.2/Readability.js', 'Readability');
  
  console.log('✓ Readability.js 加载成功');
  console.log('⏳ 第二步：提取网页内容...\n');
  
  // 创建文档副本，避免修改原始 DOM
  const documentClone = cloneDocumentForReadability();
  const reader = new Readability(documentClone);
  const article = reader.parse();
  
  if (!article) {
    throw new Error('无法提取内容，可能是不支持的网页格式');
  }
  
  // 打印提取结果
  console.log('✓ 内容提取成功');
  console.log('【基本信息】');
  console.log(`  标题: ${article.title}`);
  console.log(`  作者: ${article.byline || '未知'}`);
  console.log(`  发布时间: ${article.publishedTime || '未知'}`);
  console.log(`  内容字数: ${article.length}`);
  console.log(`  摘要: ${article.excerpt || '无'}\n`);
  
  // 保存到全局变量供后续使用
  // 同时在命名空间与兼容旧全局上保存
  window.__extractMarkdown.article = article;
  window.extractedArticle = article;
  
  return article;
}

// ==================== 第二步：使用 Turndown 转换为 Markdown ====================

/**
 * 使用 Turndown 将提取的 HTML 内容转换为 Markdown
 * @param {Object} article - Readability 提取的文章对象
 * @returns {Promise<string>} 返回转换后的 Markdown 内容
 */
async function convertToMarkdownWithTurndown(article) {
  console.log('⏳ 第三步：加载 Turndown.js...');
  
  if (!article) {
    throw new Error('未找到文章对象，请先执行 extractContentWithReadability()');
  }
  
  // 加载 Turndown 库
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/turndown@7.1.1/dist/turndown.js', 'TurndownService');
  
  console.log('✓ Turndown.js 加载成功');
  console.log('⏳ 第四步：转换为 Markdown...\n');
  
  // 创建 Turndown 实例，配置选项
  const turndownService = new TurndownService({
    headingStyle: 'atx',           // 使用 # 格式的标题
    codeBlockStyle: 'fenced',      // 使用 ``` 围起的代码块
    bulletListMarker: '-',         // 列表符号使用 -
    strongDelimiter: '**',         // 加粗使用 **
    emDelimiter: '*'               // 斜体使用 *
  });
  
  // 添加自定义规则：处理 iframe
  turndownService.addRule('iframe', {
    filter: 'iframe',
    replacement: function(content, node) {
      const src = node && node.getAttribute ? (node.getAttribute('src') || '') : '';
      return `\n[iframe: ${src}]\n`;
    }
  });

  // 将相对链接转换为绝对链接
  turndownService.addRule('absolute-links', {
    filter: 'a',
    replacement: function(content, node) {
      const href = node.getAttribute('href') || '';
      try {
        const abs = new URL(href, window.location.href).href;
        return `[${content}](${abs})`;
      } catch (e) {
        return `[${content}](${href})`;
      }
    }
  });
  
  // 转换 HTML 为 Markdown
  const markdown = turndownService.turndown(article.content);
  
  // 组合完整的 Markdown 文档
  const fullMarkdown = `# ${article.title}

**来源**: ${window.location.href}

**作者**: ${article.byline || '未知'}

**发布时间**: ${article.publishedTime || '未知'}

**字数**: ${article.length} 字符

---

${markdown}`;
  
  console.log('✓ Markdown 转换成功');
  
  // 保存到全局变量
  window.__extractMarkdown.markdown = fullMarkdown;
  window.markdownContent = fullMarkdown;
  
  return fullMarkdown;
}

// ==================== 第三步：主函数 - 协调整个流程 ====================

/**
 * AI 浏览器主函数 - 一键提取网页内容并转换为 Markdown
 * 
 * 使用方法：
 * extractAndConvert();
 * 
 * @returns {Promise<Object>} 返回包含原始文章和 Markdown 内容的对象
 */
async function extractAndConvert() {
  try {
    console.clear();
    console.log('🚀 AI 浏览器内容提取开始...\n');
    console.log('='.repeat(70));
    
    // 步骤1：提取内容
    const article = await extractContentWithReadability();
    
    // 步骤2：转换为 Markdown
    const markdown = await convertToMarkdownWithTurndown(article);
    
    // 打印最终结果
    console.log('='.repeat(70));
    console.log('\n✨ 完成！AI浏览器内容提取成功\n');
    console.log('='.repeat(70));
    console.log('\n📄 提取的 Markdown 内容：\n');
    console.log(markdown);
    console.log('\n' + '='.repeat(70));
    console.log('\n💡 快速提示：');
    console.log('   📌 window.extractedArticle - 原始文章对象');
    console.log('   📄 window.markdownContent - Markdown 内容');
    console.log('   📋 copy(window.markdownContent) - 复制到剪贴板');
    console.log('\n' + '='.repeat(70));
    
    return {
      article: article,
      markdown: markdown,
      success: true
    };
    
  } catch (error) {
    console.error('❌ 错误:', error);
    return {
      success: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

// ==================== 辅助函数 ====================

/**
 * 复制 Markdown 内容到剪贴板
 */
function copyMarkdownToClipboard() {
  const text = window.__extractMarkdown && window.__extractMarkdown.markdown ? window.__extractMarkdown.markdown : window.markdownContent;
  if (!text) {
    console.error('❌ 没有找到 Markdown 内容，请先运行 extractAndConvert()');
    return;
  }

  copyToClipboard(text);
}

/**
 * 复制文本到剪贴板，支持回退方案
 * @param {string} text
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      console.log('✓ Markdown 内容已复制到剪贴板');
      return;
    } catch (e) {
      // fallthrough to fallback
    }
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'absolute';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    console.log('✓ Markdown 内容已复制到剪贴板（回退）');
  } catch (err) {
    console.error('❌ 复制失败:', err);
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * 打印提取的文章信息摘要
 */
function printArticleSummary() {
  if (!window.extractedArticle) {
    console.error('❌ 没有找到文章对象');
    return;
  }
  
  const article = window.extractedArticle;
  console.log('📰 文章信息摘要：');
  console.log(`   标题: ${article.title}`);
  console.log(`   作者: ${article.byline || '未知'}`);
  console.log(`   时间: ${article.publishedTime || '未知'}`);
  console.log(`   字数: ${article.length}`);
  console.log(`   摘要: ${article.excerpt || '无'}`);
}

/**
 * 导出 JSON 格式（用于保存）
 */
function exportAsJSON() {
  const article = window.__extractMarkdown && window.__extractMarkdown.article ? window.__extractMarkdown.article : window.extractedArticle;
  const markdown = window.__extractMarkdown && window.__extractMarkdown.markdown ? window.__extractMarkdown.markdown : window.markdownContent;
  if (!article || !markdown) {
    console.error('❌ 没有找到提取的内容');
    return;
  }

  const data = {
    title: article.title,
    author: article.byline,
    publishedTime: article.publishedTime,
    url: window.location.href,
    length: article.length,
    markdown: markdown,
    extractedAt: new Date().toISOString()
  };

  // 打印并返回对象，便于控制台复制或进一步处理
  console.log(JSON.stringify(data, null, 2));
  return data;
}

// ==================== 初始化提示 ====================

console.log('%c🤖 AI Browser Console Ready!', 'color: #4CAF50; font-size: 14px; font-weight: bold;');
console.log('%c可用命令：', 'color: #2196F3; font-weight: bold;');
console.log('%c  • extractAndConvert() - 一键提取并转换', 'color: #333;');
console.log('%c  • copyMarkdownToClipboard() - 复制到剪贴板', 'color: #333;');
console.log('%c  • printArticleSummary() - 显示文章摘要', 'color: #333;');
console.log('%c  • exportAsJSON() - 导出为 JSON', 'color: #333;');