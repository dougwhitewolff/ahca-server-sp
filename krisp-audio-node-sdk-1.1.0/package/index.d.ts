declare module "krisp-audio-node-sdk" {
  export function globalInit(initString: string): void;

  export function globalDestroy(): void;

  export function getVersion(): {
    major: number;
    minor: number;
    patch: number;
    build: number;
  };

  export const enums: {
    SamplingRate: {
      Sr8000Hz: number;
      Sr16000Hz: number;
      Sr24000Hz: number;
      Sr32000Hz: number;
      Sr44100Hz: number;
      Sr48000Hz: number;
      Sr88200Hz: number;
      Sr96000Hz: number;
    };
    FrameDuration: {
      Fd10ms: number;
      Fd15ms: number;
      Fd20ms: number;
      Fd30ms: number;
      Fd32ms: number;
    };
  };

  export interface ModelInfo {
    path?: string;
    blob?: ArrayBuffer;
  }

  export interface NcSessionConfig {
    inputSampleRate: number;
    inputFrameDuration: number;
    outputSampleRate: number;
    modelInfo?: ModelInfo;
  }

  interface NcInstance {
    process(
      inputFrame: Buffer | ArrayBuffer,
      noiseSuppressionLevel?: number
    ): Buffer;
  }

  export class NcInt16 {
    static create(config: NcSessionConfig): NcInstance;
  }

  export class NcFloat {
    static create(config: NcSessionConfig): NcInstance;
  }
}
