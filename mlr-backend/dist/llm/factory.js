import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
/** The configured provider, or null when the LLM layer is off (LLM_PROVIDER=none, the default). */
export function createProvider(config) {
    switch (config.LLM_PROVIDER) {
        case 'none':
            return null;
        case 'mock':
            return new MockProvider();
        case 'anthropic':
            return new AnthropicProvider({
                model: config.LLM_MODEL,
                effort: config.LLM_EFFORT,
                maxTokens: config.LLM_MAX_TOKENS,
                fallback: config.LLM_FALLBACK,
            });
    }
}
//# sourceMappingURL=factory.js.map