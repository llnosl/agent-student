import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  searchContent,
  getPostDetail,
  getCreatorPosts,
  queryLocalData,
  listPlatforms,
} from './crawler-bridge.mjs';

const server = new McpServer({
  name: 'media-crawler',
  version: '1.0.0',
});

const platformEnum = z.enum(['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu']);

server.registerTool('search_content', {
  description: '在社交媒体平台上按关键词搜索内容。支持小红书(xhs)、抖音(dy)、快手(ks)、B站(bili)、微博(wb)、贴吧(tieba)、知乎(zhihu)。返回帖子标题、内容、作者、点赞数等信息。',
  inputSchema: {
    platform: platformEnum.describe('平台标识：xhs=小红书, dy=抖音, ks=快手, bili=B站, wb=微博, tieba=贴吧, zhihu=知乎'),
    keywords: z.string().describe('搜索关键词，多个关键词用逗号分隔'),
    max_count: z.number().optional().default(10).describe('最大爬取数量，默认10'),
    get_comments: z.boolean().optional().default(false).describe('是否同时爬取评论，默认false'),
  },
}, async ({ platform, keywords, max_count, get_comments }) => {
  try {
    const result = await searchContent({
      platform,
      keywords,
      maxCount: max_count,
      getComments: get_comments,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `搜索失败: ${err.message}` }],
      isError: true,
    };
  }
});

server.registerTool('get_post_detail', {
  description: '获取指定帖子/视频的详情和评论。通过帖子ID或URL获取完整内容。',
  inputSchema: {
    platform: platformEnum.describe('平台标识'),
    post_ids: z.string().describe('帖子/视频ID列表，多个用逗号分隔，支持完整URL或纯ID'),
    get_comments: z.boolean().optional().default(true).describe('是否爬取评论，默认true'),
  },
}, async ({ platform, post_ids, get_comments }) => {
  try {
    const result = await getPostDetail({
      platform,
      postIds: post_ids,
      getComments: get_comments,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `获取详情失败: ${err.message}` }],
      isError: true,
    };
  }
});

server.registerTool('get_creator_posts', {
  description: '获取指定创作者主页的所有帖子。输入创作者ID获取其发布的内容列表。',
  inputSchema: {
    platform: platformEnum.describe('平台标识'),
    creator_ids: z.string().describe('创作者ID列表，多个用逗号分隔，支持URL或纯ID'),
    max_count: z.number().optional().default(10).describe('最大爬取数量，默认10'),
  },
}, async ({ platform, creator_ids, max_count }) => {
  try {
    const result = await getCreatorPosts({
      platform,
      creatorIds: creator_ids,
      maxCount: max_count,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `获取创作者内容失败: ${err.message}` }],
      isError: true,
    };
  }
});

server.registerTool('query_local_data', {
  description: '查询本地已爬取的数据，无需重新爬取。可按平台和数据类型筛选。',
  inputSchema: {
    platform: platformEnum.optional().describe('平台标识，不传则查询所有平台'),
    data_type: z.enum(['contents', 'comments', 'creators']).optional().default('contents').describe('数据类型：contents=帖子内容, comments=评论, creators=创作者信息'),
    crawler_type: z.enum(['search', 'detail', 'creator']).optional().default('search').describe('爬取类型：search=搜索, detail=详情, creator=创作者'),
  },
}, async ({ platform, data_type, crawler_type }) => {
  try {
    const result = await queryLocalData({
      platform,
      dataType: data_type,
      crawlerType: crawler_type,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `查询数据失败: ${err.message}` }],
      isError: true,
    };
  }
});

server.registerTool('list_platforms', {
  description: '列出所有支持的社交媒体平台及其状态，包括是否有本地已爬取的数据。',
  inputSchema: {},
}, async () => {
  try {
    const platforms = await listPlatforms();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(platforms, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `获取平台列表失败: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
