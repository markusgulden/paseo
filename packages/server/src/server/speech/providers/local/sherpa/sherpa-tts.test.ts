import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import type { LocalTtsModelId } from "./model-catalog.js";
import { SherpaOnnxTTS } from "./sherpa-tts.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function createModelDir(files: string[]): string {
  const modelDir = mkdtempSync(join(tmpdir(), "paseo-tts-"));
  directories.push(modelDir);
  for (const name of files) writeFileSync(join(modelDir, name), "");
  mkdirSync(join(modelDir, "espeak-ng-data"));
  return modelDir;
}

function createTts(
  numThreads?: number,
  beforeGenerate?: () => Promise<void>,
  preset: LocalTtsModelId = "kokoro-en-v0_19",
  modelDir = createModelDir(["model.onnx", "voices.bin", "tokens.txt"]),
) {
  let nativeConfig: unknown;
  const requests: unknown[] = [];
  const released: boolean[] = [];
  const tts = new SherpaOnnxTTS(
    { preset, modelDir, numThreads },
    pino({ level: "silent" }),
    () => ({
      OfflineTts: class {
        sampleRate = 24000;
        free() {
          released.push(true);
        }
        constructor(config: unknown) {
          nativeConfig = config;
        }
        async generateAsync(request: unknown) {
          await beforeGenerate?.();
          return this.generate(request);
        }
        generate(request: unknown) {
          requests.push(request);
          return { samples: Float32Array.from([0, 0.5, -0.5, 0.25]), sampleRate: 24000 };
        }
      },
    }),
  );
  return { tts, requests, nativeConfig, released };
}

async function yieldNativeQueue(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function holdNativeSynthesis() {
  const pending: Array<() => void> = [];
  function wait() {
    return new Promise<void>((resolve) => pending.push(resolve));
  }
  return { pending, wait };
}

describe("SherpaOnnxTTS", () => {
  it("requests Electron-compatible copied samples and returns PCM audio", async () => {
    const { tts, requests } = createTts();
    const result = await tts.synthesizeSpeech("hello");
    expect(requests).toEqual([{ text: "hello", sid: 0, speed: 1, enableExternalBuffer: false }]);
    expect(result.format).toBe("pcm;rate=24000");
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).length).toBe(8);
  });

  it("keeps the event loop available and serializes native synthesis", async () => {
    const { pending, wait } = holdNativeSynthesis();
    const { tts, requests } = createTts(undefined, wait);
    const first = tts.synthesizeSpeech("first");
    const second = tts.synthesizeSpeech("second");
    try {
      await yieldNativeQueue();
      expect(requests).toEqual([]);
      expect(pending).toHaveLength(1);
      pending.shift()!();
      const audio = await first;
      audio.stream.destroy();
      await yieldNativeQueue();
      expect(requests).toHaveLength(1);
      expect(pending).toHaveLength(1);
      pending.shift()!();
      (await second).stream.destroy();
      expect(requests.map((request) => (request as { text: string }).text)).toEqual([
        "first",
        "second",
      ]);
    } finally {
      for (const release of pending) release();
      await Promise.allSettled([first, second]);
      tts.free();
    }
  });

  it("continues queued synthesis after a native failure", async () => {
    let attempts = 0;
    const { tts, requests } = createTts(undefined, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("generation failed");
    });
    const first = tts.synthesizeSpeech("first");
    const second = tts.synthesizeSpeech("second");
    await expect(first).rejects.toThrow("generation failed");
    (await second).stream.destroy();
    expect(requests).toEqual([{ text: "second", sid: 0, speed: 1, enableExternalBuffer: false }]);
    tts.free();
  });

  it("waits for active native synthesis before freeing and drops queued synthesis", async () => {
    const { pending, wait } = holdNativeSynthesis();
    const { tts, requests, released } = createTts(undefined, wait);
    const first = tts.synthesizeSpeech("first");
    const second = tts.synthesizeSpeech("second");
    const rejected = expect(second).rejects.toThrow("TTS provider closed");
    await yieldNativeQueue();
    tts.free();
    expect(released).toEqual([]);
    pending.shift()!();
    (await first).stream.destroy();
    await rejected;
    await yieldNativeQueue();
    expect(requests).toHaveLength(1);
    expect(released).toEqual([true]);
    await expect(tts.synthesizeSpeech("third")).rejects.toThrow("TTS provider closed");
  });

  it.each([undefined, 4])(
    "passes the requested thread count at the native model boundary (%s)",
    (threads) => {
      const { nativeConfig } = createTts(threads);
      expect(nativeConfig).toMatchObject({ model: { numThreads: threads ?? 2, provider: "cpu" } });
      expect(nativeConfig).not.toHaveProperty("numThreads");
      expect(nativeConfig).not.toHaveProperty("provider");
    },
  );

  it("drives a Piper voice through the native VITS model", () => {
    const modelDir = createModelDir(["de_DE-thorsten-medium.onnx", "tokens.txt"]);
    const { nativeConfig } = createTts(
      undefined,
      undefined,
      "piper-de_de-thorsten-medium",
      modelDir,
    );
    expect(nativeConfig).toEqual({
      model: {
        numThreads: 2,
        provider: "cpu",
        vits: {
          model: join(modelDir, "de_DE-thorsten-medium.onnx"),
          tokens: join(modelDir, "tokens.txt"),
          dataDir: join(modelDir, "espeak-ng-data"),
          lengthScale: 1,
        },
      },
      maxNumSentences: 1,
    });
  });

  it("speaks a single-speaker Piper voice as speaker 0", async () => {
    const modelDir = createModelDir(["de_DE-thorsten-medium.onnx", "tokens.txt"]);
    const { tts, requests } = createTts(
      undefined,
      undefined,
      "piper-de_de-thorsten-medium",
      modelDir,
    );
    const result = await tts.synthesizeSpeech("Hallo");
    result.stream.destroy();
    expect(requests).toEqual([{ text: "Hallo", sid: 0, speed: 1, enableExternalBuffer: false }]);
  });

  it("names the missing file when a Piper voice is incomplete", () => {
    const modelDir = createModelDir(["tokens.txt"]);
    expect(() => createTts(undefined, undefined, "piper-de_de-thorsten-medium", modelDir)).toThrow(
      `Missing TTS model: ${join(modelDir, "de_DE-thorsten-medium.onnx")}`,
    );
  });
});
