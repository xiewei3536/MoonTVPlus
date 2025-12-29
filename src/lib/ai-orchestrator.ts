/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI数据源协调器
 * 负责协调AI与联网搜索、豆瓣API、TMDB API之间的数据交互
 */

export interface VideoContext {
  title?: string;
  year?: string;
  douban_id?: number;
  tmdb_id?: number;
  type?: 'movie' | 'tv';
  currentEpisode?: number;
}

export interface IntentAnalysisResult {
  type: 'recommendation' | 'query' | 'detail' | 'general';
  mediaType?: 'movie' | 'tv' | 'variety' | 'anime';
  genre?: string;
  needWebSearch: boolean;
  needDouban: boolean;
  needTMDB: boolean;
  keywords: string[];
  entities: Array<{ type: string; value: string }>;
}

export interface DecisionResult {
  needWebSearch: boolean;
  needDouban: boolean;
  needTMDB: boolean;
  webSearchQuery?: string;
  doubanQuery?: string;
  reasoning?: string;
}

export interface OrchestrationResult {
  systemPrompt: string;
  webSearchResults?: any;
  doubanData?: any;
  tmdbData?: any;
}

/**
 * 分析用户意图
 */
export function analyzeIntent(
  message: string,
  context?: VideoContext
): IntentAnalysisResult {
  const lowerMessage = message.toLowerCase();

  // 时效性关键词 - 需要最新信息的问题
  const timeKeywords = [
    '最新', '今年', '2024', '2025', '即将', '上映', '新出',
    '什么时候', '何时', '几时', '播出', '更新', '下一季',
    '第二季', '第三季', '续集', '下季', '下部'
  ];
  const hasTimeKeyword = timeKeywords.some((k) => message.includes(k));

  // 推荐类关键词
  const recommendKeywords = ['推荐', '有什么', '好看', '值得', '介绍'];
  const isRecommendation = recommendKeywords.some((k) => message.includes(k));

  // 演员/导演关键词
  const personKeywords = ['演员', '导演', '主演', '出演', '作品'];
  const isPerson = personKeywords.some((k) => message.includes(k));

  // 剧情相关关键词
  const plotKeywords = ['讲什么', '剧情', '故事', '内容', '讲的是'];
  const isPlotQuery = plotKeywords.some((k) => message.includes(k));

  // 媒体类型判断
  let mediaType: 'movie' | 'tv' | 'variety' | 'anime' | undefined;
  if (message.includes('电影')) mediaType = 'movie';
  else if (message.includes('电视剧') || message.includes('剧集'))
    mediaType = 'tv';
  else if (message.includes('综艺')) mediaType = 'variety';
  else if (message.includes('动漫') || message.includes('动画'))
    mediaType = 'anime';
  else if (context?.type) mediaType = context.type;

  // 类型判断
  let type: IntentAnalysisResult['type'] = 'general';
  if (isRecommendation) type = 'recommendation';
  else if (context?.title && (isPlotQuery || lowerMessage.includes('这部')))
    type = 'detail';
  else if (isPerson || hasTimeKeyword) type = 'query';

  // 决定是否需要各个数据源
  // 联网搜索: 对于推荐、查询、时效性问题、演员信息等都应该启用
  // 当用户在观看视频时提问(有context),默认也应该联网以获取最新信息
  const needWebSearch =
    hasTimeKeyword ||
    isPerson ||
    message.includes('新闻') ||
    isRecommendation ||
    type === 'query' ||
    (context?.title !== undefined); // 有上下文时默认联网
  const needDouban =
    isRecommendation ||
    type === 'detail' ||
    (context?.douban_id !== undefined && context.douban_id > 0);
  const needTMDB =
    type === 'detail' ||
    (context?.tmdb_id !== undefined && context.tmdb_id > 0);

  return {
    type,
    mediaType,
    needWebSearch,
    needDouban,
    needTMDB,
    keywords: timeKeywords.filter((k) => message.includes(k)),
    entities: extractEntities(message),
  };
}

/**
 * 提取实体（简化版，基于关键词匹配）
 */
function extractEntities(message: string): Array<{ type: string; value: string }> {
  const entities: Array<{ type: string; value: string }> = [];

  // 简单的人名匹配（中文2-4字）
  const personPattern = /([一-龥]{2,4})(的|是|演|导)/g;
  let match;
  while ((match = personPattern.exec(message)) !== null) {
    entities.push({ type: 'person', value: match[1] });
  }

  return entities;
}

/**
 * 获取联网搜索结果
 */
