import upstreamLock from '@/protocol/upstream/technocore-chat.lock.json';

export const TECHNOCORE_ORIGIN = upstreamLock.origin as 'https://technocore.chat';
export const TECHNOCORE_ADAPTER_VERSION = upstreamLock.release.version;
export const TECHNOCORE_OPERATIONAL_COMMIT = upstreamLock.release.commit;
export const TECHNOCORE_RELEASE_TAG = upstreamLock.release.tag;
export const TECHNOCORE_OBSERVED_MAIN_COMMIT = upstreamLock.observedMainCommit;
export const TECHNOCORE_MESSAGE_LIMIT = upstreamLock.contract.messageCharacters;
export const TECHNOCORE_NOTE_LIMIT = upstreamLock.contract.noteCharacters;
export const TECHNOCORE_IDLE_SECONDS = upstreamLock.contract.idleSeconds;
export const TECHNOCORE_STILLBORN_SECONDS = upstreamLock.contract.stillbornSeconds;
export const TECHNOCORE_EXPORT_GENERATION_HEADER = upstreamLock.contract.exportGenerationHeader;
export const TECHNOCORE_LIVE_CONFIG_SHA256 = upstreamLock.liveBaseline.configSha256;
export const TECHNOCORE_LIVE_OPENAPI_SHA256 = upstreamLock.liveBaseline.openapiSha256;
export const TECHNOCORE_LIVE_AGENT_SHA256 = upstreamLock.liveBaseline.agentSha256;

export const TECHNOCORE_ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const TECHNOCORE_NONCE_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
export const TECHNOCORE_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{85}[AQgw]$/;

export type TechnocoreSignedNoteNamespace = 'room-owners' | 'room-allow';

export function assertTechnocoreRoomName(room: string) {
  if (!TECHNOCORE_ROOM_PATTERN.test(room)) {
    throw new Error('Room names must start with a lowercase letter or digit and contain at most 48 lowercase letters, digits, underscores, or hyphens.');
  }
  return room;
}

export function ownedTechnocoreRoom(value: string) {
  const room = value.startsWith('d-') ? value : `d-${value}`;
  assertTechnocoreRoomName(room);
  if (!room.startsWith('d-') || room === 'd-' || room === 'lobby' || room === 'meta') {
    throw new Error('Only a non-empty d- room can be owned.');
  }
  return room;
}

export function privateTechnocoreMailbox(value: string) {
  assertTechnocoreRoomName(value);
  if (!/^mb-p-[a-z0-9]{16,40}$/.test(value)) {
    throw new Error('Private mailbox names must use mb-p- followed by 16-40 lowercase letters or digits.');
  }
  return value;
}

export default upstreamLock;
