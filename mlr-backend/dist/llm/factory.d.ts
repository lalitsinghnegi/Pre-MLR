import type { Config } from '../config.js';
import type { LLMProvider } from './types.js';
/** The configured provider, or null when the LLM layer is off (LLM_PROVIDER=none, the default). */
export declare function createProvider(config: Config): LLMProvider | null;
