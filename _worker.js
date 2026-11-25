const PROMPT_GENERATOR_MODEL = '@cf/google/gemma-4-26b-a4b-it';

const MODEL_REGISTRY = {
  // 公开模型（无需管理员密码）
  'flux-2-klein-4b': {
    id: '@cf/black-forest-labs/flux-2-klein-4b',
    requiresAuth: false,
    inputType: 'multipart',
    outputType: 'base64',
    supportsSize: true,
    minSize: 256,
    maxSize: 1920,
    supportsSteps: false,
  },
  'flux-1-schnell': {
    id: '@cf/black-forest-labs/flux-1-schnell',
    requiresAuth: false,
    inputType: 'json',
    outputType: 'base64',
    supportsSize: false,
    supportsSteps: true,
    defaultSteps: 4,
    maxSteps: 8,
  },
  // 高级模型（需环境变量 ADMIN_PASSWORD 鉴权）
  'flux-2-klein-9b': {
    id: '@cf/black-forest-labs/flux-2-klein-9b',
    requiresAuth: true,
    inputType: 'multipart',
    outputType: 'base64',
    supportsSize: true,
    minSize: 256,
    maxSize: 1920,
    supportsSteps: false,
  },
  'flux-2-dev': {
    id: '@cf/black-forest-labs/flux-2-dev',
    requiresAuth: true,
    inputType: 'multipart',
    outputType: 'base64',
    supportsSize: true,
    minSize: 256,
    maxSize: 1920,
    supportsSteps: true,
    defaultSteps: 20,
    maxSteps: 50,
  },
  'lucid-origin': {
    id: '@cf/leonardo/lucid-origin',
    requiresAuth: true,
    inputType: 'json',
    outputType: 'base64',
    supportsSize: true,
    minSize: 256,
    maxSize: 2500,
    supportsSteps: true,
    defaultSteps: 25,
    maxSteps: 40,
    stepsField: 'num_steps',
  },
  'phoenix-1.0': {
    id: '@cf/leonardo/phoenix-1.0',
    requiresAuth: true,
    inputType: 'json',
    outputType: 'stream',
    supportsSize: true,
    minSize: 256,
    maxSize: 2048,
    supportsSteps: true,
    defaultSteps: 25,
    maxSteps: 50,
    stepsField: 'num_steps',
    supportsNegativePrompt: true,
  },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  'Access-Control-Expose-Headers': 'X-Enhanced-Prompt',
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function timingSafeStringEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(String(a));
  const bBytes = encoder.encode(String(b));
  if (aBytes.length !== bBytes.length) return false;
  if (typeof crypto?.subtle?.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(aBytes, bBytes);
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function base64ToUint8Array(base64) {
  const cleaned = base64.includes(',') ? base64.split(',').pop() : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function detectImageMime(bytes) {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return 'image/webp';
    }
  }
  return 'image/png';
}

function extractLlmText(result) {
  const raw =
    result?.choices?.[0]?.message?.content ??
    result?.response ??
    (typeof result === 'string' ? result : '');
  return String(raw)
    .replace(/^```[\w-]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}

async function generateEnhancedPrompt(env, rawPrompt) {
  const hasInput = Boolean(rawPrompt && rawPrompt.trim());
  const systemInstruction =
    'You are an expert prompt engineer for modern text-to-image models (FLUX.2, FLUX.1, Leonardo). ' +
    'Output ONLY one vivid, natural-language English image generation prompt (60-110 words) describing subject, composition, lighting, atmosphere, color palette, and visual style. ' +
    'Do not include explanations, headings, bullet points, or quotation marks.';

  const userMessage = hasInput
    ? `Translate (if not English) and enrich the following idea into a cohesive, detailed English image prompt while staying faithful to the user's intent:\n\n${rawPrompt.trim()}`
    : 'Invent one original, visually striking scene and write a detailed English text-to-image prompt for it.';

  const result = await env.AI.run(PROMPT_GENERATOR_MODEL, {
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userMessage },
    ],
    // 关闭 Gemma 4 默认思考模式，避免 token 全消耗在 reasoning 导致 content 为空
    chat_template_kwargs: { enable_thinking: false },
    max_tokens: 512,
    temperature: 0.75,
  });

  const enhanced = extractLlmText(result);
  if (!enhanced) {
    throw new Error('Gemma 4 未返回有效提示词，请稍后重试');
  }
  return enhanced;
}

