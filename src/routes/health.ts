import { Router } from "express";
import { isDatabaseHealthy } from "../services/health";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/", async (_request, response) => {
    if (!(await isDatabaseHealthy())) {
      response.status(503).json({
        status: "error",
        database: "error",
      });
      return;
    }

    response.status(200).json({
      status: "ok",
      database: "ok",
    });
  });

  return router;
}
