import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import { z } from 'zod';

const runtimeModeSchema = z.enum(['external_cli', 'gateway_tools_invoke']);

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    HOST: z.string().min(1),
    PORT: z.string().regex(/^\d+$/).transform(Number),
    OPENCLAW_SHARED_TOKEN: z.string().min(16),
    OPENCLAW_PERMISSION_MANIFEST_VERSION: z.string().min(1),
    OPENCLAW_ALLOWED_COMMANDS: z.string().min(1),
    OPENCLAW_ALLOWED_TENANTS: z.string().min(1),
    OPENCLAW_TENANT_RATE_LIMIT_PER_MINUTE: z.string().regex(/^\d+$/).transform(Number),
    OPENCLAW_IDEMPOTENCY_STORE_FILE: z.string().min(1),
    OPENCLAW_OUTBOX_FILE: z.string().min(1),
    OPENCLAW_RUNTIME_MODE: runtimeModeSchema,
    OPENCLAW_AGENT_ID: z.string().min(1).optional(),
    OPENCLAW_AGENT_TIMEOUT_SECONDS: z.string().regex(/^\d+$/).transform(Number).optional(),
    OPENCLAW_AGENT_LOCAL_MODE: z.enum(['true', 'false']).optional(),
    OPENCLAW_GATEWAY_URL: z.string().url().optional(),
    OPENCLAW_GATEWAY_TOKEN: z.string().min(1).optional(),
    OPENCLAW_GATEWAY_TOOL_MAPPINGS: z.string().min(2).optional(),
  })
  .superRefine((value, context) => {
    if (value.OPENCLAW_RUNTIME_MODE === 'external_cli') {
      if (value.OPENCLAW_AGENT_ID === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENCLAW_AGENT_ID'],
          message: 'OPENCLAW_AGENT_ID is required when OPENCLAW_RUNTIME_MODE=external_cli',
        });
      }
      if (value.OPENCLAW_AGENT_TIMEOUT_SECONDS === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENCLAW_AGENT_TIMEOUT_SECONDS'],
          message: 'OPENCLAW_AGENT_TIMEOUT_SECONDS is required when OPENCLAW_RUNTIME_MODE=external_cli',
        });
      }
      if (value.OPENCLAW_AGENT_LOCAL_MODE === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENCLAW_AGENT_LOCAL_MODE'],
          message: 'OPENCLAW_AGENT_LOCAL_MODE is required when OPENCLAW_RUNTIME_MODE=external_cli',
        });
      }
    }

    if (value.OPENCLAW_RUNTIME_MODE === 'gateway_tools_invoke') {
      if (value.OPENCLAW_GATEWAY_URL === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENCLAW_GATEWAY_URL'],
          message: 'OPENCLAW_GATEWAY_URL is required when OPENCLAW_RUNTIME_MODE=gateway_tools_invoke',
        });
      }
      if (value.OPENCLAW_GATEWAY_TOKEN === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENCLAW_GATEWAY_TOKEN'],
          message: 'OPENCLAW_GATEWAY_TOKEN is required when OPENCLAW_RUNTIME_MODE=gateway_tools_invoke',
        });
      }
      if (value.OPENCLAW_GATEWAY_TOOL_MAPPINGS === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENCLAW_GATEWAY_TOOL_MAPPINGS'],
          message: 'OPENCLAW_GATEWAY_TOOL_MAPPINGS is required when OPENCLAW_RUNTIME_MODE=gateway_tools_invoke',
        });
      }
      if (value.OPENCLAW_AGENT_TIMEOUT_SECONDS === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENCLAW_AGENT_TIMEOUT_SECONDS'],
          message: 'OPENCLAW_AGENT_TIMEOUT_SECONDS is required when OPENCLAW_RUNTIME_MODE=gateway_tools_invoke',
        });
      }
    }
  });

