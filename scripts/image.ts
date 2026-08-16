/**
 * Shared plumbing for the release tasks: what the image is called, how to
 * build it, and how to run a command noisily.
 *
 * Two tasks publish this image and both need the same tags, so the tags live
 * here rather than being spelled twice and drifting.
 */

import pkg from "../package.json"

export const IMAGE = process.env.IMAGE ?? "ghcr.io/igor47/allowance"
export const version = process.env.VERSION ?? pkg.version
export const versionTag = `${IMAGE}:${version}`
export const tags = [versionTag, `${IMAGE}:latest`]

/** The host the stack runs on, and where its compose files live there. */
export const HOST = process.env.PURR_HOST ?? "purr"
export const STACK_DIR = process.env.STACK_DIR ?? "~/repos/compose.stacks/hosts/igor"
export const SERVICE = process.env.SERVICE ?? "allowance.igor"

export async function run(command: string[], env?: Record<string, string>): Promise<void> {
  console.log(`$ ${command.join(" ")}`)
  const proc = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${command[0]} exited with ${code}`)
}

/** Run a command and capture stdout; returns null if it exits non-zero. */
export async function capture(command: string[]): Promise<string | null> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" })
  const out = (await new Response(proc.stdout).text()).trim()
  return (await proc.exited) === 0 ? out : null
}

/** Releases come from committed code, so the tag means something later. */
export function requireCleanTree(dirty: string): void {
  if (dirty && !process.env.ALLOW_DIRTY) {
    console.error("working tree is dirty; commit first or set ALLOW_DIRTY=1\n")
    console.error(dirty)
    process.exit(1)
  }
}

export async function gitStatus(): Promise<string> {
  return (await capture(["git", "status", "--porcelain"])) ?? ""
}

/**
 * Build under the ambient docker config: that is where buildx state and the
 * gcloud/ECR credential helpers live, and the base image is public anyway.
 */
export async function buildImage(): Promise<void> {
  await run(["docker", "build", ...tags.flatMap((t) => ["-t", t]), "."])
}
