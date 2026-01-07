import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "t-shirt-generator" });

// Retry configuration
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
      const errorMessage = (error as Error).message?.toLowerCase() ?? "";
      const isRetryable =
        errorMessage.includes("rate") ||
        errorMessage.includes("overloaded") ||
        errorMessage.includes("529") ||
        errorMessage.includes("503") ||
        errorMessage.includes("timeout");

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

const BRAND_SYSTEM_PROMPT = `You are a t-shirt design trend researcher and prompt engineer for Rise Wear Apparel, a print-on-demand brand targeting tall Black men with culturally authentic, empowerment-focused apparel.

## Your Task
When given a theme, niche, or concept, you will:
1. Research current trending designs, keywords, and visual styles for that theme using web search
2. Identify what's selling well and resonating with audiences
3. Craft 5 detailed image generation prompts optimized for t-shirt graphics

## Research Process
Use web search to find:
- "[theme] t-shirt designs 2025"
- "[theme] trending graphics"
- "[theme] apparel trends"
- Popular messaging/phrases associated with the theme
- Visual styles and color treatments that are performing well

## Brand Requirements (Always Apply)
- Target: Tall Black men seeking dignified, culturally authentic apparel
- Background: Always black or dark
- Color palette: Gold (primary accent), burnt orange, forest green
- Aesthetic: Modern, sophisticated, professional yet empowering
- Typography: Bold, contemporary—mix of sans-serif and modern serif
- Cultural elements: Subtle African textile patterns (kente, mudcloth) where appropriate
- Themes to weave in: Empowerment, generational wealth, legacy, resilience, dignity

## Prompt Structure Template
Each prompt should include:
1. Output format: "Design a t-shirt graphic..."
2. Theme/concept connection
3. Visual focal point (symbol, figure, typography)
4. Specific colors and how to use them
5. Typography style and suggested text/phrases
6. Background specification (black or dark)
7. Overall aesthetic direction
8. "Wearable" and "professional" quality cues

## Output Format
Return ONLY a valid JSON object with no additional text before or after:
{
  "theme": "<input theme>",
  "research_insights": {
    "trending_keywords": ["keyword1", "keyword2", ...],
    "popular_messaging": ["phrase1", "phrase2", ...],
    "visual_trends": ["trend1", "trend2", ...],
    "market_context": "<brief 1-2 sentence summary>"
  },
  "prompts": [
    {
      "name": "<short descriptive name>",
      "angle": "<what makes this variation unique>",
      "prompt": "<full detailed prompt>"
    }
  ]
}`;

export interface IdeationConfig {
  readonly apiKey: string;
  readonly model?: string;
}

export interface ResearchInsights {
  readonly trending_keywords: string[];
  readonly popular_messaging: string[];
  readonly visual_trends: string[];
  readonly market_context: string;
}

export interface PromptVariation {
  readonly name: string;
  readonly angle: string;
  readonly prompt: string;
}

export interface IdeationResult {
  readonly theme: string;
  readonly research_insights: ResearchInsights;
  readonly prompts: PromptVariation[];
  readonly model: string;
}

export interface PromptIdeator {
  generatePrompts(theme: string): Promise<IdeationResult>;
}

/**
 * Parse the JSON response from Claude, handling potential formatting issues
 */
const parseIdeationResponse = (text: string): Omit<IdeationResult, "model"> => {
  logger.info("Claude response before parsing: ", { text });
  // Try to extract JSON from the response (Claude might add extra text)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in Claude response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    theme: string;
    research_insights: ResearchInsights;
    prompts: PromptVariation[];
  };

  // Validate required fields
  if (!parsed.theme || !parsed.research_insights || !parsed.prompts) {
    throw new Error("Invalid response structure: missing required fields");
  }

  if (!Array.isArray(parsed.prompts) || parsed.prompts.length === 0) {
    throw new Error(
      "Invalid response structure: prompts must be a non-empty array"
    );
  }

  return parsed;
};

export const createPromptIdeator = (config: IdeationConfig): PromptIdeator => {
  // Using Sonnet for better research and reasoning capabilities with web search
  const { apiKey, model = "claude-sonnet-4-5-20250929" } = config;
  const client = new Anthropic({ apiKey });

  return {
    async generatePrompts(theme: string): Promise<IdeationResult> {
      logger.info("Generating prompt ideas with Claude + web search", {
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
                type: "web_search_20250305",
                name: "web_search",
              },
            ],
            messages: [
              {
                role: "user",
                content: `Research current trends and create t-shirt design prompts for this theme: "${theme}"`,
              },
            ],
          });
        }, "Claude prompt ideation with web search");

        // Extract text content from response (may have multiple blocks due to tool use)
        const textBlocks = response.content.filter(
          (block) => block.type === "text"
        );
        if (textBlocks.length === 0) {
          throw new Error("No text content in Claude response");
        }

        // Find the block containing JSON (usually the last text block)
        let parsedResult: Omit<IdeationResult, "model"> | null = null;
        let lastParseError: Error | null = null;

        for (const block of textBlocks.reverse()) {
          if (block.type === "text") {
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
            new Error("Could not parse JSON response from any text block")
          );
        }

        logger.info("Prompt ideation complete", {
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
        logger.error("Failed to generate prompts with Claude", {
          error,
          theme,
          model,
        });
        throw error;
      }
    },
  };
};