const executorCommandSchema = z.object({
  executionId: z.string().uuid(),
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  commandType: z.string().min(1),
  authorizedByCore: z.literal(true),
  permissionManifestVersion: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

const executorResultEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  executionId: z.string().uuid(),
  tenantId: z.string().min(1),
  correlationId: z.string().min(1),
  emittedAt: z.string().datetime(),
  status: z.enum(['succeeded', 'failed']),
  payload: z.record(z.string(), z.unknown()),
});

type ExecutorResultEvent = z.infer<typeof executorResultEventSchema>;
type ExecutorCommand = z.infer<typeof executorCommandSchema>;

type OpenclawCliRunner = (input: { args: string[]; timeoutSeconds: number }) => Promise<{ stdout: string; stderr: string }>;
type GatewayToolMapping = { tool: string; action: string | undefined };
type GatewayToolMappings = Record<string, GatewayToolMapping>;
type OpenclawGatewayToolInvoker = (input: {
  gatewayUrl: string;
  gatewayToken: string;
  correlationId: string;
  tool: string;
  action?: string;
  args: Record<string, unknown>;
  timeoutSeconds: number;
}) => Promise<unknown>;

interface SecretProvider {
  get(name: string): string;
}

class EnvSecretProvider implements SecretProvider {
  constructor(private readonly source: NodeJS.ProcessEnv) {}

  get(name: string): string {
    const value = this.source[name];
    if (value === undefined || value.length === 0) {
      throw new Error(`Missing secret: ${name}`);
    }
    return value;
  }
}

class TenantRateLimiter {
  private readonly windows = new Map<string, { windowStartMs: number; count: number }>();

  constructor(private readonly maxPerMinute: number) {}

  tryConsume(tenantId: string): boolean {
    const now = Date.now();
    const current = this.windows.get(tenantId);
    if (current === undefined || now - current.windowStartMs >= 60_000) {
      this.windows.set(tenantId, { windowStartMs: now, count: 1 });
      return true;
    }

    if (current.count >= this.maxPerMinute) {
      return false;
    }

    current.count += 1;
    this.windows.set(tenantId, current);
    return true;
  }
}

class FileBackedIdempotencyStore {
  private readonly cache = new Map<string, ExecutorResultEvent>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(executionId: string): ExecutorResultEvent | undefined {
    return this.cache.get(executionId);
  }

  set(executionId: string, event: ExecutorResultEvent): void {
    this.cache.set(executionId, event);
    this.flush();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [executionId, value] of Object.entries(parsed)) {
        const event = executorResultEventSchema.parse(value);
        this.cache.set(executionId, event);
      }
    } catch {
      return;
    }
  }

  private flush(): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true });

    const payload: Record<string, ExecutorResultEvent> = {};
    for (const [executionId, event] of this.cache.entries()) {
      payload[executionId] = event;
    }

    const temporaryFile = `${this.filePath}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(payload), 'utf8');
    renameSync(temporaryFile, this.filePath);
  }
}

class FileBackedExecutorOutbox {
  private readonly events: ExecutorResultEvent[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  append(event: ExecutorResultEvent): void {
    this.events.push(event);
    this.flush();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown[];
      for (const item of parsed) {
        this.events.push(executorResultEventSchema.parse(item));
      }
    } catch {
      return;
    }
  }

  private flush(): void {
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporaryFile = `${this.filePath}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(this.events), 'utf8');
    renameSync(temporaryFile, this.filePath);
  }
}

const gatewayToolMappingsSchema = z.record(
  z.string(),
  z.object({
    tool: z.string().min(1),
    action: z.string().min(1).optional(),
  }),
);

function parseGatewayToolMappings(rawMappings: string): GatewayToolMappings {
  const parsedJson: unknown = JSON.parse(rawMappings);
  const parsed = gatewayToolMappingsSchema.parse(parsedJson);
  const normalized: GatewayToolMappings = {};

  for (const [commandType, mapping] of Object.entries(parsed)) {
    normalized[commandType] = {
      tool: mapping.tool,
      action: mapping.action,
    };
  }

  return normalized;
}

