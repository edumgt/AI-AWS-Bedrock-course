const { z } = require("zod");

const ChatSchema = z.object({
  modelId: z.string().min(1),
  system: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1),
    })
  ).min(1),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().min(1).max(4096).optional(),
});

const RagSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  query: z.string().min(1),
  modelArnOrId: z.string().optional(),
});



const EmbedSchema = z.object({
  modelId: z.string().min(1),
  text: z.string().min(1),
  // For providers that support it (e.g., Cohere)
  inputType: z.enum(["search_document","search_query","classification","clustering"]).optional(),
});

const AgentInvokeSchema = z.object({
  agentId: z.string().min(1),
  agentAliasId: z.string().min(1),
  sessionId: z.string().optional(),
  inputText: z.string().min(1),
  enableTrace: z.boolean().optional(),
  endSession: z.boolean().optional(),
});

module.exports = { ChatSchema, RagSchema, AgentInvokeSchema, EmbedSchema };

