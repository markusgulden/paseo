import pino from "pino";
import { describe, expect, test } from "vitest";

import { initializeLocalSpeechServices } from "./runtime.js";

const local = { provider: "local", explicit: true, enabled: true } as const;

describe("initializeLocalSpeechServices", () => {
  test("requires every voice mapped to a language as a local model", async () => {
    const speech = await initializeLocalSpeechServices({
      providers: {
        dictationStt: local,
        voiceTurnDetection: local,
        voiceStt: local,
        voiceTts: local,
      },
      speechConfig: {
        providers: {
          dictationStt: local,
          voiceTurnDetection: local,
          voiceStt: local,
          voiceTts: local,
        },
        local: {
          modelsDir: "/tmp/paseo-models",
          models: {
            dictationStt: "parakeet-tdt-0.6b-v3-int8",
            voiceStt: "parakeet-tdt-0.6b-v3-int8",
            voiceTts: "kokoro-en-v0_19",
            voiceTtsVoices: { de: "piper-de_de-thorsten-medium", fr: "piper-fr_fr-siwis-medium" },
          },
        },
      },
      logger: pino({ level: "silent" }),
    });
    speech.cleanup();

    expect(speech.localModelConfig?.defaultModelIds).toEqual([
      "parakeet-tdt-0.6b-v3-int8",
      "kokoro-en-v0_19",
      "piper-de_de-thorsten-medium",
      "piper-fr_fr-siwis-medium",
    ]);
  });
});
