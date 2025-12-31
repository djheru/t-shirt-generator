import { z } from 'zod';

export interface SlackSlashCommandPayload {
  readonly token: string;
  readonly team_id: string;
  readonly team_domain: string;
  readonly channel_id: string;
  readonly channel_name: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly command: string;
  readonly text: string;
  readonly response_url: string;
  readonly trigger_id: string;
  readonly api_app_id: string;
}

export interface SlackInteractionPayload {
  readonly type: 'block_actions' | 'view_submission' | 'view_closed';
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly name: string;
    readonly team_id: string;
  };
  readonly channel: {
    readonly id: string;
    readonly name: string;
  };
  readonly message: {
    readonly ts: string;
    readonly blocks: unknown[];
  };
  readonly response_url: string;
  readonly actions: SlackAction[];
  readonly trigger_id: string;
  readonly api_app_id: string;
}

export interface SlackAction {
  readonly action_id: string;
  readonly block_id: string;
  readonly value: string;
  readonly type: string;
  readonly action_ts: string;
}

export const SlackSlashCommandSchema = z.object({
  token: z.string(),
  team_id: z.string(),
  team_domain: z.string(),
  channel_id: z.string(),
  channel_name: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  command: z.string(),
  text: z.string(),
  response_url: z.string().url(),
  trigger_id: z.string(),
  api_app_id: z.string(),
});

export const SlackInteractionSchema = z.object({
  type: z.enum(['block_actions', 'view_submission', 'view_closed']),
  user: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string(),
    team_id: z.string(),
  }),
  channel: z.object({
    id: z.string(),
    name: z.string(),
  }),
  message: z.object({
    ts: z.string(),
    blocks: z.array(z.unknown()),
  }),
  response_url: z.string().url(),
  actions: z.array(z.object({
    action_id: z.string(),
    block_id: z.string(),
    value: z.string(),
    type: z.string(),
    action_ts: z.string(),
  })),
  trigger_id: z.string(),
  api_app_id: z.string(),
});

export interface SlackResponse {
  readonly response_type?: 'ephemeral' | 'in_channel';
  readonly text?: string;
  readonly blocks?: SlackBlock[];
  readonly replace_original?: boolean;
  readonly delete_original?: boolean;
}

export type SlackBlock =
  | SlackSectionBlock
  | SlackImageBlock
  | SlackActionsBlock
  | SlackDividerBlock
  | SlackContextBlock;

export interface SlackSectionBlock {
  readonly type: 'section';
  readonly block_id?: string;
  readonly text: {
    readonly type: 'mrkdwn' | 'plain_text';
    readonly text: string;
  };
  readonly accessory?: SlackBlockElement;
}

export interface SlackImageBlock {
  readonly type: 'image';
  readonly block_id?: string;
  readonly image_url: string;
  readonly alt_text: string;
  readonly title?: {
    readonly type: 'plain_text';
    readonly text: string;
  };
}

export interface SlackActionsBlock {
  readonly type: 'actions';
  readonly block_id?: string;
  readonly elements: SlackBlockElement[];
}

export interface SlackDividerBlock {
  readonly type: 'divider';
}

export interface SlackContextBlock {
  readonly type: 'context';
  readonly block_id?: string;
  readonly elements: Array<{
    readonly type: 'mrkdwn' | 'plain_text' | 'image';
    readonly text?: string;
    readonly image_url?: string;
    readonly alt_text?: string;
  }>;
}

export interface SlackBlockElement {
  readonly type: 'button';
  readonly text: {
    readonly type: 'plain_text';
    readonly text: string;
    readonly emoji?: boolean;
  };
  readonly action_id: string;
  readonly value: string;
  readonly style?: 'primary' | 'danger';
}

export interface SlackMessageUpdate {
  readonly channel: string;
  readonly ts: string;
  readonly blocks?: SlackBlock[];
  readonly text?: string;
}
