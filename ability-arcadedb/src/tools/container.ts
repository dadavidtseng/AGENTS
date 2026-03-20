/**
 * Container lifecycle tools -- start, stop, status, and health-check.
 */

import { KadiClient, z } from '@kadi.build/core';

import { errorMessage } from '../lib/errors.js';
import type { ArcadeHttpClient } from '../lib/http-client.js';
import type {
  ArcadeManagers,
  HealthResponse,
  StartResponse,
  StatusResponse,
  StopResponse,
} from '../lib/types.js';

/**
 * Register container lifecycle tools (start, stop, status, health) with a
 * {@link KadiClient}.
 *
 * @param client     - The KADI client to register tools on.
 * @param managers   - Vendored CJS manager instances.
 * @param httpClient - HTTP client for direct API health checks.
 */
export function registerContainerTools(
  client: KadiClient,
  managers: ArcadeManagers,
  httpClient: ArcadeHttpClient,
): void {
  /** When true, ArcadeDB runs as a native process — skip all Docker calls. */
  const isContainerMode = process.env.KADI_DEPLOY_MODE === 'container';
  // ---- arcade-start --------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-start',
      description: 'Start the ArcadeDB container. Returns early if already running.',
      input: z.object({
        withTestData: z.boolean().optional().describe('Include test data on first start'),
      }),
    },
    async (input): Promise<StartResponse> => {
      try {
        // In container deployments ArcadeDB runs natively — no Docker needed
        if (isContainerMode) {
          const ready = await httpClient.isReady();
          return ready
            ? { success: true, container: 'embedded', ports: [] }
            : { success: false, error: 'ArcadeDB is not ready (container mode — server started by entrypoint)' };
        }

        const started = await managers.container.start({
          withTestData: input.withTestData ?? false,
        });
        if (!started) {
          return { success: false, error: 'Container failed to start' };
        }
        const status = await managers.container.getStatus();
        return {
          success: true,
          container: status.container?.name ?? 'kadi-arcadedb',
          ports: status.container?.ports ?? [],
        };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-stop ---------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-stop',
      description: 'Stop the ArcadeDB container.',
      input: z.object({
        force: z.boolean().optional().describe('Force stop (docker kill instead of stop)'),
      }),
    },
    async (input): Promise<StopResponse> => {
      try {
        if (isContainerMode) {
          return { success: false, error: 'Cannot stop ArcadeDB in container mode — server is managed by the container entrypoint' };
        }

        const stopped = await managers.container.stop({ force: input.force ?? false });
        return { success: stopped };
      } catch (err: unknown) {
        return { success: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-status -------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-status',
      description: 'Get the current status of the ArcadeDB container (running, ports, uptime).',
      input: z.object({}),
    },
    async (): Promise<StatusResponse> => {
      try {
        if (isContainerMode) {
          const ready = await httpClient.isReady();
          return {
            running: ready,
            container: 'embedded',
            uptime: null,
            ports: [],
          };
        }

        const running = await managers.container.isRunning();
        if (!running) {
          return { running: false };
        }
        const status = await managers.container.getStatus();
        return {
          running: true,
          container: status.container?.name ?? 'kadi-arcadedb',
          uptime: status.container?.uptime ?? null,
          ports: status.container?.ports ?? [],
        };
      } catch (err: unknown) {
        return { success: false, running: false, error: errorMessage(err) };
      }
    },
  );

  // ---- arcade-health -------------------------------------------------------

  client.registerTool(
    {
      name: 'arcade-health',
      description: 'Run a multi-point health check on ArcadeDB (container, API, database).',
      input: z.object({}),
    },
    async (): Promise<HealthResponse> => {
      try {
        const containerRunning = isContainerMode
          ? true
          : await managers.container.isRunning();
        const apiReady = await httpClient.isReady();

        let databaseAccessible = false;
        if (apiReady) {
          const dbs = await managers.database.listDatabases();
          if (dbs.length > 0) {
            const res = await httpClient.query(dbs[0], 'SELECT 1 as ping');
            databaseAccessible = res.success;
          }
        }

        return {
          healthy: containerRunning && apiReady,
          checks: {
            container: containerRunning,
            api: apiReady,
            database: databaseAccessible,
          },
        };
      } catch (err: unknown) {
        return {
          healthy: false,
          error: errorMessage(err),
          checks: { container: false, api: false, database: false },
        };
      }
    },
  );
}
