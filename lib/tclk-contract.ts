import upstreamLock from '@/protocol/upstream/tclk.lock.json';

export const TCLK_VERSION = upstreamLock.contract.version as 'tclk/1';
export const TCLK_PREFIX = upstreamLock.contract.prefix as 'tclk1 ';
export const TCLK_DOMAIN = upstreamLock.contract.domain as 'FLOP::tclk::v1';
export const TCLK_MAX_FRAME_CHARACTERS = upstreamLock.contract.maxFrameCharacters;
export const TCLK_RELEASE_TAG = upstreamLock.release.tag;
export const TCLK_RELEASE_COMMIT = upstreamLock.release.commit;
export const TCLK_OPERATIONAL_COMMIT = upstreamLock.operationalCommit;
export const TCLK_OBSERVED_MAIN_COMMIT = upstreamLock.observedMainCommit;

export default upstreamLock;