async function runModel(env, config, params) {
  const { prompt, negativePrompt, width, height, steps } = params;

  if (config.inputType === 'multipart') {
    const form = new FormData();
    form.append('prompt', prompt);
    if (config.supportsSize) {
      form.append('width', String(width));
      form.append('height', String(height));
    }
    if (config.supportsSteps && steps) {
      form.append('steps', String(steps));
    }
    const formResponse = new Response(form);
    return env.AI.run(config.id, {
      multipart: {
        body: formResponse.body,
        contentType: formResponse.headers.get('content-type'),
      },
    });
  }

  const inputs = { prompt };
  if (config.supportsSize) {
    inputs.width = width;
    inputs.height = height;
  }
  if (config.supportsSteps && steps) {
    inputs[config.stepsField || 'steps'] = steps;
  }
  if (config.supportsNegativePrompt && negativePrompt) {
    inputs.negative_prompt = negativePrompt;
  }

  return env.AI.run(config.id, inputs);
}

async function normalizeImageResponse(aiResult, extraHeaders = {}) {
  let bytes;

  if (aiResult && typeof aiResult === 'object' && typeof aiResult.image === 'string') {
    bytes = base64ToUint8Array(aiResult.image);
  } else if (aiResult instanceof ReadableStream) {
    const buffer = await new Response(aiResult).arrayBuffer();
    bytes = new Uint8Array(buffer);
  } else if (aiResult instanceof ArrayBuffer || ArrayBuffer.isView(aiResult)) {
    bytes = aiResult instanceof Uint8Array ? aiResult : new Uint8Array(aiResult);
  } else {
    throw new Error('模型返回了无法识别的响应格式');
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders,
      'Content-Type': detectImageMime(bytes),
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Cloudflare Pages 静态资源（index.html 等）交给 env.ASSETS 处理
    if (request.method === 'GET' || request.method === 'HEAD') {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    if (!env.AI) {
      return jsonResponse({ error: '服务端未配置 AI 绑定（变量名需为 AI）' }, 500);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ error: '请求体必须为合法的 JSON' }, 400);
    }

    // 可选功能：单独调用 Gemma 4 生成/润色提示词
    if (data?.action === 'enhance-prompt') {
      try {
        const rawPrompt = typeof data?.prompt === 'string' ? data.prompt : '';
        const enhancedPrompt = await generateEnhancedPrompt(env, rawPrompt);
        return jsonResponse({ prompt: enhancedPrompt, model: PROMPT_GENERATOR_MODEL }, 200);
      } catch (err) {
        return jsonResponse({ error: err?.message || 'AI 提示词生成失败，请稍后重试' }, 502);
      }
    }

    const rawPrompt = typeof data?.prompt === 'string' ? data.prompt.trim() : '';
    const modelKey = typeof data?.model === 'string' ? data.model.trim() : 'flux-2-klein-4b';
    const negativePrompt =
      typeof data?.negative_prompt === 'string' ? data.negative_prompt.trim() : '';
    const shouldEnhance = Boolean(data?.enhancePrompt);

    if (!rawPrompt) {
      return jsonResponse({ error: '请输入画面描述词（prompt）' }, 400);
    }

    const config = MODEL_REGISTRY[modelKey];
    if (!config) {
      return jsonResponse({ error: `不支持的模型：${modelKey}` }, 400);
    }

    // 鉴权检查：除 flux-2-klein-4b 和 flux-1-schnell 外均需管理员密码
    if (config.requiresAuth) {
      const adminPassword = env.ADMIN_PASSWORD;
      if (!adminPassword) {
        return jsonResponse(
          { error: '服务端尚未设置 ADMIN_PASSWORD 环境变量，高级模型暂不可用' },
          503
        );
      }

      const providedPassword =
        request.headers.get('X-Admin-Password') ||
        (typeof data?.password === 'string' ? data.password : '');

      if (!providedPassword || !timingSafeStringEqual(providedPassword, adminPassword)) {
        return jsonResponse({ error: '管理员密码错误或未填写，无权使用该模型' }, 401);
      }
    }

    const width = config.supportsSize
      ? clampInt(data?.resolution?.width ?? data?.width, config.minSize, config.maxSize, 1024)
      : undefined;
    const height = config.supportsSize
      ? clampInt(data?.resolution?.height ?? data?.height, config.minSize, config.maxSize, 1024)
      : undefined;
    const steps = config.supportsSteps
      ? clampInt(data?.steps, 1, config.maxSteps, config.defaultSteps)
      : undefined;

    try {
      let finalPrompt = rawPrompt;
      const extraHeaders = {};

      if (shouldEnhance) {
        finalPrompt = await generateEnhancedPrompt(env, rawPrompt);
        extraHeaders['X-Enhanced-Prompt'] = encodeURIComponent(finalPrompt);
      }

      const aiResult = await runModel(env, config, {
        prompt: finalPrompt,
        negativePrompt,
        width,
        height,
        steps,
      });
      return await normalizeImageResponse(aiResult, extraHeaders);
    } catch (err) {
      const message = err?.message || 'AI 绘图调用失败，请稍后重试';
      return jsonResponse({ error: message }, 502);
    }
  },
};
