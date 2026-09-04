export type TclkLayerState = 'valid' | 'invalid' | 'absent' | 'not_checked';

export type TclkTechnocoreTransport = {
  source: 'technocore_export';
  room: string;
  exportSha256: string;
  exportBytes: number;
  totalRecords: number;
  selectedRecords: number;
  ignoredRecords: number;
  signatureCounts: { valid: number; invalid: number; not_reverifiable: number; unsigned: number };
  authorsBound: boolean;
  records: Array<{
    seq: string;
    recordDid: string;
    frameDid: string | null;
    authorMatches: boolean;
    text: string;
  }>;
  signedFields: ['room', 'nonce', 'text'];
  sequenceMetadata: 'server_asserted_unsigned';
  timestampMetadata: 'server_asserted_unsigned';
  generationMetadata: 'external_header_unsigned';
  inclusionProof: 'not_cryptographically_established';
};

export type BrowserTclkInspection = {
  ok: boolean;
  frameCount: number;
  status: 'proposed' | 'accepted' | 'locked' | 'claimed' | 'refunded' | 'cancelled';
  contract: string | null;
  offer: {
    lock: 'hash' | 'point';
    amount: string;
    asset: string;
    rails: string[];
    job?: { proto: string; id: string; context?: string };
  };
  events: Array<{ index: number; type: string; state: 'valid' | 'invalid'; message: string }>;
  invalidCount: number;
  layers: {
    canonicalFrames: TclkLayerState;
    offerBinding: TclkLayerState;
    contractBinding: TclkLayerState;
    frameOrder: TclkLayerState;
    hashWitness: TclkLayerState;
    terminalReceipt: TclkLayerState;
    transportDid: TclkLayerState;
    deadlineEvidence: TclkLayerState;
    railSettlement: TclkLayerState;
  };
  transport: TclkTechnocoreTransport | null;
  caveats: string[];
};

export class BrowserTclkError extends Error {
  code: string;
  stage: string;
}

export const TCLK_TRANSCRIPT_MAX_BYTES: number;
export const TCLK_TRANSCRIPT_MAX_FRAMES: number;
export function inspectTclkTranscript(bytes: Uint8Array): Promise<BrowserTclkInspection>;
export function inspectTclkTechnocoreExport(bytes: Uint8Array, room: string): Promise<BrowserTclkInspection>;
