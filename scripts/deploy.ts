/**
 * Reload the container on purr, after `publish:purr` has put the image there.
 *
 * `just reload` git-pulls compose.stacks and converges the whole stack, which
 * is what the runbook does — the pull matters because a version bump lives in
 * compose.yml, not here. Compose recreates the container when the image id
 * behind its tag changes, so a same-tag rebuild still takes effect.
 */

import { HOST, SERVICE, STACK_DIR, capture, run, versionTag } from "./image"

const wanted = await capture(["ssh", HOST, `docker image inspect ${versionTag} --format '{{.Id}}'`])
if (!wanted) {
  throw new Error(`${versionTag} is not on ${HOST}; run \`mise run publish:purr\` first`)
}

await run(["ssh", HOST, `cd ${STACK_DIR} && just reload`])

// Verify by outcome rather than by trusting the reload: if compose.yml still
// pins an older tag, `just reload` succeeds and quietly keeps the old image.
const running = await capture([
  "ssh",
  HOST,
  `docker inspect ${SERVICE} --format '{{.Image}}'`,
])

if (running === wanted) {
  console.log(`\n${SERVICE} is running ${versionTag}`)
} else {
  console.error(`\n${SERVICE} is NOT running ${versionTag}`)
  console.error(`  running: ${running ?? "(no such container)"}`)
  console.error(`  wanted:  ${wanted}`)
  console.error(`\ncompose.yml on ${HOST} probably still pins another tag —`)
  console.error(`bump it in compose.stacks/hosts/igor/compose.yml, push, and rerun.`)
  process.exit(1)
}