async function fetchWebSearch(
  query: string,
  provider: 'tavily' | 'serper' | 'serpapi',
  apiKey: string
): Promise<any> {
  try {
    if (provider === 'tavily') {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          include_domains: ['douban.com', 'imdb.com', 'themoviedb.org', 'mtime.com'],
          max_results: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.status}`);
      }

      return await response.json();
    } else if (provider === 'serper') {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: 5,
        }),
      });

      if (!response.ok) {
        throw new Error(`Serper API error: ${response.status}`);
      }

      return await response.json();
    } else if (provider === 'serpapi') {
      const response = await fetch(
        `https://serpapi.com/search?engine=google&q=${encodeURIComponent(query)}&api_key=${apiKey}&num=5`
      );

      if (!response.ok) {
        throw new Error(`SerpAPI error: ${response.status}`);
      }

      return await response.json();
    }
  } catch (error) {
    console.error('Web search error:', error);
    return null;
  }
}

/**
 * 获取豆瓣数据
 */
async function fetchDoubanData(params: {
  id?: number;
  query?: string;
  kind?: string;
  category?: string;
  type?: string;
}): Promise<any> {
  try {
    if (params.id) {
      // 获取详情
      const response = await fetch(`/api/douban/detail?id=${params.id}`);
      if (response.ok) {
        return await response.json();
      }
    } else if (params.query) {
      // 搜索
      const response = await fetch('/api/douban/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: params.query,
          type: params.kind || 'movie',
        }),
      });
      if (response.ok) {
        return await response.json();
      }
    } else if (params.kind && params.category) {
      // 分类列表
      const response = await fetch('/api/douban/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: params.kind,
          category: params.category,
          type: params.type || '全部',
        }),
      });
      if (response.ok) {
        return await response.json();
      }
    }
  } catch (error) {
    console.error('Douban API error:', error);
  }
  return null;
}

/**
 * 获取TMDB数据
 */
async function fetchTMDBData(params: {
  id?: number;
  type?: 'movie' | 'tv';
}): Promise<any> {
  try {
    if (params.id && params.type) {
      const response = await fetch(
        `/api/tmdb/detail?id=${params.id}&type=${params.type}`
      );
      if (response.ok) {
        return await response.json();
      }
    }
  } catch (error) {
    console.error('TMDB API error:', error);
  }
  return null;
}

/**
 * 格式化搜索结果为文本
 */
function formatSearchResults(
  results: any,
  provider: 'tavily' | 'serper' | 'serpapi'
): string {
  if (!results) return '';

  try {
    if (provider === 'tavily' && results.results) {
      return results.results
        .map(
          (r: any) => `
标题: ${r.title}
内容: ${r.content}
来源: ${r.url}
`
        )
        .join('\n');
    } else if (provider === 'serper' && results.organic) {
      return results.organic
        .map(
          (r: any) => `
标题: ${r.title}
摘要: ${r.snippet}
来源: ${r.link}
`
        )
        .join('\n');
    } else if (provider === 'serpapi' && results.organic_results) {
      return results.organic_results
        .map(
          (r: any) => `
标题: ${r.title}
摘要: ${r.snippet}
来源: ${r.link}
`
        )
        .join('\n');
    }
  } catch (error) {
    console.error('Format search results error:', error);
  }

  return ''
}

/**
 * 使用决策模型判断是否需要调用各个数据源
 */
