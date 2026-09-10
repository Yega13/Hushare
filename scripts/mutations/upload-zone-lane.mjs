// Mutation set for the video-lane WIRING inside src/components/UploadZone.tsx --
// run with: node scripts/mutations/run.mjs upload-zone-lane
//
// The module is proven by scripts/mutations/video-lane.mjs. This proves the lines that decide
// whether it runs at all, and with what. Every mutation here is a way the component could call a
// correct module wrongly and leave every one of its tests green.
export default {
  file: 'src/components/UploadZone.tsx',
  test: 'tests/upload-zone-wiring.test.ts',
  mutations: [
  { name: 'the failure path stops asking WHAT failed, so a cancel collapses the lane',
    from: "if (kind === 'video') videoLane.note(videoOutcomeOf(e))",
    to: "if (kind === 'video') videoLane.note('failed')" },
  { name: 'the failure is never reported, so the lane stays wide on a network that is dropping videos',
    from: "          if (kind === 'video') videoLane.note(videoOutcomeOf(e))\n", to: "" },
  { name: 'a clean upload is never reported, so the lane can never widen',
    from: "          if (kind === 'video') videoLane.note('clean')", to: "          if (kind === 'video') void 0" },
  { name: 'a fresh lane per batch, so a collapse is forgotten on the next drop',
    from: "    if (!videoLaneRef.current) videoLaneRef.current = createVideoLane(videoSem, videoMax)",
    to: "    videoLaneRef.current = createVideoLane(videoSem, videoMax)" },
  { name: 'a fresh SEMAPHORE per batch, so the session lane resizes a semaphore nothing waits on',
    from: "    if (!videoSemRef.current) videoSemRef.current = new Semaphore(VIDEO_CONCURRENCY_START)",
    to: "    videoSemRef.current = new Semaphore(VIDEO_CONCURRENCY_START)" },
  { name: 'the ceiling is a literal, so mobile probes to the desktop maximum',
    from: "createVideoLane(videoSem, videoMax)", to: "createVideoLane(videoSem, 3)" },
  { name: 'every video takes one slot, so a 400 MB clip runs beside three others',
    from: "        const weight = kind === 'video' ? videoLane.weightFor(entry.file.size) : 1",
    to: "        const weight = 1" },
  { name: 'the weight is decided from the wrong field',
    from: "videoLane.weightFor(entry.file.size)", to: "videoLane.weightFor(entry.file.lastModified)" },
  ],
}
