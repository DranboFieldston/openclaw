import type { MsgContext } from "../auto-reply/templating.js";
import type { GroupKeyResolution } from "../config/sessions/types.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import type { InboundLastRouteUpdate } from "./session.types.js";
export type { InboundLastRouteUpdate, RecordInboundSession } from "./session.types.js";

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
  const { resolveProxyBinding } = await import("../gateway/session-utils.js");
  const store = loadSessionStore(storePath);
  const proxyBinding = resolveProxyBinding(store, canonicalSessionKey);
  if (proxyBinding) {
    const targetKey = normalizeLowercaseStringOrEmpty(proxyBinding.targetSessionKey);
    if (targetKey && targetKey !== canonicalSessionKey) {
      canonicalSessionKey = targetKey;
      // Update ctx.SessionKey so downstream dispatch uses the target session
      if (ctx.SessionKey !== undefined) {
        ctx.SessionKey = canonicalSessionKey;
      }
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
  if (proxyBinding && targetSessionKey === normalizeLowercaseStringOrEmpty(sessionKey)) {
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
