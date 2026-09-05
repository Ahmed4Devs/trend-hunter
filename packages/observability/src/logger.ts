import { pino, stdSerializers, stdTimeFunctions, type Logger, type LoggerOptions } from 'pino';

import { buildRedactionPaths, REDACTION_CENSOR } from './redaction';

/**
 * Structured logging.
 *
 * One logger factory for all three services, so a log line means the same thing
 * whether it came from a route handler, a queue processor or a start-up script.
 * Every logger is created with redaction already applied — there is no way to
 * obtain an unredacted logger from this package.
 */

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface LoggerConfig {
  /** Appears as `service` on every line. */
  readonly service: 'api' | 'worker' | 'web' | 'database' | 'scripts';
  readonly level: LogLevel;
  /** Pretty-prints in development; JSON in production, for the log shipper. */
  readonly pretty: boolean;
  /** Extra fields merged into every line, e.g. a release identifier. */
  readonly base?: Readonly<Record<string, string | number | boolean>>;
}

export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level,
    base: {
      service: config.service,
      ...config.base,
    },
    // ISO timestamps: a log aggregator should never have to guess a timezone.
    timestamp: stdTimeFunctions.isoTime,
    redact: {
      paths: buildRedactionPaths(),
      censor: REDACTION_CENSOR,
      remove: false,
    },
    formatters: {
      // `level: "warn"` rather than `level: 40`, so a human can read it.
      level: (label) => ({ level: label }),
    },
    // Serialise the parts of an error that help, and none of the parts that
    // leak: `err.config` on an HTTP client error usually holds an auth header.
    serializers: {
      err: stdSerializers.err,
      error: stdSerializers.err,
    },
  };

  if (config.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service',
          messageFormat: '[{service}] {msg}',
          singleLine: false,
        },
      },
    });
  }

  return pino(options);
}

/**
 * A logger bound to one unit of work.
 *
 * Request handlers and job processors always log through a child logger so that
 * `requestId` / `jobId` appears on every line without being passed around.
 */
export function createRequestLogger(parent: Logger, requestId: string): Logger {
  return parent.child({ requestId });
}

export function createJobLogger(
  parent: Logger,
  context: { queue: string; jobId: string; jobName: string; attempt: number },
): Logger {
  return parent.child(context);
}

export type { Logger };
