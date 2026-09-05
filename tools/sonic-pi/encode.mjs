// Turns the WAV takes from render.rb into the game's AAC assets.
//
//   node tools/sonic-pi/encode.mjs WAV_DIR [client/assets/audio]
//
// Music pieces open with a marker tick and play their loop twice; the second
// pass (which already carries the first pass's reverb tails) is cut to the
// exact loop length so it repeats seamlessly. Effects are trimmed to their
// first and last sound. Everything is peak-normalised to -1 dBFS.
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

// Loop lengths follow from the compositions: 32 beats at 60 bpm, 64 at 100 bpm.
export const PIECES = {
  "music-menu": { loop: 32, lead: 1, bitrate: "160k" },
  "music-game": { loop: 38.4, lead: 0.6, bitrate: "160k" },
  chomp: {},
  eaten: {},
  nearby: {},
  respawn: {},
  "round-end": {},
  click: {},
  danger: {},
};
const [wavDir, outDir = "client/assets/audio"] = process.argv.slice(2);
if (!wavDir) {
  console.error("Usage: node tools/sonic-pi/encode.mjs WAV_DIR [OUT_DIR]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], {
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
  return run.stderr;
}
function analyse(file) {
  const log = ffmpeg([
    "-i",
    file,
    "-af",
    "silencedetect=n=-45dB:d=0.02,volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const silences = [...log.matchAll(/silence_(start|end): ([\d.]+)/g)].map(
    (m) => [m[1], +m[2]],
  );
  const duration = (() => {
    const m = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  })();
  // Onset: end of the silence that starts at the very beginning, if any.
  let onset = 0;
  if (
    silences[0]?.[0] === "start" &&
    silences[0][1] < 0.01 &&
    silences[1]?.[0] === "end"
  )
    onset = silences[1][1];
  // Trailing silence: a silence_start with no later silence_end.
  const last = silences.at(-1);
  const tail = last?.[0] === "start" ? last[1] : duration;
  const peak = +(log.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? 0);
  return { onset, tail, duration, peak };
}

const report = [];
for (const [name, spec] of Object.entries(PIECES)) {
  const input = path.join(wavDir, `${name}.wav`);
  try {
    statSync(input);
  } catch {
    console.warn(`skip ${name}: no ${input}`);
    continue;
  }
  const { onset, tail, duration, peak } = analyse(input);
  const gain = (-1 - peak).toFixed(2);
  let filter, note;
  if (spec.loop) {
    const start = onset + spec.lead + spec.loop,
      end = start + spec.loop;
    if (end > duration + 0.01)
      throw new Error(`${name}: take too short for two loops (${duration}s)`);
    filter = `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.006,afade=t=out:st=${spec.loop - 0.006}:d=0.006,volume=${gain}dB`;
    note = `loop ${spec.loop}s from ${start.toFixed(3)}s`;
  } else {
    const start = Math.max(0, onset - 0.003),
      end = Math.min(duration, tail + 0.06);
    filter = `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.002,afade=t=out:st=${Math.max(0, end - start - 0.03)}:d=0.03,volume=${gain}dB`;
    note = `${(end - start).toFixed(2)}s`;
  }
  const output = path.join(outDir, `${name}.m4a`);
  ffmpeg([
    "-i",
    input,
    "-af",
    filter,
    "-ar",
    "48000",
    "-c:a",
    "aac",
    "-b:a",
    spec.bitrate ?? "96k",
    "-movflags",
    "+faststart",
    output,
  ]);
  report.push(
    `${name.padEnd(12)} ${note.padEnd(26)} peak ${peak}dB -> ${(statSync(output).size / 1024).toFixed(0)} KB`,
  );
}
console.log(report.join("\n"));
