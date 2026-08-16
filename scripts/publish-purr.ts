/**
 * Build the image and stream it straight to purr over ssh — no registry.
 *
 * purr holds no ghcr credentials and the package is private, so it cannot pull
 * the image; this is how it actually gets one. `docker save` emits every layer
 * every time, which is why the stream is compressed: gzip -1 because the layers
 * are already mostly compressed and the link, not the CPU, is the bottleneck.
 *
 * Compose leaves an already-present tag alone (its default pull policy is
 * `missing`), so loading the tag here is enough for the reload to pick it up.
 */

import { HOST, buildImage, capture, gitStatus, requireCleanTree, run, versionTag } from "./image"

requireCleanTree(await gitStatus())
await buildImage()

const localId = await capture(["docker", "image", "inspect", versionTag, "--format", "{{.Id}}"])
if (!localId) throw new Error(`${versionTag} is not present locally after the build`)

const started = performance.now()
// pipefail matters: without it a failed `docker load` on the far end is masked
// by gzip's clean exit, and the task would report success having shipped nothing.
await run([
  "bash",
  "-c",
  `set -o pipefail; docker save ${versionTag} | gzip -1 | ssh ${HOST} 'gunzip | docker load'`,
])
const elapsed = ((performance.now() - started) / 1000).toFixed(0)

const remoteId = await capture([
  "ssh",
  HOST,
  `docker image inspect ${versionTag} --format '{{.Id}}'`,
])
if (remoteId !== localId) {
  throw new Error(`${HOST} has ${remoteId ?? "no image"} for ${versionTag}, expected ${localId}`)
}

console.log(`\n${versionTag} is on ${HOST} in ${elapsed}s, ids match`)
console.log(`to restart the container there: mise run deploy`)
