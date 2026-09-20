// Web Audio for the tank: crossfading music loops, one-shot effects with
// distance falloff, and a remembered mute. The assets are Sonic Pi pieces from
// tools/sonic-pi, rendered by render.rb and cut/encoded by encode.mjs.
const TRACKS = {
  menu: { file: "music-menu", loop: 32 },
  game: { file: "music-game", loop: 38.4 },
};
const EFFECTS = [
  "chomp",
  "eaten",
  "nearby",
  "respawn",
  "round-end",
  "click",
  "danger",
  "pad",
  "buzz",
  "zap",
];
// Two volumes rather than one, because the loops and the cues are not the same
// request: someone playing with a film on in the background wants the theme
// down and the chomp left alone. The defaults ARE the authored mix - 0.55
// against 0.9 were the bus gains hard-coded here before the sliders existed -
// so a player who never opens the panel hears exactly what they always did.
//
// The slider sets the bus gain directly. It is not a scale over a hidden
// master, so the number in the panel is the gain, 0 is silence, and there is
// no second volume multiplying it behind the player's back.
const MUSIC_KEY = "fishtank.vol.music.v1";
const SFX_KEY = "fishtank.vol.sfx.v1";
const DEFAULT_MUSIC = 0.55;
const DEFAULT_SFX = 0.9;
const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));
export function createAudio({ base = "assets/audio/" } = {}) {
  let context = null,
    master,
    musicBus,
    sfxBus,
    current = null,
    wanted = null,
    muted = false,
    musicVolume = DEFAULT_MUSIC,
    sfxVolume = DEFAULT_SFX;
  const buffers = new Map();
  try {
    muted = localStorage.getItem("fishtank.muted") === "1";
    // Mute is kept as its own thing rather than folded into "both sliders at
    // zero": it is one tap in the header and it has to give you back the mix
    // you had, which a pair of zeroed sliders cannot.
    const storedMusic = localStorage.getItem(MUSIC_KEY);
    const storedSfx = localStorage.getItem(SFX_KEY);
    if (storedMusic !== null) musicVolume = clamp(storedMusic);
    if (storedSfx !== null) sfxVolume = clamp(storedSfx);
  } catch {
    /* Storage unavailable: start unmuted, at the authored mix. */
  }
  function load(name) {
    if (!buffers.has(name))
      buffers.set(
        name,
        fetch(`${base}${name}.m4a`)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((data) => context.decodeAudioData(data))
          .catch((error) => {
            console.warn(`Audio "${name}" unavailable`, error);
            return null;
          }),
      );
    return buffers.get(name);
  }
  // Some decoders keep the AAC encoder's priming silence; loop around it.
  function firstSound(buffer) {
    const data = buffer.getChannelData(0),
      limit = Math.min(data.length, buffer.sampleRate * 0.2);
    for (let i = 0; i < limit; i++)
      if (Math.abs(data[i]) > 1e-4) return i / buffer.sampleRate;
    return 0;
  }
  function fadeOut(entry, seconds) {
    const now = context.currentTime,
      g = entry.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + seconds);
    entry.source.stop(now + seconds + 0.05);
  }
  async function startMusic(track) {
    const spec = TRACKS[track],
      buffer = spec && (await load(spec.file));
    if (!buffer || wanted !== track || current?.name === track) return;
    const start = firstSound(buffer),
      source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = start;
    source.loopEnd = Math.min(buffer.duration, start + spec.loop);
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(musicBus);
    source.start(0, start);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + 1.5);
    if (current) fadeOut(current, 1.2);
    current = { name: track, source, gain };
  }
  return {
    // Browsers only start audio after a gesture; call from the first one.
    unlock() {
      if (context) {
        if (context.state === "suspended") context.resume();
        return;
      }
      context = new (window.AudioContext || window.webkitAudioContext)();
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(context.destination);
      musicBus = context.createGain();
      musicBus.gain.value = musicVolume;
      musicBus.connect(master);
      sfxBus = context.createGain();
      sfxBus.gain.value = sfxVolume;
      sfxBus.connect(master);
      for (const name of EFFECTS) load(name);
      if (wanted) startMusic(wanted);
    },
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      try {
        localStorage.setItem("fishtank.muted", value ? "1" : "0");
      } catch {
        /* Not remembered this time. */
      }
      if (master)
        master.gain.setTargetAtTime(value ? 0 : 1, context.currentTime, 0.05);
    },
    // Both setters share this: remember it, then move the bus if there is one
    // yet. Dragging a slider before the first gesture is legal - the value is
    // stored and unlock() starts the bus at it - so nothing here may assume a
    // context exists.
    get musicVolume() {
      return musicVolume;
    },
    setMusicVolume(value) {
      musicVolume = clamp(value);
      try {
        localStorage.setItem(MUSIC_KEY, String(musicVolume));
      } catch {
        /* Not remembered this time. */
      }
      if (musicBus)
        musicBus.gain.setTargetAtTime(musicVolume, context.currentTime, 0.05);
    },
    get sfxVolume() {
      return sfxVolume;
    },
    setSfxVolume(value) {
      sfxVolume = clamp(value);
      try {
        localStorage.setItem(SFX_KEY, String(sfxVolume));
      } catch {
        /* Not remembered this time. */
      }
      if (sfxBus)
        sfxBus.gain.setTargetAtTime(sfxVolume, context.currentTime, 0.05);
    },
    // Switch loops with a crossfade; null fades the music out.
    music(track) {
      wanted = track;
      if (!context) return;
      if (track === null) {
        if (current) fadeOut(current, 1.2);
        current = null;
        return;
      }
      startMusic(track);
    },
    // One-shot effect; distance (world units) fades it out towards range.
    async play(name, { volume = 1, distance = 0, range = 40 } = {}) {
      if (!context || muted) return;
      const falloff = Math.max(0, 1 - distance / range);
      if (falloff <= 0) return;
      const buffer = await load(name);
      if (!buffer) return;
      const source = context.createBufferSource(),
        gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = volume * falloff * falloff;
      source.connect(gain);
      gain.connect(sfxBus);
      source.start();
    },
  };
}
