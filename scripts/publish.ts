/**
 * Build and push the container image.
 *
 * Invoked through `mise run publish`, which depends on `check` and `test` — so
 * an unchecked image cannot reach the registry. That dependency is the release
 * gate, and it is why this project does not need CI: the laptop and purr are
 * both x86_64, so a local build produces a runnable image.
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import pkg from "../package.json"

const IMAGE = process.env.IMAGE ?? "ghcr.io/igor47/allowance"
const version = process.env.VERSION ?? pkg.version
const tags = [`${IMAGE}:${version}`, `${IMAGE}:latest`]

async function run(command: string[], env?: Record<string, string>): Promise<void> {
  console.log(`$ ${command.join(" ")}`)
  const proc = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${command[0]} exited with ${code}`)
}

/** Read a fresh ghcr token out of the gh CLI, which keeps it in the system keyring. */
async function ghToken(): Promise<string> {
  const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "inherit" })
  const token = (await new Response(proc.stdout).text()).trim()
  if ((await proc.exited) !== 0 || !token) {
    throw new Error("could not read a token from `gh auth token`; run `gh auth login`")
  }
  return token
}

/**
 * Log in to ghcr inside a throwaway DOCKER_CONFIG and hand the directory to
 * `body`, which gets it as the env for its docker commands.
 *
 * The point is that the credential never reaches ~/.docker/config.json, where
 * docker stores it base64-encoded and permanently. Here it lives in a temp dir
 * that is removed even if the push fails, and the token itself only exists in
 * this process and on docker login's stdin — never in argv, where `ps` sees it.
 */
async function withGhcrAuth(body: (env: Record<string, string>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "allowance-docker-"))
  const env = { DOCKER_CONFIG: dir }
  try {
    // ghcr identifies you by the token, not this name, but the repo owner is
    // the honest thing to send.
    const user = process.env.GHCR_USER ?? IMAGE.split("/")[1] ?? "oauth"
    console.log(`$ gh auth token | docker login ghcr.io -u ${user} --password-stdin`)
    const login = Bun.spawn(["docker", "login", "ghcr.io", "-u", user, "--password-stdin"], {
      stdin: new TextEncoder().encode(await ghToken()),
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, ...env },
    })
    if ((await login.exited) !== 0) {
      throw new Error("docker login failed; does the gh token carry write:packages?")
    }
    await body(env)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const dirty = (await new Response(Bun.spawn(["git", "status", "--porcelain"]).stdout).text()).trim()
if (dirty && !process.env.ALLOW_DIRTY) {
  console.error("working tree is dirty; commit first or set ALLOW_DIRTY=1\n")
  console.error(dirty)
  process.exit(1)
}

// Build under the ambient docker config: it is the one with the credential
// helpers and buildx state, and the base image is public anyway.
await run(["docker", "build", ...tags.flatMap((t) => ["-t", t]), "."])

await withGhcrAuth(async (env) => {
  for (const tag of tags) await run(["docker", "push", tag], env)
})

console.log(`\npushed ${tags.join(" and ")}`)
console.log("now pin the version in compose.stacks/hosts/igor/compose.yml and `just reload`")
