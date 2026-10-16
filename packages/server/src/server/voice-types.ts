export type VoiceSpeakHandler = (params: {
  text: string;
  language?: string;
  callerAgentId: string;
  signal?: AbortSignal;
}) => Promise<void>;

export interface VoiceCallerContext {
  childAgentDefaultLabels?: Record<string, string>;
  lockedCwd?: string;
  allowCustomCwd?: boolean;
  enableVoiceTools?: boolean;
}
