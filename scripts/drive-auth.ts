import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { loadEnvFile } from "node:process";
import { google } from "googleapis";

loadEnvFile(".env");

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const host = "127.0.0.1";
const scope = "https://www.googleapis.com/auth/drive";

async function main() {
  const clientId = required("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = required("GOOGLE_OAUTH_CLIENT_SECRET");
  const state = randomBytes(32).toString("hex");

  const server = createServer();
  server.listen(0, host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate the OAuth callback port");
  }

  const redirectUri = `http://${host}:${address.port}`;
  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [scope],
    state,
  });

  console.log(
    "\nOpen this URL in your browser and approve Google Drive access:\n",
  );
  console.log(authUrl);
  console.log("\nWaiting for Google OAuth callback...");

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          reject(new Error("OAuth authorization timed out after 5 minutes"));
        },
        5 * 60 * 1000,
      );

      server.once("request", (request, response) => {
        clearTimeout(timeout);

        try {
          const url = new URL(request.url ?? "/", redirectUri);
          const returnedState = url.searchParams.get("state");
          const error = url.searchParams.get("error");
          const code = url.searchParams.get("code");

          if (returnedState !== state) {
            response.writeHead(400, {
              "Content-Type": "text/plain; charset=utf-8",
            });
            response.end(
              "OAuth state validation failed. Return to the terminal.",
            );
            reject(new Error("OAuth state validation failed"));
            return;
          }

          if (error) {
            response.writeHead(400, {
              "Content-Type": "text/plain; charset=utf-8",
            });
            response.end(
              "Google authorization was not completed. Return to the terminal.",
            );
            reject(new Error(`Google OAuth returned: ${error}`));
            return;
          }

          if (!code) {
            response.writeHead(400, {
              "Content-Type": "text/plain; charset=utf-8",
            });
            response.end("Authorization code missing. Return to the terminal.");
            reject(new Error("Google OAuth callback did not contain a code"));
            return;
          }

          response.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
          });
          response.end(
            "<!doctype html><title>BrandSpace Forge</title><h1>Google Drive connected.</h1><p>You can close this tab and return to the terminal.</p>",
          );
          resolve(code);
        } catch (error) {
          reject(error);
        }
      });
    });

    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Re-run drive:auth and approve consent again.",
      );
    }

    console.log("\nOAuth authorization succeeded.");
    console.log("Add this value to your local .env and never commit it:\n");
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nThen run: npm run drive:check");
  } finally {
    server.close();
  }
}

main().catch((error: unknown) => {
  console.error("[drive:auth] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
