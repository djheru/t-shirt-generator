import type {
  SlackBlock,
  SlackResponse,
  SlackActionsBlock,
  SlackSectionBlock,
  SlackImageBlock,
  SlackDividerBlock,
  SlackContextBlock,
} from '../../types/slack.types';
import type { ResearchInsights, PromptVariation } from '../anthropic';

export interface GeneratedImageInfo {
  readonly imageId: string;
  readonly imageUrl: string;
  readonly index: number;
}

export const buildGeneratingMessage = (prompt: string): SlackResponse => ({
  response_type: 'ephemeral',
  text: `Generating 3 images for your prompt...\n\n*Prompt:* ${prompt}\n\nThis may take 30-60 seconds.`,
});

export const buildChannelRestrictionMessage = (): SlackResponse => ({
  response_type: 'ephemeral',
  text: 'This command is only available in the designated design channel.',
});

export const buildErrorMessage = (message: string): SlackResponse => ({
  response_type: 'ephemeral',
  text: `An error occurred: ${message}`,
});

export const buildEmptyPromptMessage = (): SlackResponse => ({
  response_type: 'ephemeral',
  text: 'Please provide a prompt. Usage: `/generate <your prompt>`',
});

export const buildGeneratedImagesMessage = (
  prompt: string,
  images: GeneratedImageInfo[],
  requestId: string
): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  // Header section
  const headerBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Generated Images*\n*Prompt:* ${prompt}`,
    },
  };
  blocks.push(headerBlock);

  // Add each image with its action buttons
  for (const image of images) {
    // Image block
    const imageBlock: SlackImageBlock = {
      type: 'image',
      block_id: `image_${image.imageId}`,
      image_url: image.imageUrl,
      alt_text: `Generated image ${image.index + 1}`,
      title: {
        type: 'plain_text',
        text: `Image ${image.index + 1}`,
      },
    };
    blocks.push(imageBlock);

    // Action buttons for this image
    // Value format: imageId|requestId for easy parsing in interaction handler
    const actionValue = `${image.imageId}|${requestId}`;
    const actionsBlock: SlackActionsBlock = {
      type: 'actions',
      block_id: `actions_${image.imageId}`,
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Keep',
            emoji: true,
          },
          style: 'primary',
          action_id: 'keep_image',
          value: actionValue,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Discard',
            emoji: true,
          },
          style: 'danger',
          action_id: 'discard_image',
          value: actionValue,
        },
      ],
    };
    blocks.push(actionsBlock);
  }

  // Divider before batch actions
  const divider: SlackDividerBlock = {
    type: 'divider',
  };
  blocks.push(divider);

  // Batch action buttons
  const batchActionsBlock: SlackActionsBlock = {
    type: 'actions',
    block_id: 'batch_actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Keep All',
          emoji: true,
        },
        style: 'primary',
        action_id: 'keep_all',
        value: requestId,
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Discard All',
          emoji: true,
        },
        action_id: 'discard_all',
        value: requestId,
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Regenerate All',
          emoji: true,
        },
        action_id: 'regenerate_all',
        value: requestId,
      },
    ],
  };
  blocks.push(batchActionsBlock);

  // Context with request ID for reference
  const contextBlock: SlackContextBlock = {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Request ID: \`${requestId}\``,
      },
    ],
  };
  blocks.push(contextBlock);

  return blocks;
};

export const buildKeptImageMessage = (
  presignedUrl: string,
  expiryDays: number
): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  const sectionBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Image saved!*\n\nDownload link (expires in ${expiryDays} days):\n<${presignedUrl}|Download Image>`,
    },
  };
  blocks.push(sectionBlock);

  return blocks;
};

export const buildDiscardedImageMessage = (): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  const sectionBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Image discarded.*',
    },
  };
  blocks.push(sectionBlock);

  return blocks;
};

export const buildRegeneratingMessage = (prompt: string): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  const sectionBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Regenerating images...*\n\n*Prompt:* ${prompt}\n\nThis may take 30-60 seconds.`,
    },
  };
  blocks.push(sectionBlock);

  return blocks;
};

