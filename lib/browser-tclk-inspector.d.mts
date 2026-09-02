export type TclkLayerState = 'valid' | 'invalid' | 'absent' | 'not_checked';

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
  caveats: string[];
};

export class BrowserTclkError extends Error {
  code: string;
  stage: string;
}

export const TCLK_TRANSCRIPT_MAX_BYTES: number;
export const TCLK_TRANSCRIPT_MAX_FRAMES: number;
export function inspectTclkTranscript(bytes: Uint8Array): Promise<BrowserTclkInspection>;
