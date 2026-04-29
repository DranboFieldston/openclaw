import type { MsgContext } from "../auto-reply/templating.js";
import type { GroupKeyResolution, ProxyBinding } from "../config/sessions/types.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import type { InboundLastRouteUpdate } from "./session.types.js";
export type { InboundLastRouteUpdate, RecordInboundSession } from "./session.types.js";

/**
 * Parse a session key to extract the bot user ID.
 * Format: "agent:<agentId>:<channel>:<userId>" or similar patterns.
 * Returns the last path segment if it looks like a user ID (numeric).
 */
function extractBotUserId(sessionKey: string): string | null {
  // Try common patterns: agent:<botId>:channel:id, or channel:id
  const segments = sessionKey.split(":");
  // Last segment is typically the user/bot identifier
  const last = segments[segments.length - 1];
  if (/^\d{15,20}$/.test(last)) return last;
  return null;
}

/**
 * Check if a Discord message contains a mention of a specific bot.
 * Discord mention formats: <@ID>, <@!ID>
 */
function containsBotMention(message: string, botUserId: string | null): boolean {
  if (!botUserId) return true; // no bot ID to check against → forward anyway
  const pattern = new RegExp(`<@[!]?${botUserId}>`, "i");
  return pattern.test(message);
}

/**
 * Determine whether a bridged message should be forwarded based on proxy mode.
 * - "broadcast": always forward
 * - "mention-only": only forward if bot was mentioned (via WasMentioned flag or content parsing)
 */
function shouldForwardProxiedMessage(params: {
  mode: "broadcast" | "mention-only";
  wasMentioned: boolean | undefined;
  messageText: string;
  proxySessionKey: string;
  targetSessionKey: string;
}): boolean {
  if (params.mode === "broadcast") return true;

  // Mention-only mode: check if bot was mentioned
  if (params.wasMentioned === true) return true;

  // Fallback: parse message content for Discord mention patterns
  const targetBotId = extractBotUserId(params.targetSessionKey);
  if (targetBotId && containsBotMention(params.messageText, targetBotId)) return true;

  const proxyBotId = extractBotUserId(params.proxySessionKey);
  if (proxyBotId && containsBotMention(params.messageText, proxyBotId)) return true;

  return false;
}

let inboundSessionRuntimePromise: Promise<
  typeof import("../config/sessions/inbound.runtime.js")
> | null = null;

function loadInboundSessionRuntime() {
  inboundSessionRuntimePromise ??= import("../config/sessions/inbound.runtime.js");
  return inboundSessionRuntimePromise;
}

function shouldSkipPinnedMainDmRouteUpdate(
  pin: InboundLastRouteUpdate["mainDmOwnerPin"] | undefined,
): boolean {
  if (!pin) {
    return false;
  }
  const owner = normalizeLowercaseStringOrEmpty(pin.ownerRecipient);
  const sender = normalizeLowercaseStringOrEmpty(pin.senderRecipient);
  if (!owner || !sender || owner === sender) {
    return false;
  }
  pin.onSkip?.({ ownerRecipient: pin.ownerRecipient, senderRecipient: pin.senderRecipient });
  return true;
}

export async function recordInboundSession(params: {
  storePath: string;
  sessionKey: string;
  ctx: MsgContext;
  groupResolution?: GroupKeyResolution | null;
  createIfMissing?: boolean;
  updateLastRoute?: InboundLastRouteUpdate;
  onRecordError: (err: unknown) => void;
  trackSessionMetaTask?: (task: Promise<unknown>) => void;
}): Promise<void> {
  const { storePath, sessionKey, ctx, groupResolution, createIfMissing } = params;
  let canonicalSessionKey = normalizeLowercaseStringOrEmpty(sessionKey);

  // Proxy binding resolution: redirect to target session key if active proxy binding exists
  const { loadSessionStore } = await import("../config/sessions/store-load.js");
  const { resolveProxyBindingFromStoreOrConfig } = await import("../gateway/session-utils.js");
  const { loadConfig } = await import("../config/config.js");
  const store = loadSessionStore(storePath);
  const cfg = loadConfig();
  const proxyBinding = resolveProxyBindingFromStoreOrConfig(cfg, store, canonicalSessionKey);
  if (proxyBinding) {
    const targetKey = normalizeLowercaseStringOrEmpty(proxyBinding.targetSessionKey);
    if (targetKey && targetKey !== canonicalSessionKey) {
      const messageText = ctx.Body ?? ctx.BodyForAgent ?? "";

      // Phase 3: Smart routing — respect broadcast vs mention-only mode
      if (
        shouldForwardProxiedMessage({
          mode: proxyBinding.mode ?? "broadcast",
          wasMentioned: ctx.WasMentioned,
          messageText,
          proxySessionKey: sessionKey,
          targetSessionKey: proxyBinding.targetSessionKey,
        })
      ) {
        canonicalSessionKey = targetKey;
        // Update ctx.SessionKey so downstream dispatch uses the target session
        if (ctx.SessionKey !== undefined) {
          ctx.SessionKey = canonicalSessionKey;
        }

        // Inject bridged message format directly into the target session transcript
        const { appendBridgeMessageToSessionTranscript } =
          await import("../config/sessions/transcript.js");
        // Determine the channelId
        // Fallback extraction from original session key if format is known: "discord:channel:123"
        const channelIdParts = sessionKey.split(":");
        const extChannelId =
          channelIdParts.length >= 3 ? channelIdParts.slice(2).join(":") : sessionKey;

        void appendBridgeMessageToSessionTranscript({
          sessionKey: targetKey,
          messageText,
          sourceSessionKey: sessionKey,
          channelId: extChannelId,
          agentId: proxyBinding.ownerAgentId,
        }).catch(params.onRecordError);
      }
      // If not forwarded (mention-only + not mentioned), the message stays on the proxy session
      // and is not forwarded to the target session.
    }
  }
  const runtime = await loadInboundSessionRuntime();
  const metaTask = runtime
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: canonicalSessionKey,
      ctx,
      groupResolution,
      createIfMissing,
    })
    .catch(params.onRecordError);
  params.trackSessionMetaTask?.(metaTask);
  void metaTask;

  // Track whether we actually redirected (used for updateLastRoute below)
  const proxyRedirected = canonicalSessionKey !== normalizeLowercaseStringOrEmpty(sessionKey);

  const update = params.updateLastRoute;
  if (!update) {
    return;
  }
  if (shouldSkipPinnedMainDmRouteUpdate(update.mainDmOwnerPin)) {
    return;
  }
  let targetSessionKey = normalizeLowercaseStringOrEmpty(update.sessionKey);
  // If update targets the original session key that was redirected by proxy binding,
  // redirect the update to the target session key as well.
  if (proxyRedirected && targetSessionKey === normalizeLowercaseStringOrEmpty(sessionKey)) {
    targetSessionKey = canonicalSessionKey;
  }
  await runtime.updateLastRoute({
    storePath,
    sessionKey: targetSessionKey,
    deliveryContext: {
      channel: update.channel,
      to: update.to,
      accountId: update.accountId,
      threadId: update.threadId,
    },
    // Avoid leaking inbound origin metadata into a different target session.
    ctx: targetSessionKey === canonicalSessionKey ? ctx : undefined,
    groupResolution,
    createIfMissing,
  });
}