export const buildAllKeptMessage = (
  presignedUrls: Array<{ index: number; url: string }>,
  expiryDays: number
): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  const headerBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*All images saved!*\n\nDownload links (expire in ${expiryDays} days):`,
    },
  };
  blocks.push(headerBlock);

  // Add each download link
  const links = presignedUrls
    .map(({ index, url }) => `${index + 1}. <${url}|Download Image ${index + 1}>`)
    .join('\n');

  const linksBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: links,
    },
  };
  blocks.push(linksBlock);

  return blocks;
};

export const buildAllDiscardedMessage = (): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  const sectionBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*All images discarded.*',
    },
  };
  blocks.push(sectionBlock);

  return blocks;
};

export const buildGenerationFailedMessage = (error: string): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  const sectionBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Image generation failed*\n\nError: ${error}\n\nPlease try again with a different prompt.`,
    },
  };
  blocks.push(sectionBlock);

  return blocks;
};

export const updateImageStatus = (
  blocks: SlackBlock[],
  imageId: string,
  newStatus: 'kept' | 'discarded'
): SlackBlock[] => {
  return blocks.map((block) => {
    // Find the actions block for this image and replace it with a status message
    if (block.type === 'actions' && 'block_id' in block && block.block_id === `actions_${imageId}`) {
      const statusBlock: SlackSectionBlock = {
        type: 'section',
        block_id: `status_${imageId}`,
        text: {
          type: 'mrkdwn',
          text: newStatus === 'kept' ? '*Kept*' : '*Discarded*',
        },
      };
      return statusBlock;
    }
    return block;
  });
};

export interface ImageWithStatus {
  readonly imageId: string;
  readonly imageUrl: string;
  readonly status: 'generated' | 'kept' | 'discarded';
  readonly downloadUrl?: string;
}

/**
 * Build an updated message showing current status of all images.
 * Images with 'generated' status show with action buttons.
 * Images with 'kept' status show with download link.
 * Images with 'discarded' status are not shown.
 */
export const buildUpdatedImagesMessage = (
  prompt: string,
  images: ImageWithStatus[],
  requestId: string
): SlackBlock[] => {
  const blocks: SlackBlock[] = [];

  // Header section
  const headerBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Generated Images*\n*Prompt:* ${prompt}`,
    },
  };
  blocks.push(headerBlock);

  // Filter out discarded images
  const visibleImages = images.filter(img => img.status !== 'discarded');
  const activeImages = images.filter(img => img.status === 'generated');

  if (visibleImages.length === 0) {
    // All images were discarded
    const emptyBlock: SlackSectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_All images have been discarded._',
      },
    };
    blocks.push(emptyBlock);
    return blocks;
  }

  // Add each visible image
  for (let i = 0; i < visibleImages.length; i++) {
    const image = visibleImages[i];

    // Image block
    const imageBlock: SlackImageBlock = {
      type: 'image',
      block_id: `image_${image.imageId}`,
      image_url: image.imageUrl,
      alt_text: `Generated image ${i + 1}`,
      title: {
        type: 'plain_text',
        text: `Image ${i + 1}`,
      },
    };
    blocks.push(imageBlock);

    if (image.status === 'generated') {
      // Action buttons for active images
      const actionValue = `${image.imageId}|${requestId}`;
      const actionsBlock: SlackActionsBlock = {
        type: 'actions',
        block_id: `actions_${image.imageId}`,
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Keep',
              emoji: true,
            },
            style: 'primary',
            action_id: 'keep_image',
            value: actionValue,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Discard',
              emoji: true,
            },
            style: 'danger',
            action_id: 'discard_image',
            value: actionValue,
          },
        ],
      };
      blocks.push(actionsBlock);
    } else if (image.status === 'kept') {
      // Status indicator for kept images
      const statusBlock: SlackSectionBlock = {
        type: 'section',
        block_id: `status_${image.imageId}`,
        text: {
          type: 'mrkdwn',
          text: image.downloadUrl
            ? `✓ *Kept* - <${image.downloadUrl}|Download Image>`
            : '✓ *Kept*',
        },
      };
      blocks.push(statusBlock);
    }
  }

  // Only show batch actions if there are still active images
  if (activeImages.length > 0) {
    // Divider before batch actions
    const divider: SlackDividerBlock = {
      type: 'divider',
    };
    blocks.push(divider);

    // Batch action buttons
    const batchActionsBlock: SlackActionsBlock = {
      type: 'actions',
      block_id: 'batch_actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Keep All',
            emoji: true,
          },
          style: 'primary',
          action_id: 'keep_all',
          value: requestId,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Discard All',
            emoji: true,
          },
          action_id: 'discard_all',
          value: requestId,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Regenerate All',
            emoji: true,
          },
          action_id: 'regenerate_all',
          value: requestId,
        },
      ],
    };
    blocks.push(batchActionsBlock);
  }

  // Context with request ID for reference
  const contextBlock: SlackContextBlock = {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Request ID: \`${requestId}\``,
      },
    ],
  };
  blocks.push(contextBlock);

  return blocks;
};