async function runOpenclawCliCommand(input: {
  command: ExecutorCommand;
  agentId: string;
  timeoutSeconds: number;
  localMode: boolean;
  runner: OpenclawCliRunner;
}): Promise<{ stdout: string; parsedOutput: unknown }> {
  const requestBody = {
    executionId: input.command.executionId,
    tenantId: input.command.tenantId,
    correlationId: input.command.correlationId,
    commandType: input.command.commandType,
    payload: input.command.payload,
  };
  const message = [
    'You are executing exactly one Core-authorized ARO side-effect command.',
    'Do not initiate additional workflows, policy decisions, or follow-up actions.',
    'Do not mutate business state; only execute the requested side effect and report outcome.',
    `Correlation: ${input.command.correlationId}`,
    `Command envelope: ${JSON.stringify(requestBody)}`,
  ].join('\n');
  const args = ['agent', '--agent', input.agentId, '--message', message, '--json', '--timeout', String(input.timeoutSeconds)];
  if (input.localMode) {
    args.push('--local');
  }

  const result = await input.runner({ args, timeoutSeconds: input.timeoutSeconds });
  try {
    return {
      stdout: result.stdout,
      parsedOutput: JSON.parse(result.stdout),
    };
  } catch {
    return {
      stdout: result.stdout,
      parsedOutput: { text: result.stdout },
    };
  }
}

const defaultOpenclawCliRunner: OpenclawCliRunner = async ({ args, timeoutSeconds }) =>
  await new Promise((resolveRunner, rejectRunner) => {
    const child = spawn('openclaw', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectRunner(error);
    });

    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutSeconds * 1000);

    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0) {
        resolveRunner({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      rejectRunner(new Error(`openclaw CLI failed (exit=${code}): ${stderr.trim() || 'No stderr output'}`));
    });
  });

const defaultOpenclawGatewayToolInvoker: OpenclawGatewayToolInvoker = async ({
  gatewayUrl,
  gatewayToken,
  correlationId,
  tool,
  action,
  args,
  timeoutSeconds,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const response = await fetch(`${gatewayUrl.replace(/\/$/, '')}/tools/invoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${gatewayToken}`,
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      },
      body: JSON.stringify({
        tool,
        ...(action === undefined ? {} : { action }),
        args,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    let parsedBody: unknown = responseText;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      parsedBody = responseText;
    }

    if (!response.ok) {
      throw new Error(
        `OpenClaw gateway tools/invoke failed (${response.status}): ${typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody)}`,
      );
    }

    return parsedBody;
  } finally {
    clearTimeout(timeout);
  }
};

async function runOpenclawGatewayToolCommand(input: {
  command: ExecutorCommand;
  gatewayUrl: string;
  gatewayToken: string;
  timeoutSeconds: number;
  toolMappings: GatewayToolMappings;
  invoker: OpenclawGatewayToolInvoker;
}): Promise<{ tool: string; action?: string; output: unknown }> {
  const mapping = input.toolMappings[input.command.commandType];
  if (mapping === undefined) {
    throw new Error(`No OpenClaw gateway tool mapping found for command type: ${input.command.commandType}`);
  }

  const output = await input.invoker({
    gatewayUrl: input.gatewayUrl,
    gatewayToken: input.gatewayToken,
    correlationId: input.command.correlationId,
    tool: mapping.tool,
    ...(mapping.action === undefined ? {} : { action: mapping.action }),
    args: {
      executionId: input.command.executionId,
      tenantId: input.command.tenantId,
      correlationId: input.command.correlationId,
      commandType: input.command.commandType,
      payload: input.command.payload,
    },
    timeoutSeconds: input.timeoutSeconds,
  });

  return {
    tool: mapping.tool,
    ...(mapping.action === undefined ? {} : { action: mapping.action }),
    output,
  };
}

function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(source);
}

