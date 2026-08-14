/**
 * Build and push the container image.
 *
 * Invoked through `mise run publish`, which depends on `check` and `test` — so
 * an unchecked image cannot reach the registry. That dependency is the release
 * gate, and it is why this project does not need CI: the laptop and purr are
 * both x86_64, so a local build produces a runnable image.
 */

import pkg from "../package.json"

const IMAGE = process.env.IMAGE ?? "ghcr.io/igor47/allowance"
const version = process.env.VERSION ?? pkg.version
const tags = [`${IMAGE}:${version}`, `${IMAGE}:latest`]

async function run(...command: string[]): Promise<void> {
  console.log(`$ ${command.join(" ")}`)
  const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`${command[0]} exited with ${code}`)
}

const dirty = (await new Response(Bun.spawn(["git", "status", "--porcelain"]).stdout).text()).trim()
if (dirty && !process.env.ALLOW_DIRTY) {
  console.error("working tree is dirty; commit first or set ALLOW_DIRTY=1\n")
  console.error(dirty)
  process.exit(1)
}

await run("docker", "build", ...tags.flatMap((t) => ["-t", t]), ".")
for (const tag of tags) await run("docker", "push", tag)

console.log(`\npushed ${tags.join(" and ")}`)
console.log("now pin the version in compose.stacks/hosts/igor/compose.yml and `just reload`")
