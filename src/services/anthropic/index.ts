/**
 * Re-export from new ideation module for backwards compatibility.
 * Prefer importing directly from '../ideation' for new code.
 */
export {
  createAnthropicIdeator as createPromptIdeator,
  type AnthropicIdeationConfig as IdeationConfig,
  type IdeationResult,
  type PromptIdeator,
  type ResearchInsights,
  type PromptVariation,
} from '../ideation';
