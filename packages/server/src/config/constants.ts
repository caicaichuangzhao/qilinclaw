export const SERVER_CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || 'localhost',
  WORKSPACE_ROOT: process.cwd(),
};

export const BACKUP_CONFIG = {
  MAX_FAILURE_TIME: 10 * 60 * 1000,
  BACKUP_INTERVAL: 30 * 60 * 1000,
  HEARTBEAT_INTERVAL: 30 * 1000,
};

export const LLM_CONFIG = {
  DEFAULT_MAX_TOKENS: 4096,
  DEFAULT_TEMPERATURE: 0.7,
  CONTEXT_LIMIT: 2000,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  LM_STUDIO_BASE_URL: process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1',
  MAX_LOOPS: 30,
  MAX_REPEATS: 5,
};

export const MEMORY_CONFIG = {
  HEARTBEAT_INTERVAL: 60 * 60 * 1000,
  MAX_CONTEXT_TOKENS: 2000,
  RECENT_MESSAGE_COUNT: 6,
  RELEVANT_MESSAGE_COUNT: 5,
  SUMMARY_THRESHOLD: 20,
  SIMILARITY_THRESHOLD: 0.75,
};

export const DATABASE_CONFIG = {
  HEALTH_CHECK_INTERVAL: 30000,
};

export const DATA_DIR = '.qilin-claw';

export const PATHS = {
  DATA_DIR,
  DATABASE: `${DATA_DIR}/claw.db`,
  AGENTS: `${DATA_DIR}/agents.json`,
  BOTS: `${DATA_DIR}/bots.json`,
  THREADS: `${DATA_DIR}/threads.json`,
  SKILLS: `${DATA_DIR}/skills.json`,
  CUSTOM_MODELS: `${DATA_DIR}/custom-models.json`,
  EMBEDDING_CONFIG: `${DATA_DIR}/embedding-config.json`,
  USAGE_RECORDS: `${DATA_DIR}/usage-records.json`,
  CONVERSATION_METAS: `${DATA_DIR}/conversation-metas.json`,
  VECTOR_STORE: `${DATA_DIR}/vector-store.json`,
  SMART_MEMORY: `${DATA_DIR}/smart-memory.json`,
  KNOWLEDGE: `${DATA_DIR}/knowledge`,
  IMAGES: `${DATA_DIR}/images`,
  BACKUPS: `${DATA_DIR}/backups`,
  SYSTEM_BACKUPS: `${DATA_DIR}/system-backups`,
  AGENT_MEMORIES: `${DATA_DIR}/agent-memories`,
};
