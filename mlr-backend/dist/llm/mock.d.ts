import type { LLMProvider, LlmRequest, LlmResponse } from './types.js';
export declare class MockProvider implements LLMProvider {
    readonly name: "mock";
    readonly model = "mock-1";
    readonly settings: {};
    complete(req: LlmRequest): Promise<LlmResponse>;
}
