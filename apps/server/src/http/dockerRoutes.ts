import type { Hono } from "hono";
import {
  isDockerContainerAction,
  matchDockerContainer,
  parseDockerBulkIds,
  parseDockerContainerRef,
  parseDockerLogTail,
  parseDockerSwarmRef,
  parseDockerSwarmScaleBody,
} from "@locus/shared";
import type { DockerInventory } from "../runtime/dockerInventory.js";
import { errorMessage } from "./sessionJson.js";

export function registerDockerRoutes(app: Hono, docker: DockerInventory): void {
  app.get("/api/docker/swarm", async (c) => {
    const snapshot = await docker.swarm();
    return c.json({ kind: docker.kind(), ...snapshot });
  });

  app.get("/api/docker/swarm/services/:id/logs", async (c) => {
    try {
      const text = await docker.swarmLogs(
        c.req.param("id"),
        parseDockerLogTail(c.req.query("tail")),
      );
      return c.json({ text });
    } catch (err) {
      const message = errorMessage(err);
      const code = /not found/i.test(message) ? 404 : 400;
      return c.json({ error: message }, code);
    }
  });

  app.post("/api/docker/swarm/services/:id/scale", async (c) => {
    const replicas = parseDockerSwarmScaleBody(await c.req.json().catch(() => ({})));
    if (replicas === undefined) return c.json({ error: "Invalid replica count" }, 400);
    try {
      return c.json(await docker.scaleSwarm(c.req.param("id"), replicas));
    } catch (err) {
      const message = errorMessage(err);
      const code = /not found/i.test(message) ? 404 : /manager|inactive/i.test(message) ? 409 : 400;
      return c.json({ error: message }, code);
    }
  });

  app.get("/api/docker/swarm/services/:id", async (c) => {
    const id = parseDockerSwarmRef(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid service" }, 400);
    try {
      return c.json(await docker.swarmService(id));
    } catch (err) {
      const message = errorMessage(err);
      const code = /not found/i.test(message) ? 404 : 400;
      return c.json({ error: message }, code);
    }
  });

  app.get("/api/docker/containers", async (c) => {
    const containers = await docker.list();
    return c.json({ kind: docker.kind(), containers });
  });

  app.post("/api/docker/containers/stop", async (c) => {
    const ids = parseDockerBulkIds(await c.req.json().catch(() => ({})));
    if (!ids) return c.json({ error: "Invalid containers" }, 400);
    return c.json(await docker.stopMany(ids));
  });

  app.get("/api/docker/containers/:id/logs", async (c) => {
    try {
      const text = await docker.logs(c.req.param("id"), parseDockerLogTail(c.req.query("tail")));
      return c.json({ text });
    } catch (err) {
      const message = errorMessage(err);
      const code = /not found/i.test(message) ? 404 : 400;
      return c.json({ error: message }, code);
    }
  });

  app.get("/api/docker/containers/:id/stats", async (c) => {
    try {
      return c.json(await docker.stats(c.req.param("id")));
    } catch (err) {
      const message = errorMessage(err);
      const code = /not found/i.test(message) ? 404 : 400;
      return c.json({ error: message }, code);
    }
  });

  app.post("/api/docker/containers/:id/:action", async (c) => {
    const action = c.req.param("action");
    if (!isDockerContainerAction(action)) return c.json({ error: "Unknown action" }, 404);
    try {
      const row = await docker.action(c.req.param("id"), action);
      return c.json(row);
    } catch (err) {
      const message = errorMessage(err);
      const code = /not found/i.test(message) ? 404 : 400;
      return c.json({ error: message }, code);
    }
  });

  app.get("/api/docker/containers/:id", async (c) => {
    const id = parseDockerContainerRef(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid container" }, 400);
    const containers = await docker.list();
    const row = containers.find((item) => matchDockerContainer(item, id));
    if (!row) return c.json({ error: "Container not found" }, 404);
    return c.json(row);
  });
}
