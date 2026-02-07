const { BedrockClient } = require("@aws-sdk/client-bedrock");
const { BedrockRuntimeClient } = require("@aws-sdk/client-bedrock-runtime");
const { BedrockAgentRuntimeClient } = require("@aws-sdk/client-bedrock-agent-runtime");
const { fromIni } = require("@aws-sdk/credential-providers");

function resolveAwsConfig() {
  const region = process.env.AWS_REGION || "us-east-1";
  const profile = process.env.AWS_PROFILE;

  const config = { region };

  // If profile is set, explicitly resolve credentials from that profile.
  // Otherwise, SDK uses default credential provider chain:
  // env vars, shared config/credentials, SSO, EC2/ECS role, etc.
  if (profile) {
    config.credentials = fromIni({ profile });
  }
  return config;
}

function createClients() {
  const cfg = resolveAwsConfig();
  return {
    bedrock: new BedrockClient(cfg),
    runtime: new BedrockRuntimeClient(cfg),
    agentRuntime: new BedrockAgentRuntimeClient(cfg),
  };
}

module.exports = { createClients };