// Ideation message builders

export const buildIdeatingMessage = (theme: string): SlackResponse => ({
  response_type: 'ephemeral',
  text: `Researching trends and generating creative prompts for "${theme}"...\n\nThis may take 15-30 seconds as we search for current trends.`,
});

export const buildEmptyThemeMessage = (): SlackResponse => ({
  response_type: 'ephemeral',
  text: 'Please provide theme keywords. Usage: `/ideate <theme keywords>`\n\nExample: `/ideate retro gaming 80s`',
});

export interface IdeationResultParams {
  readonly theme: string;
  readonly research_insights: ResearchInsights;
  readonly prompts: PromptVariation[];
}

export const buildIdeationResultMessage = (
  result: IdeationResultParams
): SlackBlock[] => {
  const { theme, research_insights, prompts } = result;
  const blocks: SlackBlock[] = [];

  // Header section
  const headerBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Rise Wear Design Prompts: "${theme}"*`,
    },
  };
  blocks.push(headerBlock);

  // Divider
  const divider: SlackDividerBlock = {
    type: 'divider',
  };
  blocks.push(divider);

  // Research insights section
  const insightsHeader: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*📊 Market Research Insights*',
    },
  };
  blocks.push(insightsHeader);

  // Market context
  const contextBlock: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `_${research_insights.market_context}_`,
    },
  };
  blocks.push(contextBlock);

  // Trending keywords
  if (research_insights.trending_keywords.length > 0) {
    const keywordsBlock: SlackSectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Trending Keywords:* ${research_insights.trending_keywords.slice(0, 8).join(' • ')}`,
      },
    };
    blocks.push(keywordsBlock);
  }

  // Popular visuals
  if (research_insights.popular_visuals.length > 0) {
    const visualsBlock: SlackSectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Visual Trends:* ${research_insights.popular_visuals.slice(0, 5).join(' • ')}`,
      },
    };
    blocks.push(visualsBlock);
  }

  blocks.push(divider);

  // Prompts header
  const promptsHeader: SlackSectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*🎨 Design Prompts (${prompts.length})*\n_Use with_ \`/generate <prompt>\``,
    },
  };
  blocks.push(promptsHeader);

  // Each prompt with name, concept, and copyable prompt
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];

    // Prompt header with name and concept
    const promptHeaderBlock: SlackSectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${i + 1}. ${p.name}*\n_${p.concept}_`,
      },
    };
    blocks.push(promptHeaderBlock);

    // The actual prompt in a code block for easy copying
    const promptTextBlock: SlackSectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`\`\`${p.prompt}\`\`\``,
      },
    };
    blocks.push(promptTextBlock);
  }

  return blocks;
};

export const buildIdeationFailedMessage = (error: string): SlackResponse => ({
  response_type: 'ephemeral',
  text: `Failed to generate prompts: ${error}\n\nPlease try again.`,
});