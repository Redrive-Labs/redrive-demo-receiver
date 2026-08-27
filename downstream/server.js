const http = require("node:http");

const port = Number(process.env.PORT ?? 4000);

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);

  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  let url;
  try {
    url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
  } catch {
    sendJson(response, 400, {
      error: "invalid_request",
      message: "Request URL or Host header is invalid",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (url.pathname !== "/notifications") {
    sendJson(response, 404, {
      error: "not_found",
      message: "Route not found",
    });
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, {
      error: "method_not_allowed",
      message: "POST is required",
    });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch {
    sendJson(response, 400, {
      error: "invalid_json",
      message: "Request body must be valid JSON",
    });
    return;
  }

  if (
    !isRecord(payload) ||
    typeof payload.eventId !== "number" ||
    !Number.isInteger(payload.eventId)
  ) {
    console.log("Notification rejected: eventId must be an integer");
    sendJson(response, 422, {
      error: "invalid_notification",
      message: "eventId must be an integer",
    });
    return;
  }

  if (
    typeof payload.deliveryId !== "string" ||
    payload.deliveryId.length === 0
  ) {
    console.log("Notification rejected: deliveryId is required");
    sendJson(response, 422, {
      error: "invalid_notification",
      message: "deliveryId is required",
    });
    return;
  }

  sendJson(response, 202, {
    status: "accepted",
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Downstream service listening on port ${port}`);
});
