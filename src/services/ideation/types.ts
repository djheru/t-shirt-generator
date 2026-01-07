/**
 * Shared types for ideation providers (Anthropic Claude, Google Gemini)
 */

export interface ResearchInsights {
  readonly trending_keywords: string[];
  readonly popular_visuals: string[];
  readonly market_context: string;
}

export interface PromptVariation {
  readonly name: string;
  readonly concept: string;
  readonly prompt: string;
}

export interface IdeationResult {
  readonly theme: string;
  readonly research_insights: ResearchInsights;
  readonly prompts: PromptVariation[];
  readonly model: string;
}

export type IdeationProvider = 'anthropic' | 'gemini';

export interface PromptIdeator {
  generatePrompts(theme: string): Promise<IdeationResult>;
  getProvider(): IdeationProvider;
  getModel(): string;
}
