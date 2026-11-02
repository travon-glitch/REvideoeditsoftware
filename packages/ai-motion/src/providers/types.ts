export interface GenerativeRequest {
  photo: Uint8Array;
  mimeType: string;
  fileName: string;
  prompt: string;
  durationSeconds: number;
  aspect: "16:9" | "9:16" | "1:1";
  onProviderJob?: (id: string) => Promise<void> | void;
}

export interface GenerativeResult { video: Uint8Array; providerJobId: string; model: string }

export interface GenerativeProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  imageToVideo(req: GenerativeRequest): Promise<GenerativeResult>;
}
