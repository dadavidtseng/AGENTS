/**
 * ability-vision — Visual Analysis via Model Manager
 *
 * Provides image understanding tools: analyze images from file paths or URLs,
 * extract text (OCR), compare images, and describe UI screenshots.
 * Routes all LLM calls through the model-manager gateway (OpenAI-compatible).
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import dotenv from 'dotenv';
import { KadiClient, z } from '@kadi.build/core';

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const MODEL_MANAGER_BASE_URL = (
  process.env.MODEL_MANAGER_BASE_URL || 'http://localhost:3000'
).replace(/\/$/, '');
const MODEL_MANAGER_API_KEY = process.env.MODEL_MANAGER_API_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-5-mini';
const MAX_TOKENS = parseInt(process.env.VISION_MAX_TOKENS || '4096', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.VISION_TIMEOUT_MS || '90000', 10);

// HTTPS agent for self-signed certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ============================================================================
// KadiClient
// ============================================================================

const brokerConfig: { url: string; networks?: string[] } = {
  url: process.env.KADI_BROKER_URL || 'ws://localhost:8080/kadi',
};
if (process.env.KADI_NETWORK) {
  brokerConfig.networks = [process.env.KADI_NETWORK];
}

const client = new KadiClient({
  name: 'ability-vision',
  brokers: { default: brokerConfig },
});

// ============================================================================
// Image Loading Utilities
// ============================================================================

/** Supported image MIME types */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/** Convert a local file path to a base64 data URL */
function fileToDataUrl(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_MAP[ext];
  if (!mime) {
    throw new Error(`Unsupported image format: ${ext}`);
  }
  const data = fs.readFileSync(resolved);
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** Resolve image source to an image_url for the API */
function resolveImageUrl(source: string): string {
  if (source.startsWith('data:')) return source;
  if (source.startsWith('http://') || source.startsWith('https://')) return source;
  return fileToDataUrl(source);
}

// ============================================================================
// Model Manager API
// ============================================================================

interface VisionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>;
}

async function callVision(
  messages: VisionMessage[],
  model?: string,
): Promise<string> {
  if (!MODEL_MANAGER_API_KEY) {
    throw new Error('MODEL_MANAGER_API_KEY is not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${MODEL_MANAGER_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MODEL_MANAGER_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || VISION_MODEL,
        messages,
        max_completion_tokens: MAX_TOKENS,
        stream: false,
      }),
      signal: controller.signal,
      // @ts-ignore — Node fetch accepts agent
      agent: httpsAgent,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Model manager returned ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (content === null || content === undefined) {
      throw new Error('No content in model manager response');
    }
    return content;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Vision request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

// ============================================================================
// Tools
// ============================================================================

/** Analyze an image with a custom prompt */
client.registerTool({
  name: 'vision_analyze',
  description: 'Analyze an image with a custom prompt. Accepts file path or URL.',
  input: z.object({
    image: z.string().describe('Image file path or URL'),
    prompt: z.string().describe('Analysis prompt / question about the image'),
    detail: z.enum(['auto', 'low', 'high']).optional().describe('Image detail level (default: auto)'),
  }),
}, async (params) => {
  const imageUrl = resolveImageUrl(params.image);
  const result = await callVision([
    {
      role: 'user',
      content: [
        { type: 'text', text: params.prompt },
        { type: 'image_url', image_url: { url: imageUrl, detail: params.detail || 'auto' } },
      ],
    },
  ]);
  return { analysis: result, image: params.image, model: VISION_MODEL };
});

/** Extract text (OCR) from an image */
client.registerTool({
  name: 'vision_ocr',
  description: 'Extract all visible text from an image (OCR). Returns structured text content.',
  input: z.object({
    image: z.string().describe('Image file path or URL'),
    language: z.string().optional().describe('Expected language hint (e.g. "en", "zh", "ja")'),
  }),
}, async (params) => {
  const imageUrl = resolveImageUrl(params.image);
  const langHint = params.language ? ` The text is primarily in ${params.language}.` : '';
  const result = await callVision([
    {
      role: 'system',
      content: 'You are an OCR specialist. Extract ALL visible text from the image exactly as it appears. Preserve layout structure where possible. Return only the extracted text, no commentary.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Extract all text from this image.${langHint}` },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      ],
    },
  ]);
  return { text: result, image: params.image };
});

/** Describe a UI screenshot */
client.registerTool({
  name: 'vision_describe_ui',
  description: 'Describe a UI screenshot — layout, components, interactions, accessibility issues.',
  input: z.object({
    image: z.string().describe('Screenshot file path or URL'),
    focus: z.string().optional().describe('Specific UI aspect to focus on (e.g. "navigation", "form validation")'),
  }),
}, async (params) => {
  const imageUrl = resolveImageUrl(params.image);
  const focusHint = params.focus ? ` Focus especially on: ${params.focus}.` : '';
  const result = await callVision([
    {
      role: 'system',
      content: 'You are a UI/UX analyst. Describe the interface in detail: layout structure, components, visual hierarchy, interactive elements, and potential accessibility concerns.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Describe this UI screenshot.${focusHint}` },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      ],
    },
  ]);
  return { description: result, image: params.image };
});

/** Compare two images */
client.registerTool({
  name: 'vision_compare',
  description: 'Compare two images and describe differences, similarities, or changes.',
  input: z.object({
    image_a: z.string().describe('First image file path or URL'),
    image_b: z.string().describe('Second image file path or URL'),
    prompt: z.string().optional().describe('Comparison focus (default: general comparison)'),
  }),
}, async (params) => {
  const urlA = resolveImageUrl(params.image_a);
  const urlB = resolveImageUrl(params.image_b);
  const prompt = params.prompt || 'Compare these two images. Describe the key differences and similarities.';
  const result = await callVision([
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: urlA, detail: 'auto' } },
        { type: 'image_url', image_url: { url: urlB, detail: 'auto' } },
      ],
    },
  ]);
  return { comparison: result, image_a: params.image_a, image_b: params.image_b };
});

/** Simple image description */
client.registerTool({
  name: 'vision_describe',
  description: 'Generate a concise description of an image — content, objects, scene, mood.',
  input: z.object({
    image: z.string().describe('Image file path or URL'),
    style: z.enum(['brief', 'detailed', 'alt-text']).optional().describe('Description style (default: detailed)'),
  }),
}, async (params) => {
  const imageUrl = resolveImageUrl(params.image);
  const styleMap: Record<string, string> = {
    brief: 'Describe this image in 1-2 sentences.',
    detailed: 'Provide a detailed description of this image including objects, scene, colors, composition, and mood.',
    'alt-text': 'Write concise, descriptive alt text for this image suitable for screen readers. Be specific and functional.',
  };
  const prompt = styleMap[params.style || 'detailed'];
  const result = await callVision([
    { role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'auto' } },
    ]},
  ]);
  return { description: result, image: params.image, style: params.style || 'detailed' };
});

// ============================================================================
// Startup
// ============================================================================

const mode = (process.env.KADI_MODE || process.argv[2] || 'stdio') as 'stdio' | 'broker';
const toolCount = 5;

console.log(`[ability-vision] Provider: model-manager (${VISION_MODEL})`);
console.log(`[ability-vision] Starting in ${mode} mode...`);
console.log(`[ability-vision] ${toolCount} tools registered`);

client.serve(mode);
