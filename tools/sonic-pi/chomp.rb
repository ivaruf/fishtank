# You eat something. Two bites: each is a wet jaw slam followed by a crunch
# made of dozens of tiny resonant noise grains (shell splinters) through a
# bitcrusher, then a descending gulp.
use_random_seed 7

define :bite do |amp|
  # Jaw slam: low thump plus a wet squelch.
  sample :drum_heavy_kick, rate: 0.7, amp: amp * 0.9
  sample :bd_boom, rate: 1.4, amp: amp * 0.5
  sample :elec_blup, rate: 0.5, amp: amp * 0.6
  # Crunch: a burst of tiny broken-up noise grains, brightest first.
  with_fx :bitcrusher, bits: 6, sample_rate: 9000, mix: 0.55 do
    with_fx :hpf, cutoff: 55 do
      sample :drum_snare_hard, rate: 0.55, amp: amp * 0.5
      use_synth :cnoise
      26.times do |i|
        fade = 1.0 - i / 30.0
        play 60, attack: 0.001, release: 0.018 + rrand(0, 0.025),
             cutoff: rrand(72, 118), res: 0.78,
             amp: amp * fade * rrand(0.35, 1.0)
        sleep rrand(0.006, 0.013)
      end
    end
  end
end

with_fx :reverb, room: 0.4, mix: 0.15 do
  bite 1.0
  sleep 0.06
  bite 0.75
  sleep 0.05
  use_synth :sine
  s = play 55, note_slide: 0.18, release: 0.32, amp: 0.5
  control s, note: 40
end
