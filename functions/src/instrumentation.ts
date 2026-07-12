import Anthropic from '@anthropic-ai/sdk';
import { createFirebaseSpanExporter } from '@agentpond/firebase';
import { AnthropicInstrumentation } from '@arizeai/openinference-instrumentation-anthropic';
import { OpenAIInstrumentation } from '@arizeai/openinference-instrumentation-openai';
import { initializeApp } from 'firebase-admin/app';
import { NodeSDK } from '@opentelemetry/sdk-node';
import OpenAI from 'openai';

// Firebase Admin must have a default app before AgentPond creates its exporter.
initializeApp();

const traceConfig = {
	hideInputs: true,
	hideOutputs: true
};

const openAIInstrumentation = new OpenAIInstrumentation({traceConfig});
const anthropicInstrumentation = new AnthropicInstrumentation({traceConfig});

const tracing = new NodeSDK({
	traceExporter: createFirebaseSpanExporter(),
	instrumentations: [
		openAIInstrumentation,
		anthropicInstrumentation
	]
});

tracing.start();

// These explicit patches are required because the Functions package uses ESM.
openAIInstrumentation.manuallyInstrument(OpenAI);
anthropicInstrumentation.manuallyInstrument(Anthropic);
