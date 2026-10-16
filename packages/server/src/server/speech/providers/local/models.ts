import {
  ensureSherpaOnnxModels,
  getSherpaOnnxModelDir,
  isSherpaOnnxModelInstalled,
} from "./sherpa/model-downloader.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  listSherpaOnnxModels,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
} from "./sherpa/model-catalog.js";

export {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
};

export type LocalSpeechModelSpec = ReturnType<typeof listSherpaOnnxModels>[number];

export function listLocalSpeechModels(): LocalSpeechModelSpec[] {
  return listSherpaOnnxModels();
}

export function getLocalSpeechModelDir(modelsDir: string, modelId: LocalSpeechModelId): string {
  return getSherpaOnnxModelDir(modelsDir, modelId);
}

export async function listMissingLocalSpeechModels(options: {
  modelsDir: string;
  modelIds: LocalSpeechModelId[];
}): Promise<LocalSpeechModelId[]> {
  const installed = await Promise.all(
    options.modelIds.map((modelId) => isSherpaOnnxModelInstalled(options.modelsDir, modelId)),
  );
  return options.modelIds.filter((_modelId, index) => !installed[index]);
}

export async function ensureLocalSpeechModels(options: {
  modelsDir: string;
  modelIds: LocalSpeechModelId[];
  logger: import("pino").Logger;
  signal?: AbortSignal;
}): Promise<Record<LocalSpeechModelId, string>> {
  return ensureSherpaOnnxModels({
    modelsDir: options.modelsDir,
    modelIds: options.modelIds,
    logger: options.logger,
    signal: options.signal,
  });
}

/** Reduces a language tag such as "de-AT" or "FR" to its primary subtag ("de", "fr"). */
export function primaryLanguageSubtag(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/)[0];
}

export interface LocalTtsVoiceSelection {
  model: string;
  speakerId?: number;
}

/**
 * Picks the voice for a declared language. Mapped voices speak as their first speaker;
 * the configured speaker id belongs to the default voice.
 */
export function resolveLocalTtsVoice(
  config: {
    voiceTtsModel: string;
    voiceTtsSpeakerId?: number;
    voiceTtsVoices?: Record<string, string>;
  },
  language: string | undefined,
): LocalTtsVoiceSelection {
  const mapped = language ? config.voiceTtsVoices?.[primaryLanguageSubtag(language)] : undefined;
  if (mapped && mapped !== config.voiceTtsModel) {
    return { model: mapped };
  }
  return config.voiceTtsSpeakerId === undefined
    ? { model: config.voiceTtsModel }
    : { model: config.voiceTtsModel, speakerId: config.voiceTtsSpeakerId };
}
