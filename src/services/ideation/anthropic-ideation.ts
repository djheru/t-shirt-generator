import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@aws-lambda-powertools/logger';
import type {
  IdeationResult,
  ResearchInsights,
  PromptVariation,
  PromptIdeator,
} from './types';

const logger = new Logger({ serviceName: 't-shirt-generator' });

// Retry configuration
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const withRetry = async <T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check for rate limiting / overload errors
      const errorMessage = (error as Error).message?.toLowerCase() ?? '';
      const isRetryable =
        errorMessage.includes('rate') ||
        errorMessage.includes('overloaded') ||
        errorMessage.includes('529') ||
        errorMessage.includes('503') ||
        errorMessage.includes('timeout');

      if (!isRetryable) {
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        const baseDelay = Math.min(
          BASE_DELAY_MS * Math.pow(2, attempt),
          MAX_DELAY_MS
        );
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;

        logger.warn(
          `${operationName} rate limited, retrying in ${Math.round(delay)}ms`,
          {
            attempt: attempt + 1,
            maxRetries: MAX_RETRIES,
            delay: Math.round(delay),
          }
        );

        await sleep(delay);
      }
    }
  }

  logger.error(`${operationName} failed after ${MAX_RETRIES} retries`, {
    error: lastError,
  });
  throw lastError;
};

const BRAND_SYSTEM_PROMPT = `You are a t-shirt design prompt engineer for Rise Wear Apparel, a print-on-demand brand targeting tall Black men with culturally authentic, empowerment-focused apparel.

## Your Task
Research current trends for the given theme, then craft 5 simple, effective image generation prompts.

## Research Process
Use web search to find:
- "[theme] t-shirt designs 2025"
- "[theme] graphic design trends"
- Visual styles selling well for this theme

## CRITICAL: What Makes Good AI Image Prompts

### DO:
- ONE single focal point per design (a symbol, icon, or figure)
- Simple, bold compositions with negative space
- Specify concrete art styles: "flat vector illustration", "bold graphic", "screen print style", "minimalist icon", "geometric art"
- Limit to 2-3 colors maximum
- Use "isolated on solid black background" or "centered on dark background"
- Describe visual elements concretely (shapes, objects, symbols)

### DON'T:
- NO TEXT OR TYPOGRAPHY in prompts - AI cannot render text well
- NO multiple overlapping elements or complex layering
- NO abstract concepts like "empowering" or "dignified" - these don't translate visually
- NO specific positioning like "45-degree angle" or "arcing across the top"
- NO multiple patterns competing (pick ONE pattern style if any)
- NO borders, frames, or edge decorations

## Brand Style Guide
- Background: Solid black or very dark
- Colors: Gold/metallic gold (primary), burnt orange, forest green (pick 1-2 per design)
- Style: Modern, clean, bold, premium-looking
- Cultural touches: Subtle geometric patterns inspired by African textiles (use sparingly)
- Subject matter: Symbols of strength, heritage, achievement, legacy

## Prompt Formula
"[Art style] of [single subject/symbol], [1-2 colors] on black background, [one style modifier]"

### Good Example Prompts:
- "Flat vector illustration of a roaring lion head in metallic gold, centered on solid black background, bold graphic style, high contrast"
- "Minimalist geometric crown icon in gold and burnt orange, isolated on black background, screen print style"
- "Bold graphic silhouette of a baobab tree in forest green with gold accents, simple composition on dark background"

### Bad Example (what NOT to generate):
- "Design featuring a golden saxophone at 45-degrees with Art Deco patterns, concentric circles in burnt orange, text reading 'JAZZ MASTERS' arcing above, kente border along bottom..." (TOO COMPLEX)

## Output Format
Return ONLY valid JSON:
{
  "theme": "<input theme>",
  "research_insights": {
    "trending_keywords": ["keyword1", "keyword2", ...],
    "popular_visuals": ["visual trend 1", "visual trend 2", ...],
    "market_context": "<1-2 sentence summary>"
  },
  "prompts": [
    {
      "name": "<short name>",
      "concept": "<what this design represents>",
      "prompt": "<simple, focused prompt following the formula above>"
    }
  ]
}`;

export interface AnthropicIdeationConfig {
  readonly apiKey: string;
  readonly model?: string;
}

/**
 * Parse the JSON response from Claude, handling potential formatting issues
 */
const parseIdeationResponse = (text: string): Omit<IdeationResult, 'model'> => {
  logger.debug('Claude response before parsing', { textLength: text.length });

  // Try to extract JSON from the response (Claude might add extra text)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in Claude response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    theme: string;
    research_insights: ResearchInsights;
    prompts: PromptVariation[];
  };

  // Validate required fields
  if (!parsed.theme || !parsed.research_insights || !parsed.prompts) {
    throw new Error('Invalid response structure: missing required fields');
  }

  if (!Array.isArray(parsed.prompts) || parsed.prompts.length === 0) {
    throw new Error(
      'Invalid response structure: prompts must be a non-empty array'
    );
  }

  return parsed;
};

export const createAnthropicIdeator = (
  config: AnthropicIdeationConfig
): PromptIdeator => {
  // Using Sonnet 4.5 for better research and reasoning capabilities with web search
  const { apiKey, model = 'claude-sonnet-4-5-20250929' } = config;
  const client = new Anthropic({ apiKey });

  return {
    getProvider(): 'anthropic' {
      return 'anthropic';
    },

    getModel(): string {
      return model;
    },

    async generatePrompts(theme: string): Promise<IdeationResult> {
      logger.info('Generating prompt ideas with Claude + web search', {
        theme,
        model,
        themeLength: theme.length,
      });

      try {
        const response = await withRetry(async () => {
          return client.messages.create({
            model,
            max_tokens: 4096,
            system: BRAND_SYSTEM_PROMPT,
            tools: [
              {
                type: 'web_search_20250305',
                name: 'web_search',
              },
            ],
            messages: [
              {
                role: 'user',
                content: `Research current trends and create t-shirt design prompts for this theme: "${theme}"`,
              },
            ],
          });
        }, 'Claude prompt ideation with web search');

        // Extract text content from response (may have multiple blocks due to tool use)
        const textBlocks = response.content.filter(
          (block) => block.type === 'text'
        );
        if (textBlocks.length === 0) {
          throw new Error('No text content in Claude response');
        }

        // Find the block containing JSON (usually the last text block)
        let parsedResult: Omit<IdeationResult, 'model'> | null = null;
        let lastParseError: Error | null = null;

        for (const block of textBlocks.reverse()) {
          if (block.type === 'text') {
            try {
              parsedResult = parseIdeationResponse(block.text);
              break;
            } catch (err) {
              // Save the error but try next block
              lastParseError = err as Error;
              continue;
            }
          }
        }

        if (!parsedResult) {
          // Throw the specific parsing error if we have one
          throw (
            lastParseError ??
            new Error('Could not parse JSON response from any text block')
          );
        }

        logger.info('Prompt ideation complete', {
          theme,
          promptCount: parsedResult.prompts.length,
          trendingKeywords:
            parsedResult.research_insights.trending_keywords.length,
          model,
        });

        return {
          ...parsedResult,
          model,
        };
      } catch (error) {
        logger.error('Failed to generate prompts with Claude', {
          error,
          theme,
          model,
        });
        throw error;
      }
    },
  };
};
