# Fishtank gameplay loop: "Feeding time". 100 bpm, a 64-beat loop played twice.
# Marker tick first, loop starts one beat (0.6 s) later; see music-menu.rb.
use_bpm 100
use_random_seed 3
sample :elec_tick, amp: 1.4
sleep 1
roots = [:d2, :bb1, :g1, :a1]
in_thread do
  with_fx :lpf, cutoff: 105 do
    2.times do
      16.times do |bar|
        sample :bd_haus, amp: 0.55
        sample :drum_cymbal_closed, amp: 0.18, rate: 1.2
        sleep 1
        sample :drum_cymbal_closed, amp: 0.12, rate: 1.4
        sleep 1
        sample :bd_haus, amp: 0.45
        sample :drum_cymbal_closed, amp: 0.18, rate: 1.2
        sleep 0.5
        sample :elec_tick, amp: 0.25 if bar.odd?
        sleep 0.5
        sample :drum_cymbal_closed, amp: 0.12, rate: 1.4
        sample :elec_blip2, amp: 0.2, rate: 1.5 if bar % 4 == 3
        sleep 1
      end
    end
  end
end
in_thread do
  with_fx :lpf, cutoff: 80 do
    use_synth :fm
    2.times do
      roots.each do |r|
        4.times do
          play r, divisor: 1, depth: 1.5, release: 0.6, amp: 0.8
          sleep 1.5
          play r, divisor: 1, depth: 1.5, release: 0.4, amp: 0.6
          sleep 1
          play r + 12, divisor: 1, depth: 1, release: 0.3, amp: 0.4
          sleep 1.5
        end
      end
    end
  end
end
in_thread do
  with_fx :reverb, room: 0.7, mix: 0.4 do
    with_fx :echo, phase: 0.75, decay: 3, mix: 0.25 do
      use_synth :pluck
      riff = [[:d4, :f4, :a4, :c5, :a4, :f4, :e4, :d4],
              [:bb3, :d4, :f4, :a4, :f4, :d4, :c4, :bb3],
              [:g3, :bb3, :d4, :f4, :d4, :bb3, :a3, :g3],
              [:a3, :c4, :e4, :g4, :e4, :c4, :b3, :a3]]
      2.times do
        riff.each do |phrase|
          2.times do
            phrase.each do |n|
              play n, amp: 0.55, release: 0.9, pan: rrand(-0.4, 0.4)
              sleep 1
            end
          end
        end
      end
    end
  end
end
in_thread do
  with_fx :reverb, room: 0.8, mix: 0.5 do
    use_synth :prophet
    2.times do
      [chord(:d3, :minor), chord(:bb2, :major), chord(:g2, :minor), chord(:a2, :minor)].each do |c|
        play c, attack: 2, sustain: 10, release: 4, cutoff: 85, amp: 0.35
        sleep 16
      end
    end
  end
end
