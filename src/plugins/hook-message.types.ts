import type { DiagnosticTraceContext } from "../infra/diagnostic-trace-context.js";
import type { PluginConversationBinding } from "./conversation-binding.types.js";

export type PluginHookMessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
  runId?: string;
  messageId?: string;
  senderId?: string;
  trace?: DiagnosticTraceContext;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  callDepth?: number;
};

export type PluginHookInboundClaimContext = PluginHookMessageContext & {
  parentConversationId?: string;
  senderId?: string;
  messageId?: string;
  pluginBinding?: PluginConversationBinding;
};

export type PluginHookInboundClaimEvent = {
  content: string;
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  timestamp?: number;
  channel: string;
  accountId?: string;
  conversationId?: string;
  parentConversationId?: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
  threadId?: string | number;
  messageId?: string;
  sessionKey?: string;
  runId?: string;
  trace?: DiagnosticTraceContext;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  isGroup: boolean;
  commandAuthorized?: boolean;
  wasMentioned?: boolean;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  threadId?: string | number;
  messageId?: string;
  senderId?: string;
  sessionKey?: string;
  runId?: string;
  trace?: DiagnosticTraceContext;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageSendingEvent = {
  to: string;
  content: string;
  replyToId?: string | number;
  threadId?: string | number;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageSendingResult = {
  content?: string;
  cancel?: boolean;
};

export type PluginHookMessageSentEvent = {
  to: string;
  content: string;
  success: boolean;
  messageId?: string;
  sessionKey?: string;
  runId?: string;
  trace?: DiagnosticTraceContext;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  error?: string;
};

// =============================================================================
// before_route_inbound_message hook
// =============================================================================

/**
 * Context available to the before_route_inbound_message hook.
 */
export type PluginHookBeforeRouteInboundMessageContext = PluginHookMessageContext & {
  parentConversationId?: string;
  sessionKey?: string;
};

/**
 * Event data for the before_route_inbound_message hook.
 *
 * Fired before OpenClaw resolves the canonical session key for an inbound message.
 * Allows plugins to redirect messages to a different session (e.g. bridging guild
 * channels to a main session) or suppress delivery entirely.
 */
export type PluginHookBeforeRouteInboundMessageEvent = {
  /** Channel name (e.g. "discord", "telegram") */
  channel: string;
  /** Account ID the message came through */
  accountId?: string;
  /** Raw channel-specific conversation/channel ID */
  conversationId?: string;
  /** Parent conversation/thread ID (for thread-aware channels) */
  parentConversationId?: string;
  /** Message body text */
  body: string;
  /** Chat type */
  isGroup: boolean;
  /** Raw sender ID */
  senderId?: string;
  /** Sender display name */
  senderName?: string;
  /** Original session key before any routing redirect */
  originalSessionKey: string;
};

/**
 * Result from the before_route_inbound_message hook.
 *
 * If handled with redirectSessionKey, OpenClaw uses that instead of its
 * resolved canonical session key. If handled with suppressDelivery is true,
 * the message will not be delivered to any session.
 */
export type PluginHookBeforeRouteInboundMessageResult = {
  /** Whether a plugin has decided the routing outcome */
  handled: true;
  /** Override session key — route the message to this session instead */
  redirectSessionKey?: string;
  /** Drop the message entirely without delivering it to any session */
  suppressDelivery?: boolean;
};
