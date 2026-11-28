import {
  computeRpcActorSignature,
  computeRpcBindSignature,
  hashRpcPayload,
} from './rpc-actor-signature.helper';

/**
 * Signs an RPC sent to user-service on behalf of an acting user, the same way the gateway does
 * (rpc-actor-signature.helper.ts): `actorId`/`actorRole`/`actorSid` plus `actorSig` and the
 * `actorBind` over pattern and payload. tutor-service has no session id, so `actorSid` is empty.
 * The signing time is per call, so each send is a distinct envelope for user-service's replay guard.
 */
export function signUserActorMessage<T extends object>(
  message: T,
  pattern: string,
  actor: { id: string; role: string },
  secret: string,
  now = Date.now(),
): T & {
  actorId: string;
  actorRole: string;
  actorSid: string;
  actorSigTs: number;
  actorSig: string;
  actorBind: string;
} {
  const actorSid = '';
  const actorSig = computeRpcActorSignature(
    { actorId: actor.id, actorRole: actor.role, actorSid, actorSigTs: now },
    secret,
  );
  const signed = {
    ...message,
    actorId: actor.id,
    actorRole: actor.role,
    actorSid,
    actorSigTs: now,
    actorSig,
  };
  const actorBind = computeRpcBindSignature(
    { pattern, payloadHash: hashRpcPayload(signed), actorSig, actorSigTs: now },
    secret,
  );
  return { ...signed, actorBind };
}
