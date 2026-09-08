# Fishtank menu theme: "Below the surface". 60 bpm, a 32-beat loop played twice.
# The opening tick is a slicing marker for encode.mjs; the loop begins exactly
# one beat later, and the second pass (which carries the first pass's tails) is
# what ships, so it loops seamlessly.
use_bpm 60
use_random_seed 12
sample :elec_tick, amp: 1.4
sleep 1
progression = [chord(:d3, :minor7), chord(:bb2, :major7), chord(:g2, :minor7), chord(:a2, :minor7)]
in_thread do
  with_fx :reverb, room: 0.92, mix: 0.62 do
    with_fx :lpf, cutoff: 92 do
      2.times do
        progression.each do |c|
          use_synth :hollow
          play c, attack: 3.5, sustain: 2, release: 3, amp: 1.1
          use_synth :dark_ambience
          play c[0] - 12, attack: 2.5, sustain: 4, release: 2.5, amp: 0.45
          sleep 8
        end
      end
    end
  end
end
in_thread do
  with_fx :reverb, room: 0.85, mix: 0.55 do
    with_fx :echo, phase: 0.75, decay: 5, mix: 0.28 do
      use_synth :pretty_bell
      melody = (ring :d5, :f5, :a5, :c6, :a5, :g5, :f5, :e5, :d5, :a5, :c6, :d6)
      hits = [0, 3, 5, 8, 11, 13, 16, 19, 21, 24, 27, 29]
      2.times do
        32.times do |beat|
          play melody.tick, amp: 0.32, release: 2.5, pan: rrand(-0.6, 0.6) if hits.include?(beat)
          sleep 1
        end
      end
    end
  end
end
in_thread do
  with_fx :reverb, room: 0.6, mix: 0.4 do
    use_synth :sine
    64.times do
      play rrand(88, 100), release: 0.09, amp: 0.07, pan: rrand(-1, 1) if one_in(3)
      sleep 1
    end
  end
end