export function openclawExecutorServiceName(): string {
  return 'openclaw-executor';
}

export function buildOpenclawExecutorApp(
  source: NodeJS.ProcessEnv = process.env,
  dependencies?: {
    openclawCliRunner?: OpenclawCliRunner;
    openclawGatewayToolInvoker?: OpenclawGatewayToolInvoker;
    secretProvider?: SecretProvider;
  },
) {
  const config = loadConfig(source);
  const secretProvider = dependencies?.secretProvider ?? new EnvSecretProvider(source);
  const app = Fastify({ logger: false });
  const allowedCommands = new Set(
    config.OPENCLAW_ALLOWED_COMMANDS.split(',').map((item) => item.trim()).filter((item) => item.length > 0),
  );
  const allowedTenants = new Set(
    config.OPENCLAW_ALLOWED_TENANTS.split(',').map((item) => item.trim()).filter((item) => item.length > 0),
  );
  const tenantRateLimiter = new TenantRateLimiter(config.OPENCLAW_TENANT_RATE_LIMIT_PER_MINUTE);
  const openclawCliRunner = dependencies?.openclawCliRunner ?? defaultOpenclawCliRunner;
  const openclawGatewayToolInvoker = dependencies?.openclawGatewayToolInvoker ?? defaultOpenclawGatewayToolInvoker;
  const gatewayToolMappings =
    config.OPENCLAW_RUNTIME_MODE === 'gateway_tools_invoke'
      ? parseGatewayToolMappings(config.OPENCLAW_GATEWAY_TOOL_MAPPINGS!)
      : undefined;
  const idempotency = new FileBackedIdempotencyStore(config.OPENCLAW_IDEMPOTENCY_STORE_FILE);
  const outbox = new FileBackedExecutorOutbox(config.OPENCLAW_OUTBOX_FILE);

  app.get('/health', async () => ({ status: 'healthy', service: openclawExecutorServiceName() }));
  app.get('/ready', async () => ({ status: 'ready', service: openclawExecutorServiceName() }));

  app.post('/v1/executions', async (request, reply) => {
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      authorization !== `Bearer ${secretProvider.get('OPENCLAW_SHARED_TOKEN')}`
    ) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid executor token',
        },
      });
    }

    const command = executorCommandSchema.parse(request.body);
    const tenantHeader = request.headers['x-tenant-id'];
    const tenantIdFromHeader =
      typeof tenantHeader === 'string'
        ? tenantHeader
        : Array.isArray(tenantHeader)
          ? tenantHeader[0]
          : undefined;

    if (tenantIdFromHeader === undefined || tenantIdFromHeader.length === 0) {
      return reply.status(400).send({
        error: {
          code: 'TENANT_HEADER_REQUIRED',
          message: 'x-tenant-id header is required',
        },
      });
    }

    if (tenantIdFromHeader !== command.tenantId) {
      return reply.status(400).send({
        error: {
          code: 'TENANT_MISMATCH',
          message: 'x-tenant-id header must match command tenantId',
        },
      });
    }

    if (!allowedTenants.has(command.tenantId)) {
      return reply.status(403).send({
        error: {
          code: 'TENANT_NOT_ALLOWED',
          message: `Tenant not allowed by executor policy: ${command.tenantId}`,
        },
      });
    }

    if (!tenantRateLimiter.tryConsume(command.tenantId)) {
      return reply.status(429).send({
        error: {
          code: 'TENANT_RATE_LIMIT_EXCEEDED',
          message: `Tenant rate limit exceeded for ${command.tenantId}`,
        },
      });
    }

    if (command.permissionManifestVersion !== config.OPENCLAW_PERMISSION_MANIFEST_VERSION) {
      return reply.status(400).send({
        error: {
          code: 'PERMISSION_MANIFEST_VERSION_MISMATCH',
          message: 'Permission manifest version mismatch',
        },
      });
    }

    if (!allowedCommands.has(command.commandType)) {
      return reply.status(403).send({
        error: {
          code: 'COMMAND_NOT_ALLOWED',
          message: `Command not allowed by manifest: ${command.commandType}`,
        },
      });
    }

    const existing = idempotency.get(command.executionId);
    if (existing !== undefined) {
      return reply.status(200).send(existing);
    }

    const localMode = config.OPENCLAW_AGENT_LOCAL_MODE === 'true';
    const candidate = await (async () => {
      try {
        if (config.OPENCLAW_RUNTIME_MODE === 'external_cli') {
          const execution = await runOpenclawCliCommand({
            command,
            agentId: config.OPENCLAW_AGENT_ID!,
            timeoutSeconds: config.OPENCLAW_AGENT_TIMEOUT_SECONDS!,
            localMode,
            runner: openclawCliRunner,
          });

          return {
            eventId: randomUUID(),
            eventType: 'executor.command.succeeded',
            executionId: command.executionId,
            tenantId: command.tenantId,
            correlationId: command.correlationId,
            emittedAt: new Date().toISOString(),
            status: 'succeeded' as const,
            payload: {
              acknowledgedCommandType: command.commandType,
              openclawRuntimeMode: config.OPENCLAW_RUNTIME_MODE,
              openclawAgentId: config.OPENCLAW_AGENT_ID,
              openclawLocalMode: localMode,
              openclawOutput: execution.parsedOutput,
              openclawRawOutput: execution.stdout,
            },
          };
        }

        const execution = await runOpenclawGatewayToolCommand({
          command,
          gatewayUrl: config.OPENCLAW_GATEWAY_URL!,
          gatewayToken: config.OPENCLAW_GATEWAY_TOKEN!,
          timeoutSeconds: config.OPENCLAW_AGENT_TIMEOUT_SECONDS!,
          toolMappings: gatewayToolMappings!,
          invoker: openclawGatewayToolInvoker,
        });

        return {
          eventId: randomUUID(),
          eventType: 'executor.command.succeeded',
          executionId: command.executionId,
          tenantId: command.tenantId,
          correlationId: command.correlationId,
          emittedAt: new Date().toISOString(),
          status: 'succeeded' as const,
          payload: {
            acknowledgedCommandType: command.commandType,
            openclawRuntimeMode: config.OPENCLAW_RUNTIME_MODE,
            openclawGatewayUrl: config.OPENCLAW_GATEWAY_URL,
            openclawGatewayTool: execution.tool,
            openclawGatewayAction: execution.action,
            openclawOutput: execution.output,
          },
        };
      } catch (error) {
        return {
          eventId: randomUUID(),
          eventType: 'executor.command.failed',
          executionId: command.executionId,
          tenantId: command.tenantId,
          correlationId: command.correlationId,
          emittedAt: new Date().toISOString(),
          status: 'failed' as const,
          payload: {
            acknowledgedCommandType: command.commandType,
            openclawRuntimeMode: config.OPENCLAW_RUNTIME_MODE,
            ...(config.OPENCLAW_RUNTIME_MODE === 'external_cli'
              ? {
                  openclawAgentId: config.OPENCLAW_AGENT_ID,
                  openclawLocalMode: localMode,
                }
              : {
                  openclawGatewayUrl: config.OPENCLAW_GATEWAY_URL,
                }),
            reason: error instanceof Error ? error.message : 'Unknown OpenClaw execution error',
          },
        };
      }
    })();

    const event = executorResultEventSchema.parse(candidate);
    outbox.append(event);
    idempotency.set(command.executionId, event);
    return reply.status(200).send(event);
  });

  return { app, config };
}

export async function startOpenclawExecutorServer(): Promise<void> {
  const { app, config } = buildOpenclawExecutorApp();
  await app.listen({ host: config.HOST, port: config.PORT });
}

const executedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (executedDirectly) {
  startOpenclawExecutorServer();
}
