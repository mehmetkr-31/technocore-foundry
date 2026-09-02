export const BROWSER_DOSSIER_MAX_BYTES: number;
export const BROWSER_ARTIFACT_MAX_BYTES: number;

export class BrowserDossierError extends Error {
  code: string;
  stage: string;
}

export type BrowserLayerState = 'valid' | 'absent' | 'not_checked' | 'mismatch';
export type BrowserDossierVerification = {
  ok: true;
  id: string;
  sha256: string;
  selectedResultId: string;
  selectedState: 'submitted' | 'changes_requested' | 'rejected' | 'accepted' | 'finalized';
  mission: {
    id: string;
    title: string;
    lane: string;
    summary: string;
    issuerDid: string;
    claimantDid: string;
  };
  revisionCount: number;
  receiptCount: number;
  revisions: Array<{
    revision: number;
    resultId: string;
    createdAt: string;
    resultReceiptSha256: string;
    outcome: string;
  }>;
  layers: {
    contentAddress: BrowserLayerState;
    receiptSignatures: BrowserLayerState;
    missionAndClaim: BrowserLayerState;
    revisionChain: BrowserLayerState;
    issuerOutcome: BrowserLayerState;
    executionEvidence: BrowserLayerState;
    structuredReview: BrowserLayerState;
    peerEvidence: BrowserLayerState;
    artifact: BrowserLayerState;
  };
  gaps: string[];
  commons: { eligible: boolean; filenameMatches: boolean; expectedFilename: string; reason: string };
  caveat: string;
};

export function verifyDossierInBrowser(
  input: Uint8Array | ArrayBuffer,
  options?: { expectedId?: string; filename?: string; artifactBytes?: Uint8Array | ArrayBuffer },
): Promise<BrowserDossierVerification>;