async function callDecisionModel(
  userMessage: string,
  context: VideoContext | undefined,
  config: {
    provider: 'openai' | 'claude' | 'custom';
    apiKey: string;
    baseURL?: string;
    model: string;
  }
): Promise<DecisionResult> {
  const systemPrompt = `你是一个影视问答决策系统。请分析用户的问题，判断需要调用哪些数据源来回答。

可用的数据源：
1. **联网搜索** - 获取最新的实时信息（新闻、上映时间、续集信息等）
2. **豆瓣API** - 获取中文影视数据（评分、演员、简介、用户评论等）
3. **TMDB API** - 获取国际影视数据（详细元数据、相似推荐等）

请以JSON格式返回决策结果，包含以下字段：
{
  "needWebSearch": boolean,  // 是否需要联网搜索
  "needDouban": boolean,     // 是否需要豆瓣数据
  "needTMDB": boolean,       // 是否需要TMDB数据
  "webSearchQuery": string,  // 如果需要联网，用什么关键词搜索（可选）
  "doubanQuery": string,     // 如果需要豆瓣，用什么关键词搜索（可选）
  "reasoning": string        // 简要说明决策理由
}

决策原则：
- 时效性问题（最新、上映时间、续集、播出等）→ 需要联网搜索
- 推荐类问题 → 优先豆瓣
- 剧情、演员、评分等静态信息 → 豆瓣或TMDB
- 当前视频的详细信息 → 豆瓣+TMDB
- 有疑问时倾向于多调用数据源

只返回JSON，不要其他内容。`;

  let contextInfo = '';
  if (context?.title) {
    contextInfo = `\n\n当前视频上下文：\n- 标题：${context.title}`;
    if (context.year) contextInfo += `\n- 年份：${context.year}`;
    if (context.type) contextInfo += `\n- 类型：${context.type === 'movie' ? '电影' : '电视剧'}`;
    if (context.currentEpisode) contextInfo += `\n- 当前集数：第${context.currentEpisode}集`;
  }

  const userPrompt = `用户问题：${userMessage}${contextInfo}`;

  try {
    let response: Response;

    if (config.provider === 'claude') {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 500,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || '';

      // 提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } else {
      // OpenAI 或 自定义 (OpenAI兼容格式)
      const baseURL = config.baseURL || 'https://api.openai.com/v1';
      response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('❌ 决策模型调用失败:', error);
  }

  // 失败时返回默认决策（保守策略：都调用）
  return {
    needWebSearch: true,
    needDouban: true,
    needTMDB: context?.tmdb_id !== undefined,
    reasoning: '决策模型调用失败，使用默认策略',
  };
}

/**
 * 主协调函数
 */
export async function orchestrateDataSources(
  userMessage: string,
  context?: VideoContext,
  config?: {
    enableWebSearch: boolean;
    webSearchProvider?: 'tavily' | 'serper' | 'serpapi';
    tavilyApiKey?: string;
    serperApiKey?: string;
    serpApiKey?: string;
    // 决策模型配置
    enableDecisionModel?: boolean;
    decisionProvider?: 'openai' | 'claude' | 'custom';
    decisionApiKey?: string;
    decisionBaseURL?: string;
    decisionModel?: string;
  }
): Promise<OrchestrationResult> {
  let intent: IntentAnalysisResult;

  // 1. 使用决策模型或传统意图分析
  if (config?.enableDecisionModel && config.decisionProvider && config.decisionApiKey && config.decisionModel) {
    console.log('🤖 使用决策模型分析...');

    const decision = await callDecisionModel(userMessage, context, {
      provider: config.decisionProvider,
      apiKey: config.decisionApiKey,
      baseURL: config.decisionBaseURL,
      model: config.decisionModel,
    });

    console.log('🎯 决策模型结果:', decision);

    // 将决策结果转换为 IntentAnalysisResult 格式
    intent = {
      type: decision.needDouban ? 'detail' : 'general',
      needWebSearch: decision.needWebSearch,
      needDouban: decision.needDouban,
      needTMDB: decision.needTMDB,
      keywords: decision.webSearchQuery ? [decision.webSearchQuery] : [],
      entities: [],
    };
  } else {
    // 传统关键词匹配分析
    intent = analyzeIntent(userMessage, context);
    console.log('📊 意图分析结果:', intent);
  }

  // 2. 并行获取所需的数据源
  const dataPromises: Promise<any>[] = [];

  let webSearchPromise: Promise<any> | null = null;
  let doubanPromise: Promise<any> | null = null;
  let tmdbPromise: Promise<any> | null = null;

  // 联网搜索
  if (
    intent.needWebSearch &&
    config?.enableWebSearch &&
    config.webSearchProvider
  ) {
    const provider = config.webSearchProvider;
    const apiKey =
      provider === 'tavily'
        ? config.tavilyApiKey
        : provider === 'serper'
          ? config.serperApiKey
          : config.serpApiKey;

    if (apiKey) {
      webSearchPromise = fetchWebSearch(userMessage, provider, apiKey);
      dataPromises.push(webSearchPromise);
    }
  }

  // 豆瓣数据
  if (intent.needDouban) {
    if (context?.douban_id) {
      doubanPromise = fetchDoubanData({ id: context.douban_id });
    } else if (intent.type === 'recommendation') {
      doubanPromise = fetchDoubanData({
        kind: intent.mediaType || 'movie',
        category: '热门',
        type: intent.genre || '全部',
      });
    } else if (context?.title) {
      doubanPromise = fetchDoubanData({
        query: context.title,
        kind: context.type,
      });
    }

    if (doubanPromise) {
      dataPromises.push(doubanPromise);
    }
  }

  // TMDB数据
  if (intent.needTMDB && context?.tmdb_id && context?.type) {
    tmdbPromise = fetchTMDBData({
      id: context.tmdb_id,
      type: context.type,
    });
    dataPromises.push(tmdbPromise);
  }

  // 3. 等待所有数据获取完成
  const results = await Promise.allSettled(dataPromises);

  let webSearchData = null;
  let doubanData = null;
  let tmdbData = null;

  let resultIndex = 0;
  if (webSearchPromise) {
    const result = results[resultIndex++];
    if (result.status === 'fulfilled') {
      webSearchData = result.value;
    }
  }
  if (doubanPromise) {
    const result = results[resultIndex++];
    if (result.status === 'fulfilled') {
      doubanData = result.value;
    }
  }
  if (tmdbPromise) {
    const result = results[resultIndex++];
    if (result.status === 'fulfilled') {
      tmdbData = result.value;
    }
  }

  // 4. 构建系统提示词
  let systemPrompt = `你是 MoonTVPlus 的 AI 影视助手，专门帮助用户发现和了解影视内容。

## 你的能力
- 提供影视推荐（基于豆瓣热门榜单和TMDB数据）
- 回答影视相关问题（剧情、演员、评分等）
- 搜索最新影视资讯（如果启用了联网搜索）

## 回复要求
1. 语言风格：友好、专业、简洁
2. 信息来源：优先使用提供的数据，诚实告知数据不足
3. 推荐理由：说明为什么值得看，包括评分、类型、特色等
4. 格式清晰：使用分段、列表等让内容易读

`;

  // 添加联网搜索结果
  if (webSearchData && config?.webSearchProvider) {
    const formattedSearch = formatSearchResults(
      webSearchData,
      config.webSearchProvider
    );
    if (formattedSearch) {
      systemPrompt += `\n## 【联网搜索结果】（最新实时信息）\n${formattedSearch}\n`;
    }
  }

  // 添加豆瓣数据
  if (doubanData) {
    systemPrompt += `\n## 【豆瓣数据】（权威中文评分和信息）\n`;
    if (doubanData.list) {
      // 列表数据
      systemPrompt += `推荐列表（${doubanData.list.length}部）:\n${JSON.stringify(
        doubanData.list.slice(0, 10).map((item: any) => ({
          title: item.title,
          rating: item.rating,
          year: item.year,
          genres: item.genres,
          directors: item.directors,
          actors: item.actors,
        })),
        null,
        2
      )}\n`;
    } else if (doubanData.items) {
      // 搜索结果
      systemPrompt += `搜索结果:\n${JSON.stringify(
        doubanData.items.slice(0, 5),
        null,
        2
      )}\n`;
    } else {
      // 详情数据
      systemPrompt += JSON.stringify(
        {
          title: doubanData.title,
          rating: doubanData.rating,
          year: doubanData.year,
          genres: doubanData.genres,
          directors: doubanData.directors,
          actors: doubanData.actors,
          intro: doubanData.intro,
          reviews: doubanData.reviews?.slice(0, 2),
        },
        null,
        2
      );
      systemPrompt += '\n';
    }
  }

  // 添加TMDB数据
  if (tmdbData) {
    systemPrompt += `\n## 【TMDB数据】（国际数据和详细元信息）\n`;
    systemPrompt += JSON.stringify(
      {
        title: tmdbData.title || tmdbData.name,
        overview: tmdbData.overview,
        vote_average: tmdbData.vote_average,
        genres: tmdbData.genres,
        keywords: tmdbData.keywords,
        similar: tmdbData.similar?.slice(0, 5),
      },
      null,
      2
    );
    systemPrompt += '\n';
  }

  // 添加当前视频上下文
  if (context?.title) {
    systemPrompt += `\n## 【当前视频上下文】\n`;
    systemPrompt += `用户正在浏览: ${context.title}`;
    if (context.year) systemPrompt += ` (${context.year})`;
    if (context.currentEpisode) {
      systemPrompt += `，当前第 ${context.currentEpisode} 集`;
    }
    systemPrompt += '\n';
  }

  systemPrompt += `\n## 数据来源优先级
1. 如果有联网搜索结果，优先使用其最新信息
2. 豆瓣数据提供中文评价和评分（更适合中文用户）
3. TMDB数据更国际化，提供关键词和相似推荐
4. 如果多个数据源有冲突，以联网搜索为准
5. 如果数据不足以回答问题，诚实告知用户

现在请回答用户的问题。`;

  console.log('📝 生成的系统提示词长度:', systemPrompt.length);

  return {
    systemPrompt,
    webSearchResults: webSearchData,
    doubanData,
    tmdbData,
  };
}
