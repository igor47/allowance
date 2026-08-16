/**
 * Reload the container on purr, after `publish:purr` has put the image there.
 *
 * `git pull` then `just restart <service>`, deliberately not `just reload`.
 * Reload converges all eleven services in the igor stack: it re-renders every
 * service's config from secrets, applies whatever else happens to be committed
 * in compose.stacks, and waits on every container's health. None of that
 * belongs in shipping one stateless app — an unrelated sick service should not
 * fail this deploy, and an unrelated pending commit should not ride along with
 * it.
 *
 * The pull stays because a version bump lives in compose.yml on purr, not here.
 * `restart` force-recreates, so a same-tag rebuild takes effect too.
 */

import { HOST, SERVICE, STACK_DIR, capture, run, versionTag } from "./image"

const wanted = await capture(["ssh", HOST, `docker image inspect ${versionTag} --format '{{.Id}}'`])
if (!wanted) {
  throw new Error(`${versionTag} is not on ${HOST}; run \`mise run publish:purr\` first`)
}

await run(["ssh", HOST, `cd ${STACK_DIR} && git pull && just restart ${SERVICE}`])

// Verify by outcome rather than by trusting the restart: if compose.yml still
// pins an older tag, the restart succeeds and quietly keeps the old image.
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
