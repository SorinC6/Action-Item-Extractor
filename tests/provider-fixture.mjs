import { once } from "node:events";
import { createServer } from "node:http";

export async function startProvider() {
  const requests = [];
  let nextReply;

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }

    let body;
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400).end("Expected a JSON request");
      return;
    }
    requests.push({ authorization: request.headers.authorization, body });

    const reply = nextReply;
    nextReply = undefined;
    if (!reply) {
      response.writeHead(500).end("No provider response scripted");
      return;
    }

    response.writeHead(reply.status, { "content-type": "application/json" });
    if (reply.stall) {
      response.write(reply.body);
    } else {
      response.end(reply.body);
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    reply({ status = 200, body, stall = false }) {
      nextReply = { status, body, stall };
    },
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}

export function completionBody(content) {
  return JSON.stringify(
    {
      id: "stub-completion",
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 25, completion_tokens: 14, total_tokens: 39 },
    },
    null,
    2,
  );
}
