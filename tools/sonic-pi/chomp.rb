# You eat something: one cartoon crunch and a gulp. Kept simple and friendly.
use_random_seed 7

with_fx :reverb, room: 0.35, mix: 0.12 do
  # Soft jaw thump.
  sample :drum_heavy_kick, rate: 0.8, amp: 0.55
  # Crunch: a short shower of tiny resonant noise grains, gently crunched.
  with_fx :bitcrusher, bits: 8, sample_rate: 12000, mix: 0.35 do
    with_fx :hpf, cutoff: 65 do
      use_synth :cnoise
      18.times do |i|
        fade = 1.0 - i / 22.0
        play 60, attack: 0.001, release: 0.015 + rrand(0, 0.02),
             cutoff: rrand(80, 118), res: 0.75,
             amp: 0.8 * fade * rrand(0.4, 1.0)
        sleep rrand(0.007, 0.013)
      end
    end
  end
  sleep 0.06
  # Gulp.
  use_synth :sine
  s = play 57, note_slide: 0.16, release: 0.3, amp: 0.5
  control s, note: 43
end
