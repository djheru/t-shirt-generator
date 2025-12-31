import type {
  SlackBlock,
  SlackResponse,
  SlackActionsBlock,
  SlackSectionBlock,
  SlackImageBlock,
  SlackDividerBlock,
  SlackContextBlock,
} from '../../types/slack.types';

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
